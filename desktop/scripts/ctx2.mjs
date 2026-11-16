import fs from "node:fs";
const s=fs.readFileSync("src/renderer/main.tsx","utf8");
const i=s.indexOf("What are you working on");
console.log(s.slice(i-80,i+420).replace(/\n/g," "));
