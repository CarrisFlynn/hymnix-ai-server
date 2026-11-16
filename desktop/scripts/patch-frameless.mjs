import fs from "node:fs";
const file="src/main/main.ts";
let s=fs.readFileSync(file,"utf8");
const lines=s.split("\n");
const idx=lines.findIndex((l)=>l.includes("new BrowserWindow"));
let line=lines[idx];
// frameless + custom titlebar overlay
line=line.replace("width:1440,height:900,minWidth:980,minHeight:640,",
  "width:1440,height:900,minWidth:980,minHeight:640,frame:false,titleBarStyle:\"hidden\",titleBarOverlay:{color:\"#fdf6f7\",symbolColor:\"#7a1f2b\",height:40},");
lines[idx]=line;
s=lines.join("\n");
// disable native menu at startup + window control ipc
s=s.replace('app.whenReady().then(async()=>{', 'app.whenReady().then(async()=>{Menu.setApplicationMenu(null);');
s=s.replace('ipcMain.handle("shell:open"', `ipcMain.handle("window:control", (event, raw: unknown) => { assertSender(event); const action = typeof raw === "string" ? raw : ""; const win = BrowserWindow.fromWebContents(event.sender); if (!win) return { ok: false }; if (action === "minimize") win.minimize(); else if (action === "maximize") win.isMaximized() ? win.unmaximize() : win.maximize(); else if (action === "close") win.close(); return { ok: true, maximized: win.isMaximized() }; });
ipcMain.handle("window:control"`);
fs.writeFileSync(file,s);
console.log("frameless_patched");
