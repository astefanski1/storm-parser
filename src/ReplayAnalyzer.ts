import { ReplayParser } from "./ReplayParser.js";
import type {
  AnalysisResult,
  MatchStat,
  PlayerStat,
  ReplayVersion,
  TeamStat,
  RawDetails,
  RawInitData,
} from "./types/index.js";
import { processTrackerEvents } from "./analyzers/trackerProcessor.js";
import { computeAnalytics } from "./analyzers/analyticsComputer.js";
import { normalizeHeroName } from "./analyzers/heroesList.js";

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
        picks: { 0: [], 1: [], first: 0 },
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
      const players: Record<string, PlayerStat> = {};
      for (const pdata of details.m_playerList) {
        if (!pdata?.m_toon) continue;
        const toon = pdata.m_toon;
        const programId = bufStr(toon.m_programId);
        const toonHandle = `${toon.m_region}-${programId}-${toon.m_realm}-${toon.m_id}`;
        const rawHero = bufStr(pdata.m_hero);
        const hero = normalizeHeroName(rawHero) || rawHero;

        players[toonHandle] = {
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

        match.playerIDs.push(toonHandle);
        match.heroes.push(hero);
      }

      // ── 3. Extract BattleTags ──
      this.extractBattleTags(parser, details, players);

      // ── 4. Extract draft (bans & picks) from initData ──
      this.extractDraft(initData, match, details);

      // ── 4b. Extract cosmetics (skin, mount, announcer) from initData ──
      this.extractCosmetics(initData, details, players, match);

      // ── 5. Process all tracker events ──
      const { playerIDMap } = processTrackerEvents(
        trackerEvents,
        players,
        match,
      );

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

      return { status: 1, match, players };
    } catch (error) {
      console.error("ReplayAnalyzer Error:", error);
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
    details: RawDetails,
    players: Record<string, PlayerStat>,
  ): void {
    const battleLobbyBuf = parser.extractFile("replay.server.battlelobby");
    if (!battleLobbyBuf) return;
    try {
      const btagRegExp = new RegExp("([\\p{L}\\d]{3,24}#\\d{4,10})[zØ]?", "gu");
      const matches = battleLobbyBuf.toString("utf8").match(btagRegExp);
      if (!matches) return;
      let matchIndex = 0;
      for (const pdata of details.m_playerList) {
        if (!pdata?.m_toon) continue;
        const name = bufStr(pdata.m_name);
        while (matchIndex < matches.length) {
          const m = matches[matchIndex];
          const parts = m.split("#");
          const mName = parts[0];
          const mTag = parts[1].replace(/[zØ]/g, "");
          matchIndex++;
          if (mName === name) {
            const toon = pdata.m_toon;
            const toonHandle = `${toon.m_region}-${bufStr(toon.m_programId)}-${toon.m_realm}-${toon.m_id}`;
            if (players[toonHandle]) {
              players[toonHandle].tag = parseInt(mTag, 10) || 0;
            }
            break;
          }
        }
      }
    } catch (e) {
      console.error("BattleTag regex error:", e);
    }
  }

  private static extractDraft(
    initData: RawInitData | null,
    match: MatchStat,
    details: RawDetails,
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

      // Extract picks from details player list (ordered by slot)
      const team0Picks: string[] = [];
      const team1Picks: string[] = [];
      for (const pdata of details.m_playerList) {
        if (!pdata?.m_toon) continue;
        const rawHero = bufStr(pdata.m_hero);
        const hero = normalizeHeroName(rawHero) || rawHero;
        if (pdata.m_teamId === 0) team0Picks.push(hero);
        else if (pdata.m_teamId === 1) team1Picks.push(hero);
      }
      match.picks = { 0: team0Picks, 1: team1Picks, first: 0 };

      // Extract game mode if available
      let foundMode: string | undefined = undefined;

      // New format check: m_ammId
      const gameOptions = gameDesc?.m_gameOptions;
      if (gameOptions && typeof gameOptions.m_ammId === "number") {
        const ammId = gameOptions.m_ammId;
        if (ammId === 50001) foundMode = "Quick Match";
        else if (ammId === 50031) foundMode = "ARAM";
        else if (ammId === 50041) foundMode = "Unranked Draft";
        else if (ammId === 50051) foundMode = "Custom";
        else if (ammId === 50061) foundMode = "Hero League";
        else if (ammId === 50071) foundMode = "Team League";
        else if (ammId === 50091) foundMode = "Storm League";
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

      // Extract bans from lobby slots or other sources
      const slots = lobbyState.m_slots;
      if (!slots) return;

      // Check for ban data in lobby state
      const pickBans = lobbyState.m_pickedMapTag as number | undefined;
      let firstPickTeam = 0;
      if (pickBans !== undefined) {
        // First pick determination from lobby state
        firstPickTeam = (lobbyState.m_firstPickTeam ?? 0) as number;
        match.picks.first = firstPickTeam;
      }
    } catch {
      // Draft extraction can fail for non-draft modes
    }
  }

  private static extractCosmetics(
    initData: RawInitData | null,
    details: RawDetails,
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
      for (const pdata of details.m_playerList) {
        if (!pdata?.m_toon) continue;
        const toon = pdata.m_toon;
        const toonHandle = `${toon.m_region}-${bufStr(toon.m_programId)}-${toon.m_realm}-${toon.m_id}`;
        const player = players[toonHandle];

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
                // Also update match-level list if possible (O(N) search)
                const heroIdx = match.heroes.indexOf("");
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

  private static fileTimeToDate(fileTime: bigint | number): Date {
    return new Date(Number(fileTime) / 10000 - 11644473600000);
  }
}
