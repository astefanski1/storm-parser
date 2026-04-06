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

interface TrackerState {
  playerIDMap: Record<number, string>;
  loopGameStart: number;
  loopGameEnd: number;
  unitIndex: Record<
    string,
    {
      type: string;
      playerId: number;
      team: number;
      x: number;
      y: number;
      bornLoop: number;
    }
  >;
  heroUnits: Record<string, number>;
  heroLives: Record<number, UnitLife[]>;
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

function getStrVal(
  data: KeyedEntry[] | undefined,
  key: string,
): string | undefined {
  if (!data) return undefined;
  const entry = data.find((d) => bufStr(d.m_key) === key);
  return entry !== undefined ? bufStr(entry.m_value) : undefined;
}

function getFixedVal(
  data: KeyedEntry[] | undefined,
  key: string,
): number | undefined {
  if (!data) return undefined;
  const entry = data.find((d) => bufStr(d.m_key) === key);
  return entry !== undefined ? (entry.m_value as number) : undefined;
}

function tagKey(index: number, recycle: number): string {
  return `${index}-${recycle}`;
}
function loopToTime(loop: number, gs: number): number {
  return (loop - gs) / 16;
}

// ── Main Entry ──────────────────────────────────────────────────────────────
export function processTrackerEvents(
  events: ReplayEvent[],
  players: Record<string, PlayerStat>,
  match: MatchStat,
): { playerIDMap: Record<number, string> } {
  const state: TrackerState = {
    playerIDMap: {},
    loopGameStart: 0,
    loopGameEnd: 0,
    unitIndex: {},
    heroUnits: {},
    heroLives: {},
  };

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

      case "NNet.Replay.Tracker.SUnitBornEvent":
        processUnitBorn(event, state, match, players);
        break;
      case "NNet.Replay.Tracker.SUnitDiedEvent":
        processUnitDied(event, state, match);
        break;
      case "NNet.Replay.Tracker.SUnitOwnerChangeEvent":
        processOwnerChange(event, state);
        break;
    }
  }

  match.loopGameStart = state.loopGameStart;
  match.loopLength = state.loopGameEnd;
  match.length = (state.loopGameEnd - state.loopGameStart) / 16;
  buildPlayerUnits(state, players);
  return { playerIDMap: state.playerIDMap };
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
      const toonHandle = getStrVal(stringData, "ToonHandle");
      if (trkId !== undefined && toonHandle && players[toonHandle]) {
        state.playerIDMap[trkId] = toonHandle;
      }
      break;
    }
    case "GatesOpen":
      state.loopGameStart = event._gameloop;
      break;

    case "LevelUp": {
      const playerId = getIntVal(intData, "PlayerID");
      const level = getIntVal(intData, "Level");
      if (playerId === undefined || level === undefined) break;
      let team: string;
      if (playerId >= 1 && playerId <= 5) team = "0";
      else if (playerId >= 6 && playerId <= 10) team = "1";
      else break;
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
      const killerId = getIntVal(intData, "KillingPlayer");
      const posX = getFixedVal(fixedData, "PositionX") ?? 0;
      const posY = getFixedVal(fixedData, "PositionY") ?? 0;
      if (victimId === undefined) break;
      const victimToon = state.playerIDMap[victimId];
      if (!victimToon) break;

      const victim: KillParticipant = {
        player: victimToon,
        hero: players[victimToon]?.hero || "",
      };
      const killers: KillParticipant[] = [];
      const victimTeam = players[victimToon]?.team;

      // Primary killer
      if (killerId && killerId > 0) {
        const kt = state.playerIDMap[killerId];
        if (kt && players[kt])
          killers.push({ player: kt, hero: players[kt].hero });
      }
      // All other opponents as assists
      for (const [pidStr, toon] of Object.entries(state.playerIDMap)) {
        const p = players[toon];
        if (!p || p.team === victimTeam || parseInt(pidStr) === killerId)
          continue;
        killers.push({ player: toon, hero: p.hero });
      }

      const td: TakedownEvent = {
        loop: event._gameloop,
        time: loopToTime(event._gameloop, state.loopGameStart),
        x: posX,
        y: posY,
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
      const team = getIntVal(intData, "Team");
      if (team === undefined) break;
      const breakdown: XPValues = {
        GameTime: getIntVal(intData, "GameTime") ?? 0,
        PreviousGameTime: getIntVal(intData, "PreviousGameTime") ?? 0,
        MinionXP: getFixedVal(fixedData, "MinionXP") ?? 0,
        CreepXP: getFixedVal(fixedData, "CreepXP") ?? 0,
        StructureXP: getFixedVal(fixedData, "StructureXP") ?? 0,
        HeroXP: getFixedVal(fixedData, "HeroXP") ?? 0,
        TrickleXP: getFixedVal(fixedData, "TrickleXP") ?? 0,
      };
      match.XPBreakdown.push({
        loop: event._gameloop,
        time: loopToTime(event._gameloop, state.loopGameStart),
        team,
        teamLevel: getIntVal(intData, "TeamLevel") ?? 0,
        breakdown,
        theoreticalMinionXP: getIntVal(intData, "TheoreticalMinionXP") ?? 0,
      });
      break;
    }

    case "EndOfGameXPBreakdown": {
      const team = getIntVal(intData, "Team");
      if (team === undefined) break;
      match.XPBreakdown.push({
        loop: event._gameloop,
        time: loopToTime(event._gameloop, state.loopGameStart),
        team,
        theoreticalMinionXP: getIntVal(intData, "TheoreticalMinionXP") ?? 0,
        breakdown: {
          GameTime: 0,
          PreviousGameTime: 0,
          MinionXP: getFixedVal(fixedData, "MinionXP") ?? 0,
          CreepXP: getFixedVal(fixedData, "CreepXP") ?? 0,
          StructureXP: getFixedVal(fixedData, "StructureXP") ?? 0,
          HeroXP: getFixedVal(fixedData, "HeroXP") ?? 0,
          TrickleXP: getFixedVal(fixedData, "TrickleXP") ?? 0,
        },
      });
      break;
    }

    case "JungleCampCapture": {
      const campTeam =
        getIntVal(intData, "CampTeam") ?? getIntVal(intData, "Team") ?? 0;
      match.mercs.captures.push({
        loop: event._gameloop,
        type:
          getStrVal(stringData, "CampType") ??
          getStrVal(stringData, "Result") ??
          "Unknown Camp",
        team: campTeam,
        time: loopToTime(event._gameloop, state.loopGameStart),
      });
      break;
    }

    case "EndOfGameTalentChoices": {
      const playerId = getIntVal(intData, "PlayerID");
      if (playerId === undefined) break;
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

// ── Objective Events ────────────────────────────────────────────────────────
const OBJECTIVE_EVENTS = new Set([
  "SoulEatersSpawned",
  "TributeCollected",
  "RavenCurseActivated",
  "AltarCaptured",
  "SkyTempleShotsFired",
  "DragonKnightActivated",
  "GardenTerrorActivated",
  "InfernalShrineCaptured",
  "PunisherKilled",
  "VolskayaVehicleCapture",
  "BraxisWaveStart",
  "ImmortalDefeated",
  "NukeExploded",
  "PayloadDelivered",
  "AlteracCavalryCharge",
  "AlteracCavalry",
]);

function processObjectiveEvent(
  eventName: string,
  event: ReplayEvent,
  state: TrackerState,
  match: MatchStat,
  intData?: KeyedEntry[],
  fixedData?: KeyedEntry[],
): void {
  if (!OBJECTIVE_EVENTS.has(eventName) || !intData) return;
  const team = getIntVal(intData, "Team") ?? getIntVal(intData, "Event") ?? 0;
  const teamKey = team === 0 || team === 1 ? team : 0;
  const objEvent: ObjectiveEvent = {
    team,
    loop: event._gameloop,
    time: loopToTime(event._gameloop, state.loopGameStart),
    score: getIntVal(intData, "Score"),
    duration: getFixedVal(fixedData, "Duration"),
  };
  match.objective[teamKey].events.push(objEvent);
  match.objective[teamKey].count = match.objective[teamKey].events.length;
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

  let team: number;
  if (playerId >= 1 && playerId <= 5) team = 0;
  else if (playerId >= 6 && playerId <= 10) team = 1;
  else if (playerId === 11) team = 0;
  else if (playerId === 12) team = 1;
  else team = playerId <= 5 ? 0 : 1;

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

  if (unitType.startsWith("Hero") && playerId >= 1 && playerId <= 10) {
    state.heroUnits[key] = playerId;
    
    // Fallback: If this player has no hero name assigned, recover it from the unit type
    const toonHandle = state.playerIDMap[playerId];
    if (toonHandle && players[toonHandle] && (!players[toonHandle].hero || players[toonHandle].hero === "")) {
      const recoveredHero = normalizeHeroName(unitType);
      if (recoveredHero) {
        players[toonHandle].hero = recoveredHero;
        match.heroes[playerId - 1] = recoveredHero; // Also update match-level list
      }
    }

    if (!state.heroLives[playerId]) state.heroLives[playerId] = [];
    const bornTime = loopToTime(event._gameloop, state.loopGameStart);
    state.heroLives[playerId].push({
      born: bornTime,
      locations: [{ x, y, time: bornTime }],
      duration: 0,
    });
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
  const heroPlayerId = state.heroUnits[key];
  if (heroPlayerId !== undefined && state.heroLives[heroPlayerId]) {
    const lives = state.heroLives[heroPlayerId];
    const currentLife = lives[lives.length - 1];
    if (currentLife && currentLife.died === undefined) {
      currentLife.died = time;
      currentLife.duration = time - currentLife.born;
    }
  }
}

// ── SUnitOwnerChangeEvent ───────────────────────────────────────────────────
function processOwnerChange(event: ReplayEvent, state: TrackerState): void {
  const key = tagKey(
    event.m_unitTagIndex as number,
    event.m_unitTagRecycle as number,
  );
  const newOwner = (event.m_controlPlayerId ??
    event.m_upkeepPlayerId) as number;
  if (state.unitIndex[key]) {
    state.unitIndex[key].playerId = newOwner;
    if (newOwner >= 1 && newOwner <= 5) state.unitIndex[key].team = 0;
    else if (newOwner >= 6 && newOwner <= 10) state.unitIndex[key].team = 1;
  }
}

// ── Build player unit data ──────────────────────────────────────────────────
function buildPlayerUnits(
  state: TrackerState,
  players: Record<string, PlayerStat>,
): void {
  for (const [pidStr, lives] of Object.entries(state.heroLives)) {
    const pid = parseInt(pidStr, 10);
    const toonHandle = state.playerIDMap[pid];
    if (!toonHandle || !players[toonHandle]) continue;
    for (const life of lives) {
      if (life.died === undefined) {
        const lastLoc = life.locations[life.locations.length - 1];
        life.duration = lastLoc ? lastLoc.time - life.born : 0;
      }
    }
    let unitKey = "";
    for (const [key, heroPlayerId] of Object.entries(state.heroUnits)) {
      if (heroPlayerId === pid) {
        unitKey = key;
        break;
      }
    }
    if (unitKey) players[toonHandle].units[unitKey] = { lives };
  }
}
