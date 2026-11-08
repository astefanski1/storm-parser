/**
 * Generates `protocols/protocol<build>.json` from Blizzard/heroprotocol.
 *
 * Runs at development / publish time only (`pnpm generate:protocols`,
 * `prepublishOnly`); the npm package ships the generated `protocols/`, so
 * consumers never run it. Downloads only builds missing from the output
 * folder (or written without every `FIELDS` entry), checks every HTTP
 * status and parses the Python literals with a strict parser (no eval).
 *
 * Usage: tsx scripts/generate-protocols.ts [--out <dir>]
 */
import fs from "fs";
import path from "path";
import https from "https";

const LIST_URL =
  "https://api.github.com/repos/Blizzard/heroprotocol/contents/heroprotocol/versions";
const RAW_BASE_URL =
  "https://raw.githubusercontent.com/Blizzard/heroprotocol/master/heroprotocol/versions/";
const PROTOCOL_FILE = /^protocol(\d+)\.py$/;

/** Variables the parser reads (see `Protocol` in src/ReplayParser.ts). */
const FIELDS = [
  "typeinfos",
  "tracker_event_types",
  "tracker_eventid_typeid",
  "svaruint32_typeid",
  "replay_header_typeid",
  "game_details_typeid",
  "replay_initdata_typeid",
  "message_event_types",
  "message_eventid_typeid",
  "replay_userid_typeid",
] as const;

/** True when `file` exists and holds every field in `FIELDS` (older runs wrote fewer). */
export function isComplete(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  try {
    const json = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    return FIELDS.every((f) => f in json);
  } catch {
    return false;
  }
}

function get(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "storm-parser-generate-protocols" } }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`GET ${url} → HTTP ${res.statusCode}`));
          return;
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

// ── Strict Python literal parser ────────────────────────────────────────────
// Accepts what heroprotocol's version files use: tuples, lists, dicts,
// single-quoted strings, integers, True/False/None and `#` comments.
// Tuples become arrays and dict keys strings (JSON objects).

type PyValue = number | string | boolean | null | PyValue[] | { [k: string]: PyValue };

export function parsePythonLiteral(src: string, start = 0): { value: PyValue; end: number } {
  let i = start;
  const fail = (msg: string): never => {
    throw new Error(`${msg} at offset ${i}: ${JSON.stringify(src.slice(i, i + 30))}`);
  };
  const skip = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src[i] === "#") {
        while (i < src.length && src[i] !== "\n") i++;
      } else return;
    }
  };
  const value = (): PyValue => {
    skip();
    const c = src[i];
    if (c === "(" || c === "[") return seq(c === "(" ? ")" : "]");
    if (c === "{") return dict();
    if (c === "'" || c === '"') return str();
    if (c === "-" || (c >= "0" && c <= "9")) {
      const m = /^-?\d+/.exec(src.slice(i, i + 32));
      if (!m) fail("bad number");
      i += m![0].length;
      return Number(m![0]);
    }
    for (const [word, v] of [["True", true], ["False", false], ["None", null]] as const) {
      if (src.startsWith(word, i) && !/\w/.test(src[i + word.length] ?? "")) {
        i += word.length;
        return v;
      }
    }
    return fail("unexpected token");
  };
  const seq = (close: string): PyValue[] => {
    i++;
    const out: PyValue[] = [];
    for (;;) {
      skip();
      if (src[i] === close) {
        i++;
        return out;
      }
      out.push(value());
      skip();
      if (src[i] === ",") i++;
      else if (src[i] !== close) fail(`expected , or ${close}`);
    }
  };
  const dict = (): { [k: string]: PyValue } => {
    i++;
    const out: { [k: string]: PyValue } = {};
    for (;;) {
      skip();
      if (src[i] === "}") {
        i++;
        return out;
      }
      const key = value();
      if (typeof key !== "number" && typeof key !== "string") fail("bad dict key");
      skip();
      if (src[i] !== ":") fail("expected :");
      i++;
      out[String(key)] = value();
      skip();
      if (src[i] === ",") i++;
      else if (src[i] !== "}") fail("expected , or }");
    }
  };
  const str = (): string => {
    const q = src[i++];
    let out = "";
    while (i < src.length && src[i] !== q) {
      if (src[i] === "\\") fail("escape sequences are not supported");
      if (src[i] === "\n") fail("unterminated string");
      out += src[i++];
    }
    if (src[i] !== q) fail("unterminated string");
    i++;
    return out;
  };
  const v = value();
  return { value: v, end: i };
}

/** Value of a top-level `name = <literal>` assignment. */
export function extractVariable(code: string, name: string): PyValue {
  const m = new RegExp(`^${name}\\s*=\\s*`, "m").exec(code);
  if (!m) throw new Error(`variable ${name} not found`);
  return parsePythonLiteral(code, m.index + m[0].length).value;
}

export function protocolFromPython(build: number, code: string): Record<string, PyValue> {
  const out: Record<string, PyValue> = { version: build };
  for (const f of FIELDS) out[f] = extractVariable(code, f);
  return out;
}

async function main() {
  const outArg = process.argv.indexOf("--out");
  const outDir =
    outArg !== -1 ? path.resolve(process.argv[outArg + 1]) : path.resolve(__dirname, "..", "protocols");
  fs.mkdirSync(outDir, { recursive: true });

  const list = JSON.parse(await get(LIST_URL)) as { name: string }[];
  if (!Array.isArray(list)) throw new Error("unexpected GitHub listing");
  const builds = list
    .map((f) => PROTOCOL_FILE.exec(f.name)?.[1])
    .filter((b): b is string => !!b);
  const missing = builds.filter((b) => !isComplete(path.join(outDir, `protocol${b}.json`)));
  console.log(
    `generate-protocols: ${builds.length} upstream, ${builds.length - missing.length} complete, ${missing.length} to fetch → ${outDir}`,
  );

  const BATCH = 10;
  for (let i = 0; i < missing.length; i += BATCH) {
    await Promise.all(
      missing.slice(i, i + BATCH).map(async (b) => {
        const code = await get(`${RAW_BASE_URL}protocol${b}.py`);
        const protocol = protocolFromPython(Number(b), code);
        fs.writeFileSync(path.join(outDir, `protocol${b}.json`), JSON.stringify(protocol));
      }),
    );
  }
  console.log("generate-protocols: done");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("generate-protocols failed:", err);
    process.exit(1);
  });
}
