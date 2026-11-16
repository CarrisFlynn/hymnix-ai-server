import fs from "node:fs";
const file="src/renderer/main.tsx";
let s=fs.readFileSync(file,"utf8");
const lines=s.split("\n");
const i=lines.findIndex((l)=>l.includes('className="term-hint"') && l.includes("model <name>"));
if(i<0) throw new Error("hint line missing");
lines[i]='      <div className="term-hint">{t("Commands")}: status · models · model [name] · start/stop [name] · pull [name] · tunnel on|off · hardware · config · set [key] [value] · logtail · export · {hints}</div>';
fs.writeFileSync(file,lines.join("\n"));
console.log("hint_fixed");
