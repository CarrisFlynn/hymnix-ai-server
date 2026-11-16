import fs from "node:fs";
const lines=fs.readFileSync("src/main/main.ts","utf8").split("\n");
console.log("356| "+lines[355].slice(0,420));
console.log("347| "+lines[346].slice(0,200));
console.log("348| "+lines[347].slice(0,200));
