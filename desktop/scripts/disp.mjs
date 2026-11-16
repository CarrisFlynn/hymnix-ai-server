import fs from "node:fs";
const lines=fs.readFileSync("src/main/main.ts","utf8").split("\n");
console.log(JSON.stringify(lines[188].slice(0,700)));
