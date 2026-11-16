import fs from "node:fs";
const file="src/renderer/main.tsx";
let s=fs.readFileSync(file,"utf8");
const a=s.indexOf("  function renderSettings() {");
const b=s.indexOf("  function renderView() {",a);
let block=s.slice(a,b);
const drop=["t(\"Connection settings\")","t(\"Host a server\")","t(\"Share password\")","t(\"Public tunnel\")","t(\"Account\")"];
block=block.split("\n").filter((line)=>!drop.some((needle)=>line.includes(needle))).join("\n");
block=block.replace('<div className="setting-row"><label>{t("Workspace")}</label>',
  '<div className="setting-row"><label>{t("Gateway")}</label><div className="controls"><button className="btn" onClick={() => setActive("Gateway")}>{t("Open gateway connection")}</button></div></div>\n        <div className="setting-row"><label>{t("Workspace")}</label>');
s=s.slice(0,a)+block+s.slice(b);
fs.writeFileSync(file,s);
console.log("settings_trimmed");
