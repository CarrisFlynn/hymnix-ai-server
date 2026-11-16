import fs from "node:fs";
const s=fs.readFileSync("src/renderer/main.tsx","utf8");
const a=s.indexOf('active==="Models"');
console.log("MODELS\n"+s.slice(a, a+1500));
const b=s.indexOf('active==="Settings"');
console.log("\nSETTINGS\n"+s.slice(b, b+1500));
const c=s.indexOf('className="composer"');
console.log("\nCOMPOSER\n"+s.slice(c-40, c+900));
