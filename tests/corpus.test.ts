import { describe, it, expect, beforeAll } from "vitest";
import type { AnalysisResult } from "../src/types/index";
import {
  analyzeReplay,
  isFullDraftGame,
  replayFiles,
  DEATH_ORACLE_EXCLUDED_HEROES,
} from "./helpers/replays";

/**
 * Cross-checks over every replay in the corpus against the score screen
 * (`gameStats`), which the game computes independently of tracker events.
 * Skipped when no replays are present (see tests/helpers/replays.ts).
 */
describe.skipIf(replayFiles.length === 0)("replay corpus oracles", () => {
  let results: { file: string; r: AnalysisResult }[] = [];
  let full: { file: string; r: AnalysisResult }[] = [];

  beforeAll(async () => {
    results = [];
    for (const file of replayFiles) results.push({ file, r: await analyzeReplay(file) });
    full = results.filter(({ r }) => isFullDraftGame(r));
  }, 600_000);

  it("analyzes every replay", () => {
    for (const { file, r } of results) expect(r.status, file).toBe(1);
  });

  it("takedown participants and deaths match the score screen", () => {
    for (const { file, r } of full) {
      const players = Object.values(r.players!);
      if (players.some((p) => DEATH_ORACLE_EXCLUDED_HEROES.includes(p.hero))) continue;
      for (const p of players) {
        expect(p.takedowns.length, `${file} ${p.name} takedowns`).toBe(p.gameStats["Takedowns"]);
        expect(p.deaths.length, `${file} ${p.name} deaths`).toBe(p.gameStats["Deaths"]);
      }
    }
  });

  it("assigns merc captures to the capturing team", () => {
    for (const { file, r } of full) {
      const m = r.match!;
      for (const team of [0, 1]) {
        const captures = m.mercs.captures.filter((c) => c.team === team).length;
        const best = Math.max(
          ...Object.values(r.players!)
            .filter((p) => p.team === team)
            .map((p) => p.gameStats["MercCampCaptures"] ?? 0),
        );
        expect(best, `${file} team ${team}`).toBeLessThanOrEqual(captures);
      }
    }
  });

  it("reports XP per team in XP points", () => {
    const ratios: number[] = [];
    for (const { file, r } of full) {
      const finals = r.match!.XPBreakdown.filter((e) => e.final);
      expect(finals.map((e) => e.team).sort(), file).toEqual([0, 1]);
      for (const e of finals) {
        const b = e.breakdown;
        const earned = b.MinionXP + b.CreepXP + b.StructureXP + b.HeroXP;
        const contribution = Object.values(r.players!)
          .filter((p) => p.team === e.team)
          .reduce((s, p) => s + (p.gameStats["ExperienceContribution"] ?? 0), 0);
        ratios.push(contribution / earned);
      }
    }
    if (ratios.length === 0) return;
    ratios.sort((a, b) => a - b);
    const median = ratios[Math.floor(ratios.length / 2)];
    expect(median).toBeGreaterThan(0.9);
    expect(median).toBeLessThan(1.1);
  });

  it("uses the draft order and first-pick team", () => {
    for (const { file, r } of full) {
      const picks = r.match!.picks;
      expect([0, 1], file).toContain(picks.first);
      expect(r.match!.firstPickWin, file).toBe(picks.first === r.match!.winner);
      for (const team of [0, 1] as const) {
        const heroes = r.match!.teams[String(team)].heroes;
        expect([...picks[team]].sort(), file).toEqual([...heroes].sort());
      }
    }
  });

  it("gives objective events a team 0/1 on maps that have them", () => {
    const noTrackerObjective = ["Garden of Terror", "Alterac Pass", "Hanamura Temple", "Braxis Holdout"];
    for (const { file, r } of full) {
      const m = r.match!;
      const events = [...m.objective[0].events, ...m.objective[1].events];
      if (!noTrackerObjective.includes(m.map ?? "")) {
        expect(events.length, file).toBeGreaterThan(0);
      }
      for (const team of [0, 1] as const) {
        expect(m.objective[team].count).toBe(m.objective[team].events.length);
        for (const e of m.objective[team].events) {
          expect(e.team).toBe(team);
          expect(e.name).toBeTruthy();
          if (e.endLoop !== undefined) expect(e.endLoop).toBeGreaterThanOrEqual(e.loop);
        }
      }
    }
  });

  it("builds one life per spawn whose dead time matches the score screen", () => {
    let checked = 0;
    let close = 0;
    for (const { r } of full) {
      for (const p of Object.values(r.players!)) {
        const lives = Object.values(p.units)[0]?.lives ?? [];
        expect(lives.length).toBeGreaterThanOrEqual(1);
        expect(lives.filter((l) => l.died !== undefined).length).toBe(p.deaths.length);
        // Dead time between lives; a final death counts to the end of the game
        let dead = 0;
        lives.forEach((l, i) => {
          if (l.died === undefined) return;
          const next = lives[i + 1];
          dead += (next ? next.born : r.match!.length) - l.died;
        });
        const deaths = p.deaths.length;
        if (deaths === 0 || lives[lives.length - 1].died !== undefined) continue;
        checked++;
        if (Math.abs(dead - (p.gameStats["TimeSpentDead"] ?? 0)) <= deaths + 1) close++;
      }
    }
    if (checked > 0) expect(close / checked).toBeGreaterThan(0.85);
  });

  it("counts wipes as transitions and aces as the opponent's wipes", () => {
    for (const { file, r } of full) {
      const t = r.match!.teams;
      expect(t["0"].stats.aces, file).toBe(t["1"].stats.wipes);
      expect(t["1"].stats.aces, file).toBe(t["0"].stats.wipes);
      for (const k of ["0", "1"]) {
        const deaths = t[k].ids.reduce((s, id) => s + r.players![id].deaths.length, 0);
        expect(t[k].stats.wipes).toBeLessThanOrEqual(Math.floor(deaths / 5));
      }
    }
  });

  it("maps every player of AI, custom and practice games to tracker data", () => {
    let checked = 0;
    for (const { file, r } of results) {
      if (r.status !== 1 || Object.keys(r.players!).length !== 10) continue;
      checked++;
      const players = Object.values(r.players!);
      for (const p of players) {
        const lives = Object.values(p.units)[0]?.lives ?? [];
        expect(lives.length, `${file} ${p.name} lives`).toBeGreaterThan(0);
      }
      // Score screen present for one player → present for all ten
      if (players.some((p) => "HeroDamage" in p.gameStats)) {
        for (const p of players) {
          expect(p.gameStats["HeroDamage"], `${file} ${p.name} score`).toBeGreaterThanOrEqual(0);
        }
      }
      expect(Object.keys(r.match!.levelTimes["0"]).length, file).toBeGreaterThan(0);
      expect(Object.keys(r.match!.levelTimes["1"]).length, file).toBeGreaterThan(0);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("keeps every AI player as its own entry", () => {
    for (const { file, r } of results) {
      if (r.status !== 1) continue;
      const ids = r.match!.playerIDs;
      expect(new Set(ids).size, file).toBe(ids.length);
      expect(Object.keys(r.players!).length, file).toBe(ids.length);
    }
  });
});
