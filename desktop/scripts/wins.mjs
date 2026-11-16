import fs from "node:fs";
const lines=fs.readFileSync("src/main/main.ts","utf8").split("\n");
const i=lines.findIndex((l)=>l.includes("new BrowserWindow"));
console.log(lines.slice(i-6,i+16).map((l,k)=>(i-6+k+1)+"| "+l.slice(0,170)).join("\n"));
