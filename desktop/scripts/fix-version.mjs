import fs from "node:fs";
const file="src/renderer/main.tsx";
let s=fs.readFileSync(file,"utf8");
const lines=s.split("\n");
const i=lines.findIndex((l)=>l.includes("Hymnix Orbit 1.3.0 · gateway"));
if(i<0) throw new Error("version line missing");
lines[i]='          termOut("sys", "Hymnix Orbit 1.3.0 · gateway " + (health?.gateway || "-"));';
fs.writeFileSync(file,lines.join("\n"));
console.log("version_line_fixed");
