import fs from "fs";
import path from "path";
import https from "https";

const PROTOCOLS_LIST_URL =
  "https://api.github.com/repos/Blizzard/heroprotocol/contents/heroprotocol/versions";
const RAW_BASE_URL =
  "https://raw.githubusercontent.com/Blizzard/heroprotocol/master/heroprotocol/versions/";
const PROTOCOL_REGEX = /protocol(\d+)\.py$/;

import { IncomingMessage } from "http";

const fetchJson = async (url: string): Promise<unknown> => {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        { headers: { "User-Agent": "node.js fetcher" } },
        (res: IncomingMessage) => {
          let data = "";
          res.on("data", (chunk: string | Buffer) => (data += chunk));
          res.on("end", () => resolve(JSON.parse(data)));
        },
      )
      .on("error", reject);
  });
};

const fetchText = async (url: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res: IncomingMessage) => {
        let data = "";
        res.on("data", (chunk: string | Buffer) => (data += chunk));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
};

function pyToJson(pyStr: string): string {
  let s = pyStr;
  // Replace tuples with arrays
  s = s.replace(/\(/g, "[").replace(/\)/g, "]");
  // Replacements for typical Python constants
  s = s.replace(/\bTrue\b/g, "true");
  s = s.replace(/\bFalse\b/g, "false");
  s = s.replace(/\bNone\b/g, "null");
  // Strings (Assuming no complex string escapes are needed for typeinfos)
  s = s.replace(/'/g, '"');

  // Fix integer keys in dicts
  s = s.replace(/([{,]\s*)(\d+)\s*:/g, '$1"$2":');

  // Remove comments
  s = s.replace(/#.*/g, "");

  // Fix trailing commas in arrays and dicts formatting
  s = s.replace(/,\s*([\]}])/g, "$1");

  return s;
}

function extractVariable(code: string, varName: string): unknown {
  const regex = new RegExp(
    `${varName}\\s*=\\s*([\\[\\{].*?[\\]\\}])(?:\\n\\S|\\n\\n|$)`,
    "s",
  );
  const match = code.match(regex);
  if (!match) {
    // Try simple number match
    const numMatch = code.match(new RegExp(`${varName}\\s*=\\s*(\\d+)`, "s"));
    if (numMatch) return parseInt(numMatch[1], 10);
    return null;
  }

  // Let's strip out newlines from the match for the end check
  // Actually our pyToJson is good enough if we chop cleanly
  const blockEnd = code.indexOf("\n\n", code.indexOf(`${varName} = `));
  let block = code.substring(
    code.indexOf(`${varName} = `) + `${varName} = `.length,
    blockEnd > -1 ? blockEnd : code.length,
  );
  if (!block.trim().endsWith("}") && !block.trim().endsWith("]")) {
    // Fallback simple truncation to last brace/bracket
    const lastBrace = Math.max(block.lastIndexOf("}"), block.lastIndexOf("]"));
    block = block.substring(0, lastBrace + 1);
  }

  try {
    return JSON.parse(pyToJson(block));
  } catch {
    // Last resort: we use JS 'eval' on the transpiled string because sometimes JSON.parse fails on mild infractions.
    try {
      return eval("(" + pyToJson(block) + ")");
    } catch (e2) {
      console.error(`Failed to parse ${varName}`, e2);
      return null;
    }
  }
}

async function main() {
  console.log("Fetching list of protocols from Blizzard/heroprotocol...");
  const files = await fetchJson(PROTOCOLS_LIST_URL);

  if (!Array.isArray(files)) {
    console.error("Failed to fetch protocol list:", files);
    return;
  }

  const protocols = files
    .filter((f) => PROTOCOL_REGEX.test(f.name))
    .map((f) => f.name.match(PROTOCOL_REGEX)![1]);

  console.log(`Found ${protocols.length} protocols. Updating...`);

  const outDir = path.resolve(__dirname, "../src/protocols");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const indexExports = [];

  // For testing/speed, pick latest 2 and oldest 2. And we will do full later or let it run.
  for (const proto of protocols) {
    const pyFile = `protocol${proto}.py`;

    console.log(`Downloading ${pyFile}...`);
    const code = await fetchText(RAW_BASE_URL + pyFile);

    const typeinfos = extractVariable(code, "typeinfos");
    const game_event_types = extractVariable(code, "game_event_types");
    const game_eventid_typeid = extractVariable(code, "game_eventid_typeid");
    const message_event_types = extractVariable(code, "message_event_types");
    const message_eventid_typeid = extractVariable(
      code,
      "message_eventid_typeid",
    );
    const tracker_event_types = extractVariable(code, "tracker_event_types");
    const tracker_eventid_typeid = extractVariable(
      code,
      "tracker_eventid_typeid",
    );
    const svaruint32_typeid = extractVariable(code, "svaruint32_typeid");
    const replay_userid_typeid = extractVariable(code, "replay_userid_typeid");
    const replay_header_typeid = extractVariable(code, "replay_header_typeid");
    const game_details_typeid = extractVariable(code, "game_details_typeid");
    const replay_initdata_typeid = extractVariable(
      code,
      "replay_initdata_typeid",
    );

    const protocolData = {
      version: parseInt(proto, 10),
      typeinfos,
      game_event_types,
      game_eventid_typeid,
      message_event_types,
      message_eventid_typeid,
      tracker_event_types,
      tracker_eventid_typeid,
      svaruint32_typeid,
      replay_userid_typeid,
      replay_header_typeid,
      game_details_typeid,
      replay_initdata_typeid,
    };

    const tsCode =
      `// Auto-generated from ${pyFile}\n` +
      `export const protocol = ${JSON.stringify(protocolData, null, 2)} as const;\n`;

    fs.writeFileSync(path.join(outDir, `protocol${proto}.ts`), tsCode);
    indexExports.push(
      `export { protocol as protocol${proto} } from './protocol${proto}';\n`,
    );
  }

  fs.writeFileSync(path.join(outDir, "index.ts"), indexExports.join(""));
  console.log("All protocols synced and exported!");
}

main().catch(console.error);
