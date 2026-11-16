import fs from "node:fs";
const lines=fs.readFileSync("src/renderer/main.tsx","utf8").split("\n");
[366,404].forEach((n)=>{ console.log("=== "+n+" ==="); console.log(JSON.stringify(lines[n-1].slice(0,300))); });
