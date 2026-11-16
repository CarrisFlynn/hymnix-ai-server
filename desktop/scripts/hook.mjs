import fs from "node:fs";
const file="src/main/main.ts";
let s=fs.readFileSync(file,"utf8");
console.log("has_assign="+s.includes("mainWindow=win"));
if(s.includes("mainWindow=win;") && !s.includes("win.on(\"resize\"")){
  s=s.replace("mainWindow=win;",'mainWindow=win;win.on("resize",()=>{if(previewView)previewView.setBounds(previewBounds(win));});');
  fs.writeFileSync(file,s);
  console.log("hook_added");
}
