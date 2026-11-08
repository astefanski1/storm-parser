// Smoke-checks the built package (dist/) the way consumers load it: both the ESM and the CJS entry, from a working
// directory that has no protocols/ and no node_modules/@astefanski/storm-parser (as in serverless functions, e.g.
// Vercel's /var/task). Run after `pnpm build`; exits non-zero when an entry can't find the shipped protocols/.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dist = resolve("dist");
const cwd = mkdtempSync(join(tmpdir(), "storm-parser-dist-"));
const probes = {
  esm: `import(${JSON.stringify(pathToFileURL(join(dist, "index.mjs")).href)}).then((m) => console.log(m.getAvailableBuilds().length))`,
  cjs: `console.log(require(${JSON.stringify(join(dist, "index.js"))}).getAvailableBuilds().length)`,
};

/** The error line of a failed child, without the minified source line Node prints above it. */
const errorLine = (e) => {
  const text = String(e.stderr || e.message);
  const line = text.split("\n").find((l) => /^\w*Error: /.test(l));
  return (line ?? text).slice(0, 300);
};

let failed = 0;
try {
  for (const [name, code] of Object.entries(probes)) {
    try {
      const out = execFileSync(process.execPath, ["-e", code], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const builds = Number(out.trim());
      if (!(builds > 0)) throw new Error(`no protocol builds found (${out.trim()})`);
      console.log(`ok   ${name}: ${builds} protocol builds`);
    } catch (e) {
      failed++;
      console.error(`FAIL ${name}: ${errorLine(e)}`);
    }
  }
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
