import * as fs from "fs";
import * as path from "path";
import { ReplayAnalyzer } from "../../src/ReplayAnalyzer";
import type { AnalysisResult } from "../../src/types/index";

/**
 * Replays are never committed (the corpus folder is gitignored). Tests read
 * every `.StormReplay` below `STORM_PARSER_REPLAYS` (recursive), or below
 * `tests/replays/` when the variable is unset; replay suites skip when none.
 */
export const replaysRoot: string = process.env.STORM_PARSER_REPLAYS
  ? path.resolve(process.env.STORM_PARSER_REPLAYS)
  : path.resolve(__dirname, "..", "replays");

const walk = (dir: string, acc: string[]): string[] => {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".StormReplay")) acc.push(p);
  }
  return acc;
};

export const replayFiles: string[] = walk(replaysRoot, []).sort();

const cache = new Map<string, Promise<AnalysisResult>>();

/** One analysis per file, shared by every suite in the worker. */
export const analyzeReplay = (file: string): Promise<AnalysisResult> => {
  let p = cache.get(file);
  if (!p) {
    p = ReplayAnalyzer.analyze(file);
    cache.set(file, p);
  }
  return p;
};

export const DRAFT_MODES = [
  "Storm League",
  "Hero League",
  "Team League",
  "Unranked Draft",
];

/**
 * A finished draft game between 10 humans: the shape every uploadable match
 * has, and the only one the strict per-replay checks apply to.
 */
export const isFullDraftGame = (r: AnalysisResult): boolean =>
  r.status === 1 &&
  !!r.match &&
  DRAFT_MODES.includes(r.match.mode ?? "") &&
  (r.match.winner === 0 || r.match.winner === 1) &&
  r.match.playerIDs.length === 10 &&
  Object.keys(r.players ?? {}).length === 10;

/** Heroes whose tracker deaths don't match the score screen (extra units, revives). */
export const DEATH_ORACLE_EXCLUDED_HEROES = ["Murky", "TheLostVikings", "DVa", "Rexxar"];
