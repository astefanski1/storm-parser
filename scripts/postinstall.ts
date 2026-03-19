import fs from "fs";
import path from "path";
import https from "https";
import { IncomingMessage } from "http";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTOCOLS_LIST_URL =
  "https://api.github.com/repos/Blizzard/heroprotocol/contents/heroprotocol/versions";
const RAW_BASE_URL =
  "https://raw.githubusercontent.com/Blizzard/heroprotocol/master/heroprotocol/versions/";
const PROTOCOL_REGEX = /protocol(\d+)\.py$/;

interface GitHubFile {
  name: string;
}

const fetchJson = async (url: string): Promise<unknown> => {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        { headers: { "User-Agent": "storm-parser-postinstall" } },
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
  s = s.replace(/\(/g, "[").replace(/\)/g, "]");
  s = s.replace(/\bTrue\b/g, "true");
  s = s.replace(/\bFalse\b/g, "false");
  s = s.replace(/\bNone\b/g, "null");
  s = s.replace(/'/g, '"');
  s = s.replace(/([{,]\s*)(\d+)\s*:/g, '$1"$2":');
  s = s.replace(/#.*/g, "");
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
    const numMatch = code.match(new RegExp(`${varName}\\s*=\\s*(\\d+)`, "s"));
    if (numMatch) return parseInt(numMatch[1], 10);
    return null;
  }

  const blockEnd = code.indexOf("\n\n", code.indexOf(`${varName} = `));
  let block = code.substring(
    code.indexOf(`${varName} = `) + `${varName} = `.length,
    blockEnd > -1 ? blockEnd : code.length,
  );
  if (!block.trim().endsWith("}") && !block.trim().endsWith("]")) {
    const lastBrace = Math.max(block.lastIndexOf("}"), block.lastIndexOf("]"));
    block = block.substring(0, lastBrace + 1);
  }

  try {
    return JSON.parse(pyToJson(block));
  } catch {
    try {
       
      return eval("(" + pyToJson(block) + ")");
    } catch (e2) {
      console.error(`Failed to parse ${varName}`, e2);
      return null;
    }
  }
}

async function main() {
  // Determine the output directory relative to the package root
  const packageRoot = path.resolve(__dirname, "..");
  const outDir = path.join(packageRoot, "protocols");

  // Skip if protocols already exist
  if (fs.existsSync(outDir)) {
    const existing = fs.readdirSync(outDir).filter((f) => f.endsWith(".json"));
    if (existing.length > 0) {
      console.log(
        `@astefanski/storm-parser: ${existing.length} protocols already present, skipping download.`,
      );
      return;
    }
  }

  fs.mkdirSync(outDir, { recursive: true });

  console.log(
    "@astefanski/storm-parser: Downloading protocols from Blizzard/heroprotocol...",
  );
  const files = (await fetchJson(PROTOCOLS_LIST_URL)) as GitHubFile[];

  if (!Array.isArray(files)) {
    console.error(
      "@astefanski/storm-parser: Failed to fetch protocol list:",
      files,
    );
    process.exit(1);
  }

  const protocols = files
    .filter((f) => PROTOCOL_REGEX.test(f.name))
    .map((f) => f.name.match(PROTOCOL_REGEX)![1]);

  console.log(
    `@astefanski/storm-parser: Found ${protocols.length} protocols. Downloading...`,
  );

  let completed = 0;
  // Process in batches of 10 to avoid rate limiting
  const BATCH_SIZE = 10;
  for (let i = 0; i < protocols.length; i += BATCH_SIZE) {
    const batch = protocols.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (proto) => {
        const pyFile = `protocol${proto}.py`;
        const code = await fetchText(RAW_BASE_URL + pyFile);

        const protocolData = {
          version: parseInt(proto, 10),
          typeinfos: extractVariable(code, "typeinfos"),
          game_event_types: extractVariable(code, "game_event_types"),
          game_eventid_typeid: extractVariable(code, "game_eventid_typeid"),
          message_event_types: extractVariable(code, "message_event_types"),
          message_eventid_typeid: extractVariable(
            code,
            "message_eventid_typeid",
          ),
          tracker_event_types: extractVariable(code, "tracker_event_types"),
          tracker_eventid_typeid: extractVariable(
            code,
            "tracker_eventid_typeid",
          ),
          svaruint32_typeid: extractVariable(code, "svaruint32_typeid"),
          replay_userid_typeid: extractVariable(code, "replay_userid_typeid"),
          replay_header_typeid: extractVariable(code, "replay_header_typeid"),
          game_details_typeid: extractVariable(code, "game_details_typeid"),
          replay_initdata_typeid: extractVariable(
            code,
            "replay_initdata_typeid",
          ),
        };

        fs.writeFileSync(
          path.join(outDir, `protocol${proto}.json`),
          JSON.stringify(protocolData),
        );

        completed++;
        if (completed % 50 === 0 || completed === protocols.length) {
          console.log(
            `@astefanski/storm-parser: Downloaded ${completed}/${protocols.length} protocols`,
          );
        }
      }),
    );
  }

  console.log("@astefanski/storm-parser: All protocols downloaded!");
}

main().catch((err) => {
  console.error("@astefanski/storm-parser: Postinstall failed:", err);
  process.exit(1);
});
