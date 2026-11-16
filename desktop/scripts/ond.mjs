import fs from "node:fs";
const lines=fs.readFileSync("src/renderer/main.tsx","utf8").split("\n");
const i=lines.findIndex((l)=>l.includes("onDelta:"));
console.log(lines.slice(i,i+6).map((l,k)=>(i+k+1)+"| "+l.slice(0,260)).join("\n"));
