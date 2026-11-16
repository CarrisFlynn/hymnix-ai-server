import fs from "node:fs";
const s=fs.readFileSync("src/renderer/main.tsx","utf8");
const a=s.indexOf("  function renderHistory() {");
const b=s.indexOf("  function renderMonitor() {",a);
console.log("LEN="+(b-a));
console.log(s.slice(a,b));
