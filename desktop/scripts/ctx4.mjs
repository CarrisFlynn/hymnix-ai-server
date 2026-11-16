import fs from "node:fs";
const s=fs.readFileSync("src/renderer/main.tsx","utf8");
const shellIdx=s.indexOf('return <div className="shell">');
console.log("SHELL\n"+s.slice(shellIdx, shellIdx+2600));
