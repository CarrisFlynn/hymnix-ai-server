import fs from "node:fs";
const s=fs.readFileSync("src/shared/protocol.ts","utf8");
const i=s.indexOf("export type DesktopApi");
console.log(JSON.stringify(s.slice(i,i+220)));
