import fs from "node:fs";
const p="package.json";
const j=JSON.parse(fs.readFileSync(p,"utf8"));
j.scripts = Object.assign({}, j.scripts);
j.scripts["cert:selfsigned"] = "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-self-signed-cert.ps1";
j.scripts["dist:sign"] = "electron-builder --win --x64";
fs.writeFileSync(p, JSON.stringify(j,null,2)+"\n");
console.log("OK " + Object.keys(j.scripts).length);
