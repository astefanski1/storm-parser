import type { ReplayEvent } from "../ReplayParser.js";
import type {
  TakedownEvent,
  KillParticipant,
  XPValues,
  ObjectiveEvent,
  TalentChoices,
  UnitLife,
  PlayerStat,
  MatchStat,
} from "../types/index.js";
import { normalizeHeroName } from "./heroesList.js";
import { normalizeMapName } from "./mapsList.js";

// ── Structure name mapping ──────────────────────────────────────────────────
const STRUCTURE_NAMES: Record<string, string> = {
  TownCannonTowerL2: "Fort Tower",
  TownCannonTowerL3: "Keep Tower",
  TownTownHallL2: "Fort",
  TownTownHallL3: "Keep",
  TownMoonwellL2: "Fort Well",
  TownMoonwellL3: "Keep Well",
};

const MERC_CAMP_TYPES: Record<string, string> = {
  MercLanerMeleeKnight: "Bruiser Camp",
  MercLanerRangedMage: "Bruiser Camp",
  MercLanerSiegeGiant: "Siege Camp",
  MercLanerRangedMinion: "Siege Camp",
};

/** Tracker fixed-point values (`m_fixedData`) are scaled by 4096. */
const FIXED = 4096;

/** A pick from the draft (`SHeroPickedEvent`), in draft order. */
export interface DraftPick {
  /** Raw internal hero name (`m_hero`). */
  hero: string;
  /** 0-based index into `details.m_playerList` (`m_controllingPlayer`). */
  player: number;
}

interface TrackedUnit {
  type: string;
  playerId: number;
  team: number;
  x: number;
  y: number;
  bornLoop: number;
}

interface TrackerState {
  playerIDMap: Record<number, string>;
  /** PlayerInit occurrences per ToonHandle (AI players share one). */
  toonSeen: Record<string, number>;
  /** Player key per lobby slot (`m_workingSetSlotId`, else details index). */
  slotKeys: Record<number, string>;
  /** Team (0/1) from `PlayerInit.Team` per tracker player id. */
  initTeam: Record<number, number>;
  /** Whether the replay has any `PlayerInit` (custom games may have none). */
  hasPlayerInit: boolean;
  loopGameStart: number;
  loopGameEnd: number;
  unitIndex: Record<string, TrackedUnit>;
  /** Hero units per tracker player id, in birth order. */
  heroUnitsOf: Record<number, string[]>;
  /** `PlayerSpawned` hero unit type per tracker player id. */
  spawnHero: Record<number, string>;
  /** `PlayerDeath` loops per tracker player id. */
  deathLoops: Record<number, number[]>;
  /** `SUnitRevivedEvent` per unit tag. */
  revives: Record<string, { loop: number; x: number; y: number }[]>;
  /** Level reached per tracker player id, in order. */
  levels: Record<number, { loop: number; level: number }[]>;
  picks: DraftPick[];
  /** Open objective events awaiting their end event (key: name + `Event` no.). */
  openObjectives: Record<string, ObjectiveEvent>;
  /** Language-independent map id from `EndOfGameTalentChoices` ("DragonShire"). */
  mapId?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function bufStr(val: unknown): string {
  if (Buffer.isBuffer(val)) return val.toString("utf8");
  if (typeof val === "string") return val;
  return String(val ?? "");
}

interface KeyedEntry {
  m_key?: Buffer | string;
  m_value: unknown;
}

function getIntVal(
  data: KeyedEntry[] | undefined,
  key: string,
): number | undefined {
  if (!data) return undefined;
  const entry = data.find((d) => bufStr(d.m_key) === key);
  return entry !== undefined ? (entry.m_value as number) : undefined;
}

/** Every value of a repeated int key (e.g. `KillingPlayer`). */
function getAllIntVals(data: KeyedEntry[] | undefined, key: string): number[] {
  if (!data) return [];
  return data
    .filter((d) => bufStr(d.m_key) === key)
    .map((d) => d.m_value as number);
}

function getStrVal(
  data: KeyedEntry[] | undefined,
  key: string,
): string | undefined {
  if (!data) return undefined;
  const entry = data.find((d) => bufStr(d.m_key) === key);
  return entry !== undefined ? bufStr(entry.m_value) : undefined;
}

/** Fixed-point value, already divided by 4096. */
function getFixedVal(
  data: KeyedEntry[] | undefined,
  key: string,
): number | undefined {
  if (!data) return undefined;
  const entry = data.find((d) => bufStr(d.m_key) === key);
  return entry !== undefined ? (entry.m_value as number) / FIXED : undefined;
}

function tagKey(index: number, recycle: number): string {
  return `${index}-${recycle}`;
}
function loopToTime(loop: number, gs: number): number {
  return (loop - gs) / 16;
}

/**
 * Team of a tracker player id: the mapped player's team, else its
 * `PlayerInit.Team`; 11/12 = the teams' AI (structures, mercs, objectives);
 * without any `PlayerInit` the classic 1–5 / 6–10 split.
 */
function teamOf(
  playerId: number,
  state: TrackerState,
  players: Record<string, PlayerStat>,
): number {
  const key = state.playerIDMap[playerId];
  if (key && players[key]) return players[key].team;
  if (state.initTeam[playerId] !== undefined) return state.initTeam[playerId];
  if (playerId === 11) return 0;
  if (playerId === 12) return 1;
  if (!state.hasPlayerInit && playerId >= 1 && playerId <= 10) {
    return playerId <= 5 ? 0 : 1;
  }
  return -1;
}

/** Maps a tracker player id to a player key, dropping any older id for that key. */
function assignPlayer(state: TrackerState, playerId: number, key: string): void {
  for (const [pid, k] of Object.entries(state.playerIDMap)) {
    if (k === key) delete state.playerIDMap[Number(pid)];
  }
  state.playerIDMap[playerId] = key;
}

/**
 * Median respawn time (s) by hero level, measured on Storm League replays.
 * Used only when a death has no `SUnitRevivedEvent` (Leoric, The Lost
 * Vikings, Uther) or no main unit could be identified.
 */
export function estimateRespawn(level: number): number {
  const lv = Math.max(1, Math.round(level));
  if (lv <= 10) return 14 + lv;
  const table = [26, 29, 32, 36, 40, 44, 50, 56, 62, 64];
  return table[lv - 11] ?? 65;
}

// ── Main Entry ──────────────────────────────────────────────────────────────
/**
 * @param slotKeys player key per lobby slot (`m_workingSetSlotId`, else the
 * details index): resolves computer players (their `PlayerInit` has no
 * ToonHandle) and replays without any `PlayerInit` (tracker id = slot + 1).
 */
export function processTrackerEvents(
  events: ReplayEvent[],
  players: Record<string, PlayerStat>,
  match: MatchStat,
  slotKeys: Record<number, string> = {},
): { playerIDMap: Record<number, string>; picks: DraftPick[] } {
  const hasPlayerInit = events.some(
    (e) =>
      e._event === "NNet.Replay.Tracker.SStatGameEvent" &&
      bufStr(e.m_eventName) === "PlayerInit",
  );
  const state: TrackerState = {
    playerIDMap: {},
    toonSeen: {},
    slotKeys,
    initTeam: {},
    hasPlayerInit,
    loopGameStart: 0,
    loopGameEnd: 0,
    unitIndex: {},
    heroUnitsOf: {},
    spawnHero: {},
    deathLoops: {},
    revives: {},
    levels: {},
    picks: [],
    openObjectives: {},
  };

  if (!hasPlayerInit) {
    for (const [slot, key] of Object.entries(slotKeys)) {
      if (players[key]) state.playerIDMap[Number(slot) + 1] = key;
    }
  }

  // Ensure match.bans exists
  if (!match.bans) {
    match.bans = { 0: [], 1: [] };
  }

  match.levelTimes = { "0": {}, "1": {} };
  match.takedowns = [];
  match.structures = {};
  match.XPBreakdown = [];
  match.mercs = { captures: [], units: {} };
  match.objective = {
    0: { count: 0, events: [] },
    1: { count: 0, events: [] },
    type: match.map || "",
  };

  for (const event of events) {
    state.loopGameEnd = Math.max(state.loopGameEnd, event._gameloop);
    switch (event._event) {
      case "NNet.Replay.Tracker.SStatGameEvent":
        processStatGameEvent(event, state, players, match);
        break;

      case "NNet.Replay.Tracker.SHeroBannedEvent":
        if (event.m_hero) {
          const rawHeroName = bufStr(event.m_hero);
          const heroName = normalizeHeroName(rawHeroName);
          // If the hero couldn't be strictly validated against our frontend list, ignore it
          if (!heroName) break;

          const teamId = event.m_controllingTeam === 2 ? 1 : 0;
          if (match.bans && match.bans[teamId as 0 | 1]) {
            const teamOrder = match.bans[teamId as 0 | 1].length + 1;
            const absoluteOrder =
              match.bans[0].length + match.bans[1].length + 1;
            match.bans[teamId as 0 | 1].push({
              hero: heroName,
              order: teamOrder,
              absolute: absoluteOrder,
            });
          }
        }
        break;

      case "NNet.Replay.Tracker.SHeroPickedEvent":
        if (event.m_hero && typeof event.m_controllingPlayer === "number") {
          state.picks.push({
            hero: bufStr(event.m_hero),
            player: event.m_controllingPlayer,
          });
        }
        break;

      case "NNet.Replay.Tracker.SUnitBornEvent":
        processUnitBorn(event, state, match, players);
        break;
      case "NNet.Replay.Tracker.SUnitDiedEvent":
        processUnitDied(event, state, match);
        break;
      case "NNet.Replay.Tracker.SUnitRevivedEvent": {
        const key = tagKey(
          event.m_unitTagIndex as number,
          event.m_unitTagRecycle as number,
        );
        (state.revives[key] ??= []).push({
          loop: event._gameloop,
          x: (event.m_x as number) ?? 0,
          y: (event.m_y as number) ?? 0,
        });
        break;
      }
      case "NNet.Replay.Tracker.SUnitOwnerChangeEvent":
        processOwnerChange(event, state, players);
        break;
    }
  }

  // m_title is localized and m_mapFileName is empty in real replays, so the
  // canonical name comes from the end-of-game `Map` id when present.
  match.map = normalizeMapName(match.map || "", state.mapId);
  match.objective.type = match.map;
  for (const k of [0, 1] as const) {
    match.objective[k].count = match.objective[k].events.length;
  }

  match.loopGameStart = state.loopGameStart;
  match.loopLength = state.loopGameEnd;
  match.length = (state.loopGameEnd - state.loopGameStart) / 16;
  buildPlayerUnits(state, players, match);
  return { playerIDMap: state.playerIDMap, picks: state.picks };
}

// ── SStatGameEvent ──────────────────────────────────────────────────────────
function processStatGameEvent(
  event: ReplayEvent,
  state: TrackerState,
  players: Record<string, PlayerStat>,
  match: MatchStat,
): void {
  const eventName = bufStr(event.m_eventName);
  const intData = event.m_intData as KeyedEntry[] | undefined;
  const stringData = event.m_stringData as KeyedEntry[] | undefined;
  const fixedData = event.m_fixedData as KeyedEntry[] | undefined;

  switch (eventName) {
    case "PlayerInit": {
      const trkId = getIntVal(intData, "PlayerID");
      if (trkId === undefined) break;
      const rawTeam = getIntVal(intData, "Team");
      if (rawTeam === 1 || rawTeam === 2) state.initTeam[trkId] = rawTeam - 1;
      const toonHandle = getStrVal(stringData, "ToonHandle");
      if (!toonHandle) {
        // Computer players carry no ToonHandle: tracker id = lobby slot + 1.
        const key = state.slotKeys[trkId - 1];
        if (key && players[key]) assignPlayer(state, trkId, key);
        break;
      }
      // The k-th PlayerInit with a ToonHandle is the k-th details player with
      // it (players sharing a handle get ":k" keys).
      const n = state.toonSeen[toonHandle] ?? 0;
      state.toonSeen[toonHandle] = n + 1;
      const key = n === 0 ? toonHandle : `${toonHandle}:${n}`;
      if (players[key]) assignPlayer(state, trkId, key);
      break;
    }
    case "GatesOpen":
      state.loopGameStart = event._gameloop;
      break;

    case "PlayerSpawned": {
      const pid = getIntVal(intData, "PlayerID");
      const hero = getStrVal(stringData, "Hero");
      if (pid !== undefined && hero) state.spawnHero[pid] = hero;
      break;
    }

    case "LevelUp": {
      const playerId = getIntVal(intData, "PlayerID");
      const level = getIntVal(intData, "Level");
      if (playerId === undefined || level === undefined) break;
      (state.levels[playerId] ??= []).push({ loop: event._gameloop, level });
      const teamNum = teamOf(playerId, state, players);
      if (teamNum !== 0 && teamNum !== 1) break;
      const team = String(teamNum);
      if (!match.levelTimes[team][String(level)]) {
        match.levelTimes[team][String(level)] = {
          loop: event._gameloop,
          level,
          team,
          time: loopToTime(event._gameloop, state.loopGameStart),
        };
      }
      break;
    }

    case "TalentChosen": {
      const pid = getIntVal(intData, "PlayerID");
      const talentName = getStrVal(stringData, "PurchaseName");
      if (pid === undefined || !talentName) break;

      // Only keep actual talents, skipping any meta-strings that might have been recorded in older replays.
      if (
        talentName === "Win" ||
        talentName === "Loss" ||
        talentName.startsWith("Hero")
      ) {
        break;
      }

      const mapNoSpaces = match.map?.replace(/\s+/g, "") || "";
      if (talentName === mapNoSpaces) break;

      const toon = state.playerIDMap[pid];
      if (!toon || !players[toon]) break;
      const tierKeys = [
        "Tier1Choice",
        "Tier2Choice",
        "Tier3Choice",
        "Tier4Choice",
        "Tier5Choice",
        "Tier6Choice",
        "Tier7Choice",
      ] as const;
      for (const tk of tierKeys) {
        if (!players[toon].talents[tk]) {
          players[toon].talents[tk] = talentName;
          break;
        }
      }
      break;
    }

    case "PlayerDeath": {
      const victimId = getIntVal(intData, "PlayerID");
      if (victimId === undefined) break;
      (state.deathLoops[victimId] ??= []).push(event._gameloop);
      const victimToon = state.playerIDMap[victimId];
      if (!victimToon) break;

      const victim: KillParticipant = {
        player: victimToon,
        hero: players[victimToon]?.hero || "",
      };
      // Every participant is a repeated `KillingPlayer` entry (ascending id,
      // no killing-blow order). Non-hero killers (0, 11, 12) are dropped.
      const killers: KillParticipant[] = [];
      for (const kid of new Set(getAllIntVals(intData, "KillingPlayer"))) {
        const kt = state.playerIDMap[kid];
        if (kt && players[kt]) killers.push({ player: kt, hero: players[kt].hero });
      }

      const td: TakedownEvent = {
        loop: event._gameloop,
        time: loopToTime(event._gameloop, state.loopGameStart),
        x: getFixedVal(fixedData, "PositionX") ?? 0,
        y: getFixedVal(fixedData, "PositionY") ?? 0,
        killers,
        victim,
      };
      match.takedowns.push(td);
      if (players[victimToon]) players[victimToon].deaths.push(td);
      for (const k of killers) {
        if (players[k.player]) players[k.player].takedowns.push(td);
      }
      break;
    }

    case "PeriodicXPBreakdown": {
      const rawTeam = getIntVal(intData, "Team");
      if (rawTeam !== 1 && rawTeam !== 2) break;
      match.XPBreakdown.push({
        loop: event._gameloop,
        time: loopToTime(event._gameloop, state.loopGameStart),
        team: rawTeam - 1,
        teamLevel: getIntVal(intData, "TeamLevel") ?? 0,
        breakdown: readXP(fixedData),
      });
      break;
    }

    case "EndOfGameXPBreakdown": {
      // One event per player, all holding their team's totals.
      const pid = getIntVal(intData, "PlayerID");
      if (pid === undefined) break;
      const team = teamOf(pid, state, players);
      if (team !== 0 && team !== 1) break;
      if (
        match.XPBreakdown.some(
          (e) => e.team === team && e.loop === event._gameloop && e.final,
        )
      ) {
        break;
      }
      const time = loopToTime(event._gameloop, state.loopGameStart);
      match.XPBreakdown.push({
        loop: event._gameloop,
        time,
        team,
        final: true,
        breakdown: { ...readXP(fixedData), GameTime: time, PreviousGameTime: 0 },
      });
      break;
    }

    case "JungleCampCapture": {
      const team = (getFixedVal(fixedData, "TeamID") ?? 0) - 1;
      if (team !== 0 && team !== 1) break;
      match.mercs.captures.push({
        loop: event._gameloop,
        type:
          getStrVal(stringData, "CampType") ??
          getStrVal(stringData, "Result") ??
          "Unknown Camp",
        team,
        time: loopToTime(event._gameloop, state.loopGameStart),
      });
      break;
    }

    case "EndOfGameTalentChoices": {
      const playerId = getIntVal(intData, "PlayerID");
      if (playerId === undefined) break;
      const mapId = getStrVal(stringData, "Map");
      if (mapId) state.mapId = mapId;
      const toonHandle = state.playerIDMap[playerId];
      if (!toonHandle || !players[toonHandle]) break;
      const tc: TalentChoices = {};
      if (stringData) {
        for (const data of stringData) {
          const key = bufStr(data.m_key);
          const val = bufStr(data.m_value);
          if (key === "Tier 1 Choice" && val) tc.Tier1Choice = val;
          else if (key === "Tier 2 Choice" && val) tc.Tier2Choice = val;
          else if (key === "Tier 3 Choice" && val) tc.Tier3Choice = val;
          else if (key === "Tier 4 Choice" && val) tc.Tier4Choice = val;
          else if (key === "Tier 5 Choice" && val) tc.Tier5Choice = val;
          else if (key === "Tier 6 Choice" && val) tc.Tier6Choice = val;
          else if (key === "Tier 7 Choice" && val) tc.Tier7Choice = val;
        }
      }
      players[toonHandle].talents = tc;
      break;
    }

    default:
      processObjectiveEvent(eventName, event, state, match, intData, fixedData);
      break;
  }
}

function readXP(fixedData: KeyedEntry[] | undefined): XPValues {
  return {
    GameTime: getFixedVal(fixedData, "GameTime") ?? 0,
    PreviousGameTime: getFixedVal(fixedData, "PreviousGameTime") ?? 0,
    MinionXP: getFixedVal(fixedData, "MinionXP") ?? 0,
    CreepXP: getFixedVal(fixedData, "CreepXP") ?? 0,
    StructureXP: getFixedVal(fixedData, "StructureXP") ?? 0,
    HeroXP: getFixedVal(fixedData, "HeroXP") ?? 0,
    TrickleXP: getFixedVal(fixedData, "TrickleXP") ?? 0,
  };
}

// ── Objective Events ────────────────────────────────────────────────────────
/**
 * Map objective events and where each keeps the team that took it: an int
 * or fixed-point key holding the raw team 1/2 (`offset` 1) or the team's AI
 * player 11/12 (`offset` 11). Other values (Sky Temple's neutral 0) are
 * skipped.
 */
interface ObjectiveSpec {
  key: string;
  fixed?: boolean;
  offset: number;
  score?: string;
  duration?: string;
}
const OBJECTIVES: Record<string, ObjectiveSpec> = {
  "Immortal Defeated": { key: "Winning Team", offset: 1, duration: "Immortal Fight Duration" },
  "Infernal Shrine Captured": { key: "Winning Team", offset: 1, score: "Winning Score" },
  SoulEatersSpawned: { key: "TeamID", fixed: true, offset: 1, score: "TeamScore" },
  DragonKnightActivated: { key: "TeamID", fixed: true, offset: 1 },
  VolskayaCapturePointComplete: { key: "WinningTeam", offset: 1 },
  TributeCollected: { key: "TeamID", fixed: true, offset: 1 },
  RavenCurseActivated: { key: "TeamID", fixed: true, offset: 1 },
  "Altar Captured": { key: "Firing Team", offset: 1, score: "Towns Owned" },
  "Town Captured": { key: "New Owner", offset: 11 },
  "Six Town Event Start": { key: "Owning Team", offset: 1 },
  SkyTempleCaptured: { key: "TeamID", offset: 1 },
  GhostShipCaptured: { key: "TeamID", fixed: true, offset: 1, score: "TeamScore" },
  WarheadJunctionNukeFired: { key: "OwningTeam", offset: 1 },
  HauntedMinesGolemsSpawned: { key: "TeamID", fixed: true, offset: 1 },
};

function processObjectiveEvent(
  eventName: string,
  event: ReplayEvent,
  state: TrackerState,
  match: MatchStat,
  intData?: KeyedEntry[],
  fixedData?: KeyedEntry[],
): void {
  const time = loopToTime(event._gameloop, state.loopGameStart);
  const eventNo = getIntVal(intData, "Event") ?? getIntVal(intData, "Boss Duel Number");

  // Start / end events that complete an objective rather than create one.
  if (eventName === "Boss Duel Started") {
    state.openObjectives[`duel:${eventNo}`] = {
      team: -1,
      loop: event._gameloop,
      time,
    };
    return;
  }
  if (eventName === "Punisher Killed") {
    const shrine = state.openObjectives[`shrine:${eventNo}`];
    if (shrine) {
      shrine.endLoop = event._gameloop;
      shrine.end = time;
      shrine.duration = getIntVal(intData, "Duration");
      delete state.openObjectives[`shrine:${eventNo}`];
    }
    return;
  }
  if (eventName === "Six Town Event End") {
    const open = state.openObjectives["sixtown"];
    if (open) {
      open.endLoop = event._gameloop;
      open.end = time;
      open.duration = time - open.time;
      delete state.openObjectives["sixtown"];
    }
    return;
  }

  const spec = OBJECTIVES[eventName];
  if (!spec) return;
  const raw = spec.fixed
    ? getFixedVal(fixedData, spec.key)
    : getIntVal(intData, spec.key);
  if (raw === undefined) return;
  const team = raw - spec.offset;
  if (team !== 0 && team !== 1) return;

  const objEvent: ObjectiveEvent = {
    name: eventName,
    team,
    loop: event._gameloop,
    time,
  };
  if (spec.score) {
    const score = getIntVal(intData, spec.score);
    if (score !== undefined) objEvent.score = score;
  }
  if (spec.duration) {
    const duration = getIntVal(intData, spec.duration);
    if (duration !== undefined) objEvent.duration = duration;
  }

  if (eventName === "Immortal Defeated") {
    // The duel starts at `Boss Duel Started`; the Immortal falls here.
    const duel = state.openObjectives[`duel:${eventNo}`];
    if (duel) {
      objEvent.loop = duel.loop;
      objEvent.time = duel.time;
      delete state.openObjectives[`duel:${eventNo}`];
    }
    objEvent.endLoop = event._gameloop;
    objEvent.end = time;
  } else if (eventName === "Infernal Shrine Captured") {
    state.openObjectives[`shrine:${eventNo}`] = objEvent;
  } else if (eventName === "Six Town Event Start") {
    state.openObjectives["sixtown"] = objEvent;
  }

  match.objective[team].events.push(objEvent);
}

// ── SUnitBornEvent ──────────────────────────────────────────────────────────
function processUnitBorn(
  event: ReplayEvent,
  state: TrackerState,
  match: MatchStat,
  players: Record<string, PlayerStat>,
): void {
  const unitType = bufStr(event.m_unitTypeName);
  const tagIdx = event.m_unitTagIndex as number;
  const tagRec = event.m_unitTagRecycle as number;
  const key = tagKey(tagIdx, tagRec);
  const playerId = (event.m_controlPlayerId ??
    event.m_upkeepPlayerId) as number;
  const x = (event.m_x as number) ?? 0;
  const y = (event.m_y as number) ?? 0;
  const team = teamOf(playerId, state, players);

  state.unitIndex[key] = {
    type: unitType,
    playerId,
    team,
    x,
    y,
    bornLoop: event._gameloop,
  };

  if (unitType.startsWith("Town") && STRUCTURE_NAMES[unitType]) {
    match.structures[key] = {
      type: unitType,
      name: STRUCTURE_NAMES[unitType],
      tag: tagIdx,
      rtag: tagRec,
      x,
      y,
      team,
    };
  }

  const toonHandle = state.playerIDMap[playerId];
  if (unitType.startsWith("Hero") && toonHandle && players[toonHandle]) {
    (state.heroUnitsOf[playerId] ??= []).push(key);

    // Fallback: If this player has no hero name assigned, recover it from the unit type
    if (!players[toonHandle].hero) {
      const recoveredHero = normalizeHeroName(unitType);
      if (recoveredHero) {
        players[toonHandle].hero = recoveredHero;
        const idx = match.playerIDs.indexOf(toonHandle);
        if (idx !== -1) match.heroes[idx] = recoveredHero;
      }
    }
  }

  if (MERC_CAMP_TYPES[unitType]) {
    const lastCapture = match.mercs.captures[match.mercs.captures.length - 1];
    const captureLoop = lastCapture?.loop ?? event._gameloop;
    match.mercs.units[key] = {
      loop: captureLoop,
      team,
      type: unitType,
      locations: [{ x, y }],
      time: loopToTime(captureLoop, state.loopGameStart),
      duration: 0,
    };
  }
}

// ── SUnitDiedEvent ──────────────────────────────────────────────────────────
function processUnitDied(
  event: ReplayEvent,
  state: TrackerState,
  match: MatchStat,
): void {
  const key = tagKey(
    event.m_unitTagIndex as number,
    event.m_unitTagRecycle as number,
  );
  const time = loopToTime(event._gameloop, state.loopGameStart);

  if (match.structures[key]) {
    match.structures[key].destroyedLoop = event._gameloop;
    match.structures[key].destroyed = time;
  }
  if (match.mercs.units[key]) {
    match.mercs.units[key].duration = time - match.mercs.units[key].time;
  }
}

// ── SUnitOwnerChangeEvent ───────────────────────────────────────────────────
function processOwnerChange(
  event: ReplayEvent,
  state: TrackerState,
  players: Record<string, PlayerStat>,
): void {
  const key = tagKey(
    event.m_unitTagIndex as number,
    event.m_unitTagRecycle as number,
  );
  const newOwner = (event.m_controlPlayerId ??
    event.m_upkeepPlayerId) as number;
  const unit = state.unitIndex[key];
  if (unit) {
    unit.playerId = newOwner;
    const team = teamOf(newOwner, state, players);
    if (team === 0 || team === 1) unit.team = team;
  }
}

// ── Hero lives ──────────────────────────────────────────────────────────────
/**
 * One life per spawn of the player's main hero unit: the first born hero
 * unit whose type is the `PlayerSpawned` hero (clones, mechs and summons
 * aren't lives). A life ends at the player's `PlayerDeath`; the next starts
 * at the main unit's following `SUnitRevivedEvent`, or after
 * `estimateRespawn` when the hero never revives (Leoric, Vikings).
 */
function buildPlayerUnits(
  state: TrackerState,
  players: Record<string, PlayerStat>,
  match: MatchStat,
): void {
  const toTime = (loop: number) => loopToTime(loop, state.loopGameStart);
  const levelAt = (pid: number, loop: number) => {
    let level = 1;
    for (const l of state.levels[pid] ?? []) {
      if (l.loop <= loop) level = l.level;
      else break;
    }
    return level;
  };

  for (const [pidStr, units] of Object.entries(state.heroUnitsOf)) {
    const pid = parseInt(pidStr, 10);
    const toonHandle = state.playerIDMap[pid];
    if (!toonHandle || !players[toonHandle]) continue;
    const mainKey =
      units.find((k) => state.unitIndex[k]?.type === state.spawnHero[pid]) ??
      units[0];
    const main = state.unitIndex[mainKey];
    if (!main) continue;
    const revives = state.revives[mainKey] ?? [];
    const deaths = state.deathLoops[pid] ?? [];

    const lives: UnitLife[] = [];
    let born = toTime(main.bornLoop);
    let location = { x: main.x, y: main.y, time: born };
    for (let i = 0; i < deaths.length; i++) {
      const died = toTime(deaths[i]);
      lives.push({
        born,
        locations: [location],
        died,
        duration: died - born,
      });
      const nextDeath = deaths[i + 1] ?? Infinity;
      const revive = revives.find(
        (r) => r.loop >= deaths[i] && r.loop < nextDeath,
      );
      if (revive) {
        born = toTime(revive.loop);
        location = { x: revive.x, y: revive.y, time: born };
      } else {
        born = died + estimateRespawn(levelAt(pid, deaths[i]));
        location = { x: main.x, y: main.y, time: born };
      }
      if (born >= match.length) break;
    }
    const last = lives[lives.length - 1];
    if (!last || last.died !== undefined) {
      if (born < match.length) {
        lives.push({
          born,
          locations: [location],
          duration: match.length - born,
        });
      }
    }
    players[toonHandle].units[mainKey] = { lives };
  }
}
