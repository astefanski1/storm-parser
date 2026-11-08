import { ReplayParser } from "./ReplayParser.js";
import type {
  AnalysisResult,
  ChatMessage,
  ChatPlayer,
  ChatRecipient,
  ChatResult,
  MatchStat,
  PlayerStat,
  ReplayVersion,
  TeamStat,
  RawDetails,
  RawInitData,
} from "./types/index.js";
import {
  processTrackerEvents,
  type DraftPick,
} from "./analyzers/trackerProcessor.js";
import { computeAnalytics } from "./analyzers/analyticsComputer.js";
import { normalizeHeroName } from "./analyzers/heroesList.js";
import { findBattleTagNumbers } from "./analyzers/battleTags.js";

/** Matchmaking queue (`m_gameOptions.m_ammId`) → game mode. */
export const AMM_MODES: Record<number, string> = {
  50001: "Quick Match",
  50021: "Versus AI",
  50031: "Brawl",
  50041: "Practice",
  50051: "Unranked Draft",
  50061: "Hero League",
  50071: "Team League",
  50091: "Storm League",
  50101: "ARAM",
};

/** `SChatMessage.m_recipient` → recipient (heroprotocol leaves it unnamed). */
const CHAT_RECIPIENTS: Record<number, ChatRecipient> = { 0: "all", 1: "allies", 4: "observers" };

function bufStr(val: unknown): string {
  if (Buffer.isBuffer(val)) return val.toString("utf8");
  if (typeof val === "string") return val;
  return String(val ?? "");
}

export class ReplayAnalyzer {
  static async analyze(filePath: string): Promise<AnalysisResult> {
    try {
      const parser = new ReplayParser(filePath);
      await parser.init();

      const details = parser.getDetails();

      if (!details) {
        throw new Error("Missing replay.details from parsed MPQ archive");
      }

      const trackerEvents = parser.getTrackerEvents();
      const initData = parser.getInitData();

      // ── 1. Build match metadata ──
      const header = parser.getHeader();
      const version = (header?.m_version ?? {}) as Record<string, number>;
      const replayVersion: ReplayVersion = {
        m_flags: version.m_flags ?? 0,
        m_major: version.m_major ?? 0,
        m_minor: version.m_minor ?? 0,
        m_revision: version.m_revision ?? 0,
        m_build: version.m_baseBuild ?? parser.getBuild(),
        m_baseBuild: version.m_baseBuild ?? parser.getBuild(),
      };

      const firstToon = details.m_playerList.find((p) => p?.m_toon)?.m_toon;

      const match: MatchStat = {
        version: replayVersion,
        map: bufStr(details.m_title),
        isBlizzardMap: details.m_isBlizzardMap,
        timeLocalOffset: Number(details.m_timeLocalOffset),
        gameSpeed: details.m_gameSpeed,
        date: this.fileTimeToDate(details.m_timeUTC).toISOString(),
        rawDate: Number(details.m_timeUTC),
        length: 0,
        winner: -1,
        region: firstToon?.m_region,
        playerIDs: [],
        heroes: [],
        levelTimes: { "0": {}, "1": {} },
        bans: { "0": [], "1": [] },
        picks: { 0: [], 1: [], first: -1 },
        XPBreakdown: [],
        takedowns: [],
        mercs: { captures: [], units: {} },
        team0Takedowns: 0,
        team1Takedowns: 0,
        structures: {},
        objective: {
          0: { count: 0, events: [] },
          1: { count: 0, events: [] },
          type: "",
        },
        teams: {
          "0": this.emptyTeam(),
          "1": this.emptyTeam(),
        },
        winningPlayers: [],
        levelAdvTimeline: [],
        firstPickWin: false,
      };
      match.objective.type = match.map || "";

      // ── 2. Build players from details ──
      // Keyed by ToonHandle; AI players all share one, so the k-th repeat of
      // a handle is keyed `<handle>:<k>`. The tracker maps human PlayerInits by
      // handle and computer ones (no handle) by lobby slot (`slotKeys`).
      const players: Record<string, PlayerStat> = {};
      const detailsKeys: (string | undefined)[] = [];
      const slotKeys: Record<number, string> = {};
      const handleSeen: Record<string, number> = {};
      for (const pdata of details.m_playerList) {
        if (!pdata?.m_toon) {
          detailsKeys.push(undefined);
          continue;
        }
        const toon = pdata.m_toon;
        const programId = bufStr(toon.m_programId);
        const toonHandle = `${toon.m_region}-${programId}-${toon.m_realm}-${toon.m_id}`;
        const seen = handleSeen[toonHandle] ?? 0;
        handleSeen[toonHandle] = seen + 1;
        const key = seen === 0 ? toonHandle : `${toonHandle}:${seen}`;
        const slot =
          typeof pdata.m_workingSetSlotId === "number"
            ? pdata.m_workingSetSlotId
            : detailsKeys.length;
        slotKeys[slot] = key;
        detailsKeys.push(key);
        const rawHero = bufStr(pdata.m_hero);
        const hero = normalizeHeroName(rawHero) || rawHero;

        players[key] = {
          hero,
          name: bufStr(pdata.m_name),
          uuid: toon.m_id,
          region: toon.m_region,
          realm: toon.m_realm,
          ToonHandle: toonHandle,
          tag: 0,
          team: pdata.m_teamId,
          win: pdata.m_result === 1,
          skin: "",
          mount: "",
          banner: "",
          spray: "",
          clanTag: "",
          highestLeague: 0,
          combinedRaceLevels: 0,
          randomSeed: 0,
          announcer: "",
          silenced: false,
          voiceSilenced: false,
          gameStats: {},
          awards: [],
          talents: {},
          takedowns: [],
          deaths: [],
          units: {},
        };

        match.playerIDs.push(key);
        match.heroes.push(hero);
      }

      // ── 3. Extract BattleTags ──
      this.extractBattleTags(parser, detailsKeys, players);

      // ── 4. Extract mode (and game options) from initData; picks come in 5b ──
      this.extractDraft(initData, match);

      // ── 4b. Extract cosmetics (skin, mount, announcer) from initData ──
      this.extractCosmetics(initData, details, detailsKeys, players, match);

      // ── 5. Process all tracker events ──
      const { playerIDMap, picks } = processTrackerEvents(
        trackerEvents,
        players,
        match,
        slotKeys,
      );

      // ── 5b. Picks (after hero recovery): draft order and first pick from
      //        the pick events, else player order ──
      this.applyDraftOrder(picks, details, match, players);

      // ── 6. Extract score results + talents + awards ──
      this.processScoreEvents(trackerEvents, playerIDMap, players);

      // ── 7. Finalize teams & winner ──
      for (const [toon, p] of Object.entries(players)) {
        if (p.win) {
          match.winner = p.team;
          match.winningPlayers.push(toon);
        }
        const teamData = match.teams[p.team.toString()];
        if (teamData) {
          teamData.level = Math.max(teamData.level, p.gameStats["Level"] || 0);
          teamData.ids.push(toon);
        }
      }

      // ── 8. Compute all analytics ──
      computeAnalytics(match, players);

      return parser.warnings.length > 0
        ? { status: 1, match, players, warnings: [...parser.warnings] }
        : { status: 1, match, players };
    } catch (error) {
      console.error("ReplayAnalyzer Error:", error);
      return { status: -2, error: String(error) };
    }
  }

  /**
   * Chat lines (`SChatMessage` only) with their senders. Separate from
   * `analyze` so chat text never rides along in `AnalysisResult`. Never throws.
   */
  static readChat(source: string | Buffer): ChatResult {
    try {
      const parser = new ReplayParser(source);
      parser.init();

      const details = parser.getDetails();
      if (!details) throw new Error("Missing replay.details from parsed MPQ archive");
      const lobby = parser.getInitData()?.m_syncLobbyState;

      // Details players by lobby slot (list index on builds without
      // `m_workingSetSlotId`, as in `analyze`), with BattleTags found the same way.
      const humans = details.m_playerList
        .map((p, i) => ({
          p,
          slot: typeof p?.m_workingSetSlotId === "number" ? p.m_workingSetSlotId : i,
        }))
        .filter(({ p }) => p?.m_toon);
      const lobbyBuf = parser.extractFile("replay.server.battlelobby");
      const tags = lobbyBuf
        ? findBattleTagNumbers(lobbyBuf, humans.map(({ p }) => bufStr(p.m_name)))
        : [];
      const bySlot = new Map<number, { hero: string | null; rawHero: string; team: number; tag: number }>();
      humans.forEach(({ p, slot }, i) => {
        const rawHero = bufStr(p.m_hero);
        bySlot.set(slot, {
          hero: normalizeHeroName(rawHero),
          rawHero,
          team: p.m_teamId,
          tag: tags[i] ?? 0,
        });
      });

      const senders = new Map<number, ChatPlayer | null>();
      const sender = (userId: number | undefined): ChatPlayer | null => {
        if (userId === undefined) return null;
        if (senders.has(userId)) return senders.get(userId)!;
        const user = lobby?.m_userInitialData?.[userId];
        const slot = lobby?.m_lobbyState?.m_slots?.find((s) => s.m_userId === userId);
        let player: ChatPlayer | null = null;
        if (user || slot) {
          const name = bufStr(user?.m_name);
          const observer = (slot?.m_observe ?? user?.m_observe ?? 0) !== 0;
          player = { name, observer };
          const inGame = observer ? undefined : bySlot.get(slot?.m_workingSetSlotId ?? -1);
          if (inGame) {
            // `details.m_hero` is the client's display name; when it isn't recognised (e.g. another
            // language) the lobby slot's hero id is.
            player.hero =
              inGame.hero ?? normalizeHeroName(bufStr(slot?.m_hero)) ?? inGame.rawHero;
            player.team = inGame.team;
            if (inGame.tag && name) player.battleTag = `${name}#${inGame.tag}`;
          }
        }
        senders.set(userId, player);
        return player;
      };

      // Time base: the GatesOpen loop, as in `analyze` (0 when absent).
      let gatesOpen = 0;
      try {
        for (const ev of parser.iterTrackerEvents()) {
          if (
            ev._event === "NNet.Replay.Tracker.SStatGameEvent" &&
            bufStr(ev.m_eventName) === "GatesOpen"
          ) {
            gatesOpen = ev._gameloop;
            break;
          }
        }
      } catch (error) {
        parser.warnings.push(
          `replay.tracker.events: ${String(error)}; chat times count from the replay start`,
        );
      }

      const messages: ChatMessage[] = [];
      for (const ev of parser.getMessageEvents()) {
        if (ev._event !== "NNet.Game.SChatMessage") continue;
        messages.push({
          gameloop: ev._gameloop,
          time: (ev._gameloop - gatesOpen) / 16,
          recipient: CHAT_RECIPIENTS[Number(ev.m_recipient)] ?? "other",
          text: bufStr(ev.m_string),
          player: sender(ev._userid),
        });
      }

      return parser.warnings.length > 0
        ? { status: 1, messages, warnings: [...parser.warnings] }
        : { status: 1, messages };
    } catch (error) {
      return { status: -2, error: String(error) };
    }
  }

  private static emptyTeam(): TeamStat {
    return {
      level: 0,
      takedowns: 0,
      ids: [],
      names: [],
      heroes: [],
      tags: [],
      stats: {
        mercCaptures: 0,
        mercUptime: 0,
        mercUptimePercent: 0,
        structures: {},
        KDA: 0,
        PPK: 0,
        timeTo10: 0,
        totals: {
          DamageTaken: 0,
          CreepDamage: 0,
          Healing: 0,
          HeroDamage: 0,
          MinionDamage: 0,
          SelfHealing: 0,
          SiegeDamage: 0,
          ProtectionGivenToAllies: 0,
          TeamfightDamageTaken: 0,
          TeamfightHealingDone: 0,
          TeamfightHeroDamage: 0,
          TimeCCdEnemyHeroes: 0,
          TimeRootingEnemyHeroes: 0,
          TimeSpentDead: 0,
          TimeStunningEnemyHeroes: 0,
          TimeSilencingEnemyHeroes: 0,
          avgTimeSpentDead: 0,
          timeDeadPct: 0,
        },
        levelAdvTime: 0,
        maxLevelAdv: 0,
        avgLevelAdv: 0,
        levelAdvPct: 0,
        uptime: [],
        uptimeHistogram: {},
        wipes: 0,
        avgHeroesAlive: 0,
        aces: 0,
        timeWithHeroAdv: 0,
        pctWithHeroAdv: 0,
        passiveXPRate: 0,
        passiveXPDiff: 0,
        passiveXPGain: 0,
      },
    };
  }

  private static extractBattleTags(
    parser: ReplayParser,
    detailsKeys: (string | undefined)[],
    players: Record<string, PlayerStat>,
  ): void {
    const battleLobbyBuf = parser.extractFile("replay.server.battlelobby");
    if (!battleLobbyBuf) return;
    const keys = detailsKeys.filter((k): k is string => !!k);
    const tags = findBattleTagNumbers(
      battleLobbyBuf,
      keys.map((k) => players[k].name),
    );
    keys.forEach((key, i) => {
      if (tags[i]) players[key].tag = tags[i];
    });
  }

  private static extractDraft(
    initData: RawInitData | null,
    match: MatchStat,
  ): void {
    if (!initData) return;
    try {
      const syncLobby = initData.m_syncLobbyState;
      if (!syncLobby) return;
      const lobbyState = syncLobby.m_lobbyState;
      const gameDesc = syncLobby.m_gameDescription;
      if (!lobbyState) return;

      if (gameDesc) {
        match.randomValue = gameDesc.m_randomValue;
        match.gameOptions = gameDesc.m_gameOptions as unknown as Record<
          string,
          boolean | number
        >;
      }

      // Extract game mode if available
      let foundMode: string | undefined = undefined;

      // New format check: m_ammId
      const gameOptions = gameDesc?.m_gameOptions;
      if (gameOptions && typeof gameOptions.m_ammId === "number") {
        foundMode = AMM_MODES[gameOptions.m_ammId];
      }

      // Old format fallback: m_gameMode
      if (!foundMode && typeof lobbyState.m_gameMode === "number") {
        const gm = lobbyState.m_gameMode;
        if (gm === 3) foundMode = "Quick Match";
        else if (gm === 4) foundMode = "Custom";
        else if (gm === 5) foundMode = "Hero League";
        else if (gm === 6) foundMode = "Team League";
        else if (gm === 7) foundMode = "Unranked Draft";
        else if (gm === 8) foundMode = "ARAM";
      }

      match.mode = foundMode;

      // Try to get game type
      if (typeof lobbyState.m_gameType === "number") {
        match.type = lobbyState.m_gameType;
      }
    } catch {
      // Draft extraction can fail for non-draft modes
    }
  }

  /**
   * `match.picks`: each team's heroes in player order (after hero recovery),
   * replaced by the draft order from `SHeroPickedEvent` (team via the details
   * player) and the first-pick team for a complete draft: 10 picks in the
   * 1-2-2-2-2-1 pattern whose heroes are each team's final heroes. Otherwise
   * `first` is -1.
   */
  private static applyDraftOrder(
    picks: DraftPick[],
    details: RawDetails,
    match: MatchStat,
    players: Record<string, PlayerStat>,
  ): void {
    const byTeam: Record<0 | 1, string[]> = { 0: [], 1: [] };
    match.playerIDs.forEach((key, i) => {
      const team = players[key]?.team;
      if (team === 0 || team === 1) byTeam[team].push(match.heroes[i]);
    });
    match.picks = { 0: byTeam[0], 1: byTeam[1], first: -1 };
    if (picks.length !== 10) return;
    const teams = picks.map((p) => details.m_playerList[p.player]?.m_teamId);
    const pattern = teams.join("");
    if (pattern !== "0110011001" && pattern !== "1001100110") return;
    const ordered: Record<0 | 1, string[]> = { 0: [], 1: [] };
    picks.forEach((p, i) =>
      ordered[teams[i] as 0 | 1].push(normalizeHeroName(p.hero) ?? p.hero),
    );
    const sameSet = (a: string[], b: string[]) =>
      a.length === b.length && [...a].sort().join() === [...b].sort().join();
    if (!sameSet(ordered[0], match.picks[0]) || !sameSet(ordered[1], match.picks[1])) {
      return;
    }
    match.picks = { 0: ordered[0], 1: ordered[1], first: teams[0] as number };
  }

  private static extractCosmetics(
    initData: RawInitData | null,
    details: RawDetails,
    detailsKeys: (string | undefined)[],
    players: Record<string, PlayerStat>,
    match: MatchStat,
  ): void {
    if (!initData) return;
    try {
      const syncLobby = initData.m_syncLobbyState;
      if (!syncLobby) return;
      const lobbyState = syncLobby.m_lobbyState;
      if (!lobbyState) return;
      const slots = lobbyState.m_slots;
      const users = syncLobby.m_userInitialData;
      if (!slots) return;

      // Match slots to players by iterating details.m_playerList in order
      // Slots and m_playerList share the same ordering
      let slotIndex = 0;
      for (let d = 0; d < details.m_playerList.length; d++) {
        const key = detailsKeys[d];
        if (!key) continue;
        const player = players[key];

        // Find the matching slot – walk through slots that have a hero
        while (slotIndex < slots.length) {
          const slot = slots[slotIndex];
          slotIndex++;

          // Skip observer/empty slots (no hero set)
          const slotHero = slot.m_hero;
          if (
            !slotHero ||
            (Buffer.isBuffer(slotHero) && slotHero.length === 0)
          ) {
            continue;
          }

          if (player) {
            // Fallback: If hero is missing from details, extract it from the slot!
            if (!player.hero || player.hero === "") {
              const recoveredHero = normalizeHeroName(bufStr(slotHero));
              if (recoveredHero) {
                player.hero = recoveredHero;
                // Same index as the player in match.playerIDs
                const heroIdx = match.playerIDs.indexOf(key);
                if (heroIdx !== -1) match.heroes[heroIdx] = recoveredHero;
              }
            }

            player.skin = bufStr(slot.m_skin) || "";
            player.mount = bufStr(slot.m_mount) || "";
            player.announcer = bufStr(slot.m_announcerPack) || "";
            player.banner = bufStr(slot.m_banner) || "";
            player.spray = bufStr(slot.m_spray) || "";
            player.silenced = !!slot.m_hasSilencePenalty;
            player.voiceSilenced = !!slot.m_hasVoiceSilencePenalty;

            if (users) {
              const userInit = users.find(
                (u) => bufStr(u.m_name) === player.name,
              );
              if (userInit) {
                player.clanTag = bufStr(userInit.m_clanTag);
                player.highestLeague = userInit.m_highestLeague;
                player.combinedRaceLevels = userInit.m_combinedRaceLevels;
                player.randomSeed = userInit.m_randomSeed;
              }
            }
          }
          break;
        }
      }
    } catch {
      // Cosmetics extraction is non-critical
    }
  }

  private static processScoreEvents(
    trackerEvents: { _event: string; [key: string]: unknown }[],
    playerIDMap: Record<number, string>,
    players: Record<string, PlayerStat>,
  ): void {
    for (const event of trackerEvents) {
      if (event._event !== "NNet.Replay.Tracker.SScoreResultEvent") continue;
      const instanceList = event.m_instanceList as {
        m_name: Buffer;
        m_values: { m_value: number }[][];
      }[];
      for (const stat of instanceList) {
        const statName = bufStr(stat.m_name);
        const vals = stat.m_values;
        const isAward = statName.startsWith("EndOfMatchAward");
        let realIndex = 0;

        for (const v of vals) {
          if (v && v.length > 0 && v[0] !== undefined) {
            const pid = realIndex + 1;
            const toon = playerIDMap[pid];
            if (toon && players[toon]) {
              const val =
                typeof v[0] === "object" && v[0] !== null && "m_value" in v[0]
                  ? v[0].m_value
                  : v[0];
              if (val !== undefined && val !== null) {
                if (isAward) {
                  if (val === 1) {
                    players[toon].awards.push(statName);
                  }
                } else {
                  players[toon].gameStats[statName] = val as number;
                }
              }
            }
            realIndex++;
          } else if (v && v.length === 0) {
            realIndex++;
          }
        }
      }
    }
  }

  private static fileTimeToDate(fileTime: number): Date {
    return new Date(fileTime / 10000 - 11644473600000);
  }
}
