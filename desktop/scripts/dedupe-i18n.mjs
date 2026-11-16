import fs from "node:fs";
const file = "src/renderer/i18n.ts";
const src = fs.readFileSync(file, "utf8");
const start = src.indexOf("export const zh: Record<string, string> = {");
const open = src.indexOf("{", start);
const end = src.indexOf("\n};", open);
const body = src.slice(open + 1, end);
const lines = body.split("\n").filter((l) => l.trim().length > 0);
const seen = new Set();
const kept = [];
let dropped = 0;
for (const line of lines) {
  const m = line.match(/^\s*("(?:[^"\\]|\\.)*")\s*:/);
  if (m) {
    if (seen.has(m[1])) { dropped++; continue; }
    seen.add(m[1]);
  }
  kept.push(line);
}
const rebuilt = src.slice(0, open + 1) + "\n" + kept.join("\n") + src.slice(end);
fs.writeFileSync(file, rebuilt);
console.log("keys=" + seen.size + " dropped=" + dropped);
