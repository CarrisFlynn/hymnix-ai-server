import fs from "node:fs";
const file="src/main/main.ts";
let s=fs.readFileSync(file,"utf8");
s=s.replace(',titleBarOverlay:{color:"#fdf6f7",symbolColor:"#7a1f2b",height:40}','');
fs.writeFileSync(file,s);
console.log("overlay_removed="+!s.includes("titleBarOverlay"));
