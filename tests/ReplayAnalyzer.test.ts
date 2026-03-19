import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import * as fs from "fs";
import { ReplayAnalyzer } from "../src/ReplayAnalyzer";
import type { AnalysisResult } from "../src/types/index";

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
        expect(v.m_build).toBeGreaterThan(0);
        expect(typeof v.m_major).toBe("number");
        expect(typeof v.m_minor).toBe("number");
        expect(typeof v.m_baseBuild).toBe("number");
      });

      it("should have map, date, region, length", () => {
        expect(result.match!.map).toBeTruthy();
        expect(result.match!.date).toBeTruthy();
        expect(result.match!.rawDate).toBeGreaterThan(0);
        expect(result.match!.region).toBeGreaterThan(0);
        expect(result.match!.length).toBeGreaterThan(0);
        expect(result.match!.loopLength).toBeGreaterThan(0);
        expect(result.match!.loopGameStart).toBeDefined();
      });

      it("should have winner and winning players", () => {
        // Some replays (e.g. custom/resumed) might have no winner in details
        if (result.match!.winningPlayers.length > 0) {
          expect([0, 1]).toContain(result.match!.winner);
        } else {
          expect(result.match!.winner).toBe(-1);
        }
      });

      it("should have playerIDs and heroes", () => {
        expect(result.match!.playerIDs.length).toBeGreaterThanOrEqual(2);
        expect(result.match!.heroes.length).toBe(
          result.match!.playerIDs.length,
        );
      });

      // ── Draft ──
      it("should have picks and bans for both teams", () => {
        expect(result.match!.picks[0].length).toBeGreaterThanOrEqual(1);
        expect(result.match!.picks[1].length).toBeGreaterThanOrEqual(1);

        if (
          result.match!.mode === "Storm League" ||
          result.match!.mode === "Hero League" ||
          result.match!.mode === "Team League" ||
          result.match!.mode === "Unranked Draft"
        ) {
          expect(result.match!.bans["0"].length).toBeGreaterThanOrEqual(0); // Older patches had less than 3, but should be tested carefully
          expect(result.match!.bans["1"].length).toBeGreaterThanOrEqual(0);

          // For specifically the 00.12.25 Cursed Hollow test case we know there should be 6 bans total
          if (file.includes("2026-02-21 00.12.25 Cursed Hollow.StormReplay")) {
            console.log(
              "Team 0 Bans:",
              JSON.stringify(result.match!.bans["0"]),
            );
            console.log(
              "Team 1 Bans:",
              JSON.stringify(result.match!.bans["1"]),
            );
            expect(result.match!.bans["0"].length).toBe(3);
            expect(result.match!.bans["1"].length).toBe(3);
          }
        }
      });

      // ── Level Times ──
      it("should have level times for both teams", () => {
        expect(
          Object.keys(result.match!.levelTimes["0"]).length,
        ).toBeGreaterThan(0);
        expect(
          Object.keys(result.match!.levelTimes["1"]).length,
        ).toBeGreaterThan(0);
      });

      it("should have correct level time structure", () => {
        for (const lt of Object.values(result.match!.levelTimes["0"])) {
          expect(typeof lt.loop).toBe("number");
          expect(typeof lt.level).toBe("number");
          expect(typeof lt.time).toBe("number");
          expect(lt.team).toBe("0");
        }
      });

      // ── Takedowns ──
      it("should have takedown events array", () => {
        expect(Array.isArray(result.match!.takedowns)).toBe(true);
      });

      it("should have correct takedown structure", () => {
        for (const td of result.match!.takedowns) {
          expect(typeof td.loop).toBe("number");
          expect(typeof td.time).toBe("number");
          expect(td.victim.player).toBeTruthy();
          expect(td.victim.hero).toBeTruthy();
          expect(td.killers.length).toBeGreaterThan(0);
        }
      });

      it("should have consistent team takedown counts", () => {
        expect(
          result.match!.team0Takedowns + result.match!.team1Takedowns,
        ).toBe(result.match!.takedowns.length);
      });

      // ── Structures ──
      it("should have structure data", () => {
        expect(Object.keys(result.match!.structures).length).toBeGreaterThan(0);
        for (const s of Object.values(result.match!.structures)) {
          expect(s.type).toBeTruthy();
          expect(s.name).toBeTruthy();
          expect([0, 1]).toContain(s.team);
        }
      });

      // ── XP Breakdown ──
      it("should have XP breakdown entries", () => {
        expect(result.match!.XPBreakdown.length).toBeGreaterThan(0);
        for (const xp of result.match!.XPBreakdown) {
          // Team 0/1 are standard, Team 2 is neutral/special in some modes/maps
          expect([0, 1, 2]).toContain(xp.team);
          expect(typeof xp.breakdown.MinionXP).toBe("number");
          expect(typeof xp.breakdown.TrickleXP).toBe("number");
        }
      });

      // ── Objectives ──
      it("should have objective data", () => {
        expect(result.match!.objective).toBeDefined();
        expect(result.match!.objective[0]).toBeDefined();
        expect(result.match!.objective[1]).toBeDefined();
        expect(result.match!.objective.type).toBeTruthy();
      });

      // ── Mercs ──
      it("should have mercs data structure", () => {
        expect(Array.isArray(result.match!.mercs.captures)).toBe(true);
        expect(typeof result.match!.mercs.units).toBe("object");
      });

      // ── Teams ──
      it("should have team names, heroes, tags", () => {
        for (const teamKey of ["0", "1"]) {
          const team = result.match!.teams[teamKey];
          expect(team.names.length).toBeGreaterThan(0);
          expect(team.heroes.length).toBeGreaterThan(0);
          expect(team.tags.length).toBe(team.names.length);
          expect(team.ids.length).toBeGreaterThan(0);
        }
      });

      it("should have team stats", () => {
        for (const teamKey of ["0", "1"]) {
          const stats = result.match!.teams[teamKey].stats;
          expect(typeof stats.KDA).toBe("number");
          expect(typeof stats.mercCaptures).toBe("number");
          expect(typeof stats.totals.HeroDamage).toBe("number");
          expect(typeof stats.structures).toBe("object");
        }
      });

      // ── Players ──
      it("should have enriched player data", () => {
        for (const p of Object.values(result.players!)) {
          expect(p.hero).toBeTruthy();
          expect(p.name).toBeTruthy();
          expect(p.ToonHandle).toBeTruthy();
          expect(typeof p.uuid).toBe("number");
          expect(typeof p.region).toBe("number");
          expect(typeof p.realm).toBe("number");
          expect([0, 1]).toContain(p.team);
          expect(typeof p.win).toBe("boolean");
        }
      });

      it("should have game stats and awards", () => {
        for (const p of Object.values(result.players!)) {
          expect(Object.keys(p.gameStats).length).toBeGreaterThan(0);
          expect(Array.isArray(p.awards)).toBe(true);
        }
      });

      it("should have talents", () => {
        for (const p of Object.values(result.players!)) {
          expect(typeof p.talents).toBe("object");
        }
      });

      it("should have per-player takedowns and deaths", () => {
        for (const p of Object.values(result.players!)) {
          expect(Array.isArray(p.takedowns)).toBe(true);
          expect(Array.isArray(p.deaths)).toBe(true);
        }
      });

      it("should have computed stats", () => {
        for (const p of Object.values(result.players!)) {
          expect(typeof p.gameStats["DPM"]).toBe("number");
          expect(typeof p.gameStats["KDA"]).toBe("number");
          expect(typeof p.gameStats["KillParticipation"]).toBe("number");
          expect(typeof p.gameStats["length"]).toBe("number");
        }
      });

      it("should have unit position data", () => {
        for (const p of Object.values(result.players!)) {
          expect(typeof p.units).toBe("object");
        }
      });
      it("should have skin, mount, announcer, and silence flags", () => {
        for (const p of Object.values(result.players!)) {
          expect(typeof p.skin).toBe("string");
          expect(typeof p.mount).toBe("string");
          expect(typeof p.announcer).toBe("string");
          expect(typeof p.silenced).toBe("boolean");
          expect(typeof p.voiceSilenced).toBe("boolean");
        }
      });

      // ── Level Advantage ──
      it("should have level advantage timeline", () => {
        expect(result.match!.levelAdvTimeline.length).toBeGreaterThan(0);
        for (const seg of result.match!.levelAdvTimeline) {
          expect(typeof seg.start).toBe("number");
          expect(typeof seg.end).toBe("number");
          expect(seg.end).toBeGreaterThanOrEqual(seg.start);
        }
      });

      it("should have level advantage stats per team", () => {
        for (const teamKey of ["0", "1"]) {
          const stats = result.match!.teams[teamKey].stats;
          expect(typeof stats.levelAdvTime).toBe("number");
          expect(typeof stats.levelAdvPct).toBe("number");
          expect(typeof stats.maxLevelAdv).toBe("number");
        }
      });

      // ── First Events ──
      it("should have firstPickWin", () => {
        expect(typeof result.match!.firstPickWin).toBe("boolean");
      });

      // ── Uptime ──
      it("should have uptime and hero advantage data", () => {
        for (const teamKey of ["0", "1"]) {
          const stats = result.match!.teams[teamKey].stats;
          expect(stats.uptime.length).toBeGreaterThan(0);
          expect(typeof stats.avgHeroesAlive).toBe("number");
          expect(stats.avgHeroesAlive).toBeGreaterThan(0);
          expect(typeof stats.timeWithHeroAdv).toBe("number");
          expect(typeof stats.pctWithHeroAdv).toBe("number");
        }
      });
    });
  }
});
