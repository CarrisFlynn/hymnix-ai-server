import fs from "node:fs";
const lines=fs.readFileSync("src/main/main.ts","utf8").split("\n");
console.log(lines[427].slice(0,260));
