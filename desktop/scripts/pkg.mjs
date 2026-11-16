import fs from "node:fs";
const s=fs.readFileSync("package.json","utf8");
const i=s.indexOf("extraResources");
console.log(s.slice(i-40,i+520));
