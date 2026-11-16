const {app,BrowserWindow,net,protocol}=require("electron");
const {join}=require("node:path");const {pathToFileURL}=require("node:url");
protocol.registerSchemesAsPrivileged([{scheme:"app",privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
const rootDir=process.cwd();const rendererRoot=join(rootDir,"dist/renderer");
app.whenReady().then(async()=>{
  protocol.handle("app",(r)=>{const u=new URL(r.url);const rel=decodeURIComponent(u.pathname).replace(/^\/+/,"")||"index.html";return net.fetch(pathToFileURL(join(rendererRoot,rel)).toString());});
  const win=new BrowserWindow({show:false,webPreferences:{preload:join(rootDir,"dist/preload/preload.js"),contextIsolation:true,sandbox:true,nodeIntegration:false}});
  win.webContents.on("console-message",(_e,_l,m)=>{ if(String(m).indexOf("i18n")>=0) console.log("CONSOLE "+m); });
  await win.loadURL("app://hymnix/index.html");await new Promise(r=>setTimeout(r,1200));
  console.log("DEBUG "+await win.webContents.executeJavaScript("JSON.stringify(globalThis.__i18n||null)"));
  app.exit(0);
});
