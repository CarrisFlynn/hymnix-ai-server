import fs from "node:fs";
const file="src/main/main.ts";
let s=fs.readFileSync(file,"utf8");
s=s.replace('win.on("resize", () => { if (previewView && mainWindow) previewView.setBounds(previewBounds(mainWindow)); });\n','');
// attach resize hook where createWindow() is invoked
const marker='createWindow()';
const idx=s.indexOf(marker);
if(idx>=0){
  s=s.slice(0,idx+marker.length)+'; mainWindow?.on("resize", () => { if (previewView && mainWindow) previewView.setBounds(previewBounds(mainWindow)); })'+s.slice(idx+marker.length);
}
fs.writeFileSync(file,s);
console.log("resize_hook="+s.includes('mainWindow?.on("resize"'));
