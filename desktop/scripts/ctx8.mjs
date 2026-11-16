import fs from "node:fs";
const lines=fs.readFileSync("src/renderer/main.tsx","utf8").split("\n");
for (const n of [99,100]) {
  const s=lines[n-1]||"";
  console.log("=== line "+n+" len="+s.length);
  console.log(s.slice(1850,2150));
}
