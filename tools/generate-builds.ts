import fs from "fs";
import path from "path";

const protocolsDir = path.resolve(__dirname, "../src/protocols");
const files = fs.readdirSync(protocolsDir);
const builds: number[] = [];

for (const f of files) {
  const match = f.match(/protocol(\d+)\.ts$/);
  if (match) {
    builds.push(parseInt(match[1], 10));
  }
}

builds.sort((a, b) => a - b);

fs.writeFileSync(
  path.join(protocolsDir, "builds.ts"),
  `export const availableBuilds = [${builds.join(", ")}];\n`,
);

console.log(`Generated builds.ts with ${builds.length} builds.`);
