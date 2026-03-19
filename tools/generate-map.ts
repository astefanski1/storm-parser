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

let out = `export const loadProtocolModule = (build: number): Promise<any> | null => {\n`;
out += `  switch(build) {\n`;
for (const b of builds) {
  out += `    case ${b}: return import('./protocol${b}.js');\n`;
}
out += `    default: return null;\n`;
out += `  }\n`;
out += `};\n\n`;
out += `export const availableBuilds = [${builds.join(", ")}];\n`;

fs.writeFileSync(path.join(protocolsDir, "map.ts"), out);
console.log("Done mapping.");
