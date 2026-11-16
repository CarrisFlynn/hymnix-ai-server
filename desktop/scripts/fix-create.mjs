import fs from "node:fs";
const file="src/main/main.ts";
let s=fs.readFileSync(file,"utf8");
s=s.replace('function createWindow(); mainWindow?.on("resize", () => { if (previewView && mainWindow) previewView.setBounds(previewBounds(mainWindow)); }){','function createWindow(){');
fs.writeFileSync(file,s);
const lines=s.split("\n");
lines.forEach((l,i)=>{ if(l.includes("createWindow();")||l.includes("createWindow()")) console.log((i+1)+"| "+l.slice(0,140)); });
