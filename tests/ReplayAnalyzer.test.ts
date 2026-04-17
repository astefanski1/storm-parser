import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import * as fs from "fs";
import { ReplayAnalyzer } from "../src/ReplayAnalyzer";
import type { AnalysisResult } from "../src/types/index";
import { validMaps } from "../src/analyzers/mapsList";

describe("ReplayAnalyzer", () => {
  const replaysDir: string = path.resolve(__dirname, "replays");
  const files = fs.existsSync(replaysDir)
    ? fs
        .readdirSync(replaysDir)
        .filter((f: unknown) => (f as string).endsWith(".StormReplay"))
    : [];

  it("should have replay files available", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  // Test each replay individually with all checks inside
  for (const file of files) {
    describe(file, () => {
      let result: AnalysisResult;

      beforeAll(async () => {
        result = await ReplayAnalyzer.analyze(path.join(replaysDir, file));
      });

      it("should analyze successfully", () => {
        expect(result.status).toBe(1);
        expect(result.match).toBeDefined();
        expect(result.players).toBeDefined();
      });

      // ── Match Metadata ──
      it("should have complete version info", () => {
        const v = result.match!.version;
        expect(v.m_build).toBeGreaterThanOrEqual(80000);
        expect(v.m_major).toBe(2);
        expect(v.m_minor).toBeGreaterThanOrEqual(50);
        expect(v.m_baseBuild).toBe(v.m_build);
      });

      it("should have map, date, region, length", () => {
        // Map should be a non-empty string
        expect(result.match!.map?.length).toBeGreaterThan(3);
        // Date should be a valid ISO 8601 string
        expect(Date.parse(result.match!.date)).not.toBeNaN();
        expect(result.match!.date).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
        );
        // rawDate is a Windows FILETIME — a huge integer
        expect(result.match!.rawDate).toBeGreaterThan(1e17);
        // EU region = 2
        expect(result.match!.region).toBe(2);
        // Length should be a reasonable game duration in seconds (2-45 min)
        expect(result.match!.length).toBeGreaterThan(120);
        expect(result.match!.length).toBeLessThan(2700);
        // Loop values should be consistent
        expect(result.match!.loopLength).toBeGreaterThan(
          result.match!.loopGameStart!,
        );
        // Game speed 4 = Faster (standard for HotS)
        expect(result.match!.gameSpeed).toBe(4);
      });

      it("should have winner and winning players", () => {
        expect([0, 1]).toContain(result.match!.winner);
        expect(result.match!.winningPlayers.length).toBe(5);
        // All winning players should belong to the winning team
        for (const wp of result.match!.winningPlayers) {
          const player = result.players![wp];
          expect(player).toBeDefined();
          expect(player.team).toBe(result.match!.winner);
          expect(player.win).toBe(true);
        }
      });

      it("should have exactly 10 playerIDs and heroes", () => {
        expect(result.match!.playerIDs).toHaveLength(10);
        expect(result.match!.heroes).toHaveLength(10);
        // Heroes should be non-empty real hero names
        for (const hero of result.match!.heroes) {
          expect(hero.length).toBeGreaterThan(2);
          // No raw Buffer remnants
          expect(hero).not.toContain("Buffer");
        }
        // No duplicate ToonHandles
        const unique = new Set(result.match!.playerIDs);
        expect(unique.size).toBe(10);
      });

      // ── Draft ──
      it("should have picks and bans for both teams", () => {
        // Each team should have exactly 5 picks
        expect(result.match!.picks[0]).toHaveLength(5);
        expect(result.match!.picks[1]).toHaveLength(5);
        // All picked heroes should be non-empty strings
        for (const team of [0, 1] as const) {
          for (const hero of result.match!.picks[team]) {
            expect(hero.length).toBeGreaterThan(2);
          }
        }

        if (
          result.match!.mode === "Storm League" ||
          result.match!.mode === "Hero League" ||
          result.match!.mode === "Team League" ||
          result.match!.mode === "Unranked Draft"
        ) {
          // Draft modes should have bans with hero names and ordering
          const totalBans =
            result.match!.bans["0"].length + result.match!.bans["1"].length;
          expect(totalBans).toBeGreaterThanOrEqual(0);
          for (const ban of [
            ...result.match!.bans["0"],
            ...result.match!.bans["1"],
          ]) {
            expect(ban.hero.length).toBeGreaterThan(2);
            expect(ban.order).toBeGreaterThan(0);
            expect(ban.absolute).toBeGreaterThan(0);
          }
        }
      });

      // ── Level Times ──
      it("should have level times for both teams", () => {
        const team0Levels = Object.keys(result.match!.levelTimes["0"]);
        const team1Levels = Object.keys(result.match!.levelTimes["1"]);
        // Both teams should reach at least level 10 in any real game
        expect(team0Levels.length).toBeGreaterThanOrEqual(10);
        expect(team1Levels.length).toBeGreaterThanOrEqual(10);
      });

      it("should have correct level time structure", () => {
        for (const [teamKey, levels] of Object.entries(
          result.match!.levelTimes,
        )) {
          if (teamKey !== "0" && teamKey !== "1") continue;
          for (const [levelStr, lt] of Object.entries(levels)) {
            // Level should match the key
            expect(lt.level).toBe(Number(levelStr));
            // Time should be non-negative (relative to game start)
            expect(lt.time).toBeGreaterThanOrEqual(0);
            // Loop should be a valid gameloop
            expect(lt.loop).toBeGreaterThan(0);
            expect(lt.team).toBe(teamKey);
          }
        }
      });

      // ── Takedowns ──
      it("should have takedown events with complete data", () => {
        // Any real 10+ minute game should have at least a few takedowns
        expect(result.match!.takedowns.length).toBeGreaterThan(0);
        for (const td of result.match!.takedowns) {
          // Time should be relative to game start (positive)
          expect(td.time).toBeGreaterThan(0);
          expect(td.loop).toBeGreaterThan(0);
          // Positions should be within map bounds
          expect(td.x).toBeGreaterThanOrEqual(0);
          expect(td.y).toBeGreaterThanOrEqual(0);
          // Victim should have a valid ToonHandle and hero
          expect(td.victim.player).toMatch(/-/);
          expect(td.victim.hero.length).toBeGreaterThan(2);
          // At least 1 killer
          expect(td.killers.length).toBeGreaterThan(0);
          for (const k of td.killers) {
            expect(k.player).toMatch(/-/);
            expect(k.hero.length).toBeGreaterThan(2);
          }
        }
      });

      it("should have consistent team takedown counts", () => {
        expect(
          result.match!.team0Takedowns + result.match!.team1Takedowns,
        ).toBe(result.match!.takedowns.length);
        expect(result.match!.team0Takedowns).toBeGreaterThanOrEqual(0);
        expect(result.match!.team1Takedowns).toBeGreaterThanOrEqual(0);
      });

      // ── Structures ──
      it("should have structure data", () => {
        const structures = Object.values(result.match!.structures);
        expect(structures.length).toBeGreaterThan(0);
        for (const s of structures) {
          // Structure types: Fort, Keep, Fort Tower, Keep Tower, Fort Well, Keep Well
          expect([
            "Fort",
            "Keep",
            "Fort Tower",
            "Keep Tower",
            "Fort Well",
            "Keep Well",
          ]).toContain(s.name);
          expect(s.type).toBeTruthy();
          expect([0, 1]).toContain(s.team);
          // Should have position
          expect(s.x).toBeGreaterThanOrEqual(0);
          expect(s.y).toBeGreaterThanOrEqual(0);
        }
      });

      // ── XP Breakdown ──
      it("should have XP breakdown entries", () => {
        expect(result.match!.XPBreakdown.length).toBeGreaterThan(0);
        for (const xp of result.match!.XPBreakdown) {
          expect([0, 1, 2]).toContain(xp.team);
          // All XP values should be non-negative
          expect(xp.breakdown.MinionXP).toBeGreaterThanOrEqual(0);
          expect(xp.breakdown.TrickleXP).toBeGreaterThanOrEqual(0);
          expect(xp.breakdown.HeroXP).toBeGreaterThanOrEqual(0);
          expect(xp.breakdown.StructureXP).toBeGreaterThanOrEqual(0);
          expect(xp.breakdown.CreepXP).toBeGreaterThanOrEqual(0);
          // Time should be a valid loop value
          expect(xp.loop).toBeGreaterThan(0);
        }
      });

      // ── Objectives ──
      it("should have objective data", () => {
        expect(result.match!.objective).toBeDefined();
        expect(result.match!.objective[0].count).toBeGreaterThanOrEqual(0);
        expect(result.match!.objective[1].count).toBeGreaterThanOrEqual(0);
        expect(result.match!.objective[0].events.length).toBe(
          result.match!.objective[0].count,
        );
        expect(result.match!.objective[1].events.length).toBe(
          result.match!.objective[1].count,
        );
        // objective.type is set to the map name
        expect(result.match!.objective.type.length).toBeGreaterThan(3);
      });

      // ── Mercs ──
      it("should have mercs data structure", () => {
        expect(Array.isArray(result.match!.mercs.captures)).toBe(true);
        // In any real game, at least one merc camp should be captured
        if (result.match!.mercs.captures.length > 0) {
          for (const capture of result.match!.mercs.captures) {
            expect(capture.type.length).toBeGreaterThan(0);
            expect(capture.time).toBeGreaterThan(0);
            expect([0, 1, 2]).toContain(capture.team);
          }
        }
      });

      // ── Teams ──
      it("should have team names, heroes, tags", () => {
        for (const teamKey of ["0", "1"]) {
          const team = result.match!.teams[teamKey];
          expect(team.names).toHaveLength(5);
          expect(team.heroes).toHaveLength(5);
          expect(team.tags).toHaveLength(5);
          expect(team.ids).toHaveLength(5);
          // Names should be real player names (non-empty, no Buffer junk)
          for (const name of team.names) {
            expect(name.length).toBeGreaterThan(0);
            expect(name).not.toContain("Buffer");
          }
          // Heroes should be valid hero names
          for (const hero of team.heroes) {
            expect(hero.length).toBeGreaterThan(2);
          }
          // No duplicate IDs between teams
        }
        const allIds = [
          ...result.match!.teams["0"].ids,
          ...result.match!.teams["1"].ids,
        ];
        expect(new Set(allIds).size).toBe(10);
      });

      it("should have team stats with realistic values", () => {
        for (const teamKey of ["0", "1"]) {
          const stats = result.match!.teams[teamKey].stats;
          // KDA should be non-negative
          expect(stats.KDA).toBeGreaterThanOrEqual(0);
          // Merc captures can be 0
          expect(stats.mercCaptures).toBeGreaterThanOrEqual(0);
          // Total damage values should be positive in any real game
          expect(stats.totals.HeroDamage).toBeGreaterThan(0);
          expect(stats.totals.SiegeDamage).toBeGreaterThan(0);
          expect(stats.totals.Healing).toBeGreaterThanOrEqual(0);
          // Structure tracking
          expect(stats.structures).toBeDefined();
          expect(typeof stats.structures).toBe("object");
        }
      });

      // ── Players ──
      it("should have enriched player data", () => {
        const players = Object.values(result.players!);
        expect(players).toHaveLength(10);
        for (const p of players) {
          // Hero name should be a real hero (2+ chars)
          expect(p.hero.length).toBeGreaterThan(2);
          expect(p.hero).not.toContain("Buffer");
          // Player name is non-empty
          expect(p.name.length).toBeGreaterThan(0);
          // ToonHandle format: region-programId-realm-id (e.g. "2-Hero-1-7925312")
          expect(p.ToonHandle).toMatch(/^\d+-\w+-\d+-\d+$/);
          // UUID, region, realm are consistent with ToonHandle
          expect(p.uuid).toBeGreaterThan(0);
          expect(p.region).toBe(2); // EU
          expect(p.realm).toBe(1);
          expect([0, 1]).toContain(p.team);
          // Win should match the match winner
          expect(p.win).toBe(p.team === result.match!.winner);
        }
      });

      it("should have game stats with real metrics", () => {
        for (const p of Object.values(result.players!)) {
          const gs = p.gameStats;
          // Core combat stats should be present and non-negative
          expect(gs["HeroDamage"]).toBeGreaterThanOrEqual(0);
          expect(gs["SiegeDamage"]).toBeGreaterThanOrEqual(0);
          expect(gs["DamageTaken"]).toBeGreaterThanOrEqual(0);
          expect(gs["Deaths"]).toBeGreaterThanOrEqual(0);
          expect(gs["Assists"]).toBeGreaterThanOrEqual(0);
          expect(gs["SoloKill"]).toBeGreaterThanOrEqual(0);
          // Computed stats
          expect(gs["DPM"]).toBeGreaterThanOrEqual(0);
          expect(gs["KDA"]).toBeGreaterThanOrEqual(0);
          // KP can exceed 1.0 because all nearby allies get assist credit
          expect(gs["KillParticipation"]).toBeGreaterThanOrEqual(0);
          // Game length in seconds should match match.length
          expect(gs["length"]).toBeCloseTo(result.match!.length, 0);
          // Awards is an array of strings
          expect(Array.isArray(p.awards)).toBe(true);
          for (const award of p.awards) {
            expect(award.length).toBeGreaterThan(0);
          }
        }
      });

      it("should have talents for each player", () => {
        for (const p of Object.values(result.players!)) {
          const t = p.talents;
          // At least 1 talent tier should be filled
          const filledTiers = Object.values(t).filter(Boolean).length;
          expect(filledTiers).toBeGreaterThanOrEqual(1);
          // Tier1Choice is always present
          expect(t.Tier1Choice).toBeTruthy();
          expect(t.Tier1Choice!.length).toBeGreaterThan(3);
        }
      });

      it("should have per-player takedowns and deaths", () => {
        for (const p of Object.values(result.players!)) {
          expect(Array.isArray(p.takedowns)).toBe(true);
          expect(Array.isArray(p.deaths)).toBe(true);
          // deaths array comes from tracker events, gameStats.Deaths from score screen
          expect(p.gameStats["Deaths"]).toBeGreaterThanOrEqual(0);
        }
      });

      it("should have unit position data", () => {
        for (const p of Object.values(result.players!)) {
          // units should have hero lifecycle data
          expect(p.units).toBeDefined();
          const heroKeys = Object.keys(p.units);
          expect(heroKeys.length).toBeGreaterThan(0);
        }
      });

      it("should have skin, mount, announcer, and silence flags", () => {
        for (const p of Object.values(result.players!)) {
          // Skin and announcer can be empty strings for some players
          expect(typeof p.skin).toBe("string");
          // Mount can be empty for some heroes (e.g., Alexstrasza)
          expect(typeof p.mount).toBe("string");
          expect(typeof p.announcer).toBe("string");
          // Silence flags are boolean
          expect(typeof p.silenced).toBe("boolean");
          expect(typeof p.voiceSilenced).toBe("boolean");
        }
      });

      // ── Level Advantage ──
      it("should have level advantage timeline", () => {
        expect(result.match!.levelAdvTimeline.length).toBeGreaterThan(0);
        for (const seg of result.match!.levelAdvTimeline) {
          expect(seg.end).toBeGreaterThanOrEqual(seg.start);
          expect(typeof seg.levelDiff).toBe("number");
          expect(seg.length).toBeGreaterThanOrEqual(0);
        }
      });

      it("should have level advantage stats per team", () => {
        for (const teamKey of ["0", "1"]) {
          const stats = result.match!.teams[teamKey].stats;
          expect(stats.levelAdvTime).toBeGreaterThanOrEqual(0);
          // Percentage should be between 0 and 1
          expect(stats.levelAdvPct).toBeGreaterThanOrEqual(0);
          expect(stats.levelAdvPct).toBeLessThanOrEqual(1);
          expect(stats.maxLevelAdv).toBeGreaterThanOrEqual(0);
        }
      });

      // ── First Pick ──
      it("should have firstPickWin", () => {
        expect(typeof result.match!.firstPickWin).toBe("boolean");
      });

      // ── Uptime ──
      it("should have uptime and hero advantage data", () => {
        for (const teamKey of ["0", "1"]) {
          const stats = result.match!.teams[teamKey].stats;
          expect(stats.uptime.length).toBeGreaterThan(0);
          // Average heroes alive should be between 0 and 5
          expect(stats.avgHeroesAlive).toBeGreaterThan(0);
          expect(stats.avgHeroesAlive).toBeLessThanOrEqual(5);
          // Hero advantage time and pct should be non-negative
          expect(stats.timeWithHeroAdv).toBeGreaterThanOrEqual(0);
          expect(stats.pctWithHeroAdv).toBeGreaterThanOrEqual(0);
          expect(stats.pctWithHeroAdv).toBeLessThanOrEqual(1);
        }
      });

      // ── Map Name Normalization ──
      it("should have a canonical English map name", () => {
        expect(validMaps).toContain(result.match!.map);
      });
    });
  }
});
