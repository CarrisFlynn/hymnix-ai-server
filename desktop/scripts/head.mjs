import fs from "node:fs";
const lines=fs.readFileSync("src/main/main.ts","utf8").split("\n");
lines.slice(0,12).forEach((l,i)=>console.log((i+1)+"| "+l.slice(0,160)));
