import fs from "fs";
import path from "path";
import type { Protocol } from "../ReplayParser.js";

/**
 * Resolve the protocols data directory.
 * Searches multiple candidate locations to handle:
 * - Running from built dist/ (package used directly)
 * - Running from src/ (development/tests)
 * - Running when bundled by a consumer's build tool (e.g. Vite, webpack)
 */
function getProtocolsDir(): string {
  const candidates: string[] = [];

  // 1. Relative to __dirname (works when running from dist/ or src/)
  try {
    // From dist/: __dirname = <pkg>/dist/ → ../protocols
    candidates.push(path.resolve(__dirname, "..", "protocols"));
    // From src/protocols/: __dirname = <pkg>/src/protocols/ → ../../protocols
    candidates.push(path.resolve(__dirname, "..", "..", "protocols"));
  } catch {
    // __dirname may not exist in ESM
  }

  // 2. Relative to process.cwd() (common for development)
  candidates.push(path.resolve(process.cwd(), "protocols"));

  // 3. Inside node_modules (when bundled by consumer's build tool like Vite)
  //    Walk up from cwd to find node_modules containing our package
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(
      dir,
      "node_modules",
      "@astefanski",
      "storm-parser",
      "protocols",
    );
    candidates.push(candidate);
    dir = path.dirname(dir);
  }

  for (const candidate of candidates) {
    if (
      fs.existsSync(candidate) &&
      fs.readdirSync(candidate).some((f: string) => f.endsWith(".json"))
    ) {
      return candidate;
    }
  }

  throw new Error(
    "@astefanski/storm-parser: Protocols directory not found. " +
      "The package ships protocols/; reinstall it (in a clone of the repo run `pnpm generate:protocols`).\n" +
      "Searched: " +
      candidates.join(", "),
  );
}

const protocolCache = new Map<number, Protocol>();
let resolvedDir: string | null = null;

function getDir(): string {
  if (!resolvedDir) {
    resolvedDir = getProtocolsDir();
  }
  return resolvedDir;
}

export function loadProtocol(build: number): Protocol | null {
  if (protocolCache.has(build)) return protocolCache.get(build)!;

  const dir = getDir();
  const filePath = path.join(dir, `protocol${build}.json`);

  if (!fs.existsSync(filePath)) return null;

  const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Protocol;
  protocolCache.set(build, data);
  return data;
}

export function getAvailableBuilds(): number[] {
  const dir = getDir();
  return fs
    .readdirSync(dir)
    .filter((f: string) => /^protocol\d+\.json$/.test(f))
    .map((f: string) => parseInt(f.match(/\d+/)![0], 10))
    .sort((a: number, b: number) => a - b);
}
