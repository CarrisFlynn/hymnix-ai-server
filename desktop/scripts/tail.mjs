import fs from "node:fs";
const lines=fs.readFileSync("src/renderer/main.tsx","utf8").split("\n");
const n=lines.length;
for(let i=Math.max(0,n-12);i<n;i++) console.log((i+1)+"| "+lines[i]);
