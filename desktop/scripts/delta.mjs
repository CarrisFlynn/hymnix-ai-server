import fs from "node:fs";
const lines=fs.readFileSync("src/main/main.ts","utf8").split("\n");
const i=lines.findIndex((l)=>l.includes("onDelta")||l.includes("delta"));
console.log(lines.slice(i-2,i+8).map((l,k)=>(i-1+k)+"| "+l.slice(0,220)).join("\n"));
