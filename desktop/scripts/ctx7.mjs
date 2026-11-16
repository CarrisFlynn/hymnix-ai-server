import fs from "node:fs";
const s=fs.readFileSync("src/shared/protocol.ts","utf8");
const i=s.indexOf("export type TerminalCommandRequest");
console.log(s.slice(i, s.indexOf("export type TerminalApi")));
