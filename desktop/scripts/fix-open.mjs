import fs from "node:fs";
const file="src/main/main.ts";
const lines=fs.readFileSync(file,"utf8").split("\n");
lines[347]=lines[347].replace('ipcMain.handle("window:control", async (event, raw: unknown) => { assertSender(event); const url','ipcMain.handle("shell:open", async (event, raw: unknown) => { assertSender(event); const url');
fs.writeFileSync(file,lines.join("\n"));
console.log("fixed="+lines[347].includes('"shell:open"'));
