import fs from "node:fs";
const s=fs.readFileSync("src/shared/protocol.ts","utf8");
const i=s.indexOf("export type TerminalApi");
console.log(s.slice(i, i+900));
console.log("---- DesktopApi ----");
const j=s.indexOf("export type DesktopApi");
console.log(s.slice(j, j+400));
