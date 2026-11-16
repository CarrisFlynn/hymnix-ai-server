const {app,BrowserWindow,net,protocol}=require("electron");
const {join}=require("node:path");const {pathToFileURL}=require("node:url");const fs=require("node:fs");
protocol.registerSchemesAsPrivileged([{scheme:"app",privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
const rootDir=process.cwd();const rendererRoot=join(rootDir,"dist/renderer");const outDir=join(rootDir,"..","docs");
const pages=[["chat",-1],["history",1],["gateway",2],["models",3],["terminal",4],["monitor",5],["changelog",6],["support",7],["settings",8]];
const clean="document.querySelectorAll('.error').forEach(function(e){e.remove();});document.querySelectorAll('.conn-chip, .connbar .btn').forEach(function(e){e.style.visibility='hidden';});";
app.whenReady().then(async()=>{
  protocol.handle("app",(r)=>{const u=new URL(r.url);const rel=decodeURIComponent(u.pathname).replace(/^\/+/,"")||"index.html";return net.fetch(pathToFileURL(join(rendererRoot,rel)).toString());});
  const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{preload:join(rootDir,"dist/preload/preload.js"),contextIsolation:true,sandbox:true,nodeIntegration:false}});
  await win.loadURL("app://hymnix/index.html");await new Promise(r=>setTimeout(r,700));
  await win.webContents.executeJavaScript("localStorage.setItem('hymnix.lang','zh');localStorage.removeItem('hymnix.welcome')");
  win.webContents.reload();await new Promise(r=>setTimeout(r,1200));
  fs.writeFileSync(join(outDir,"shot-welcome.png"),(await win.webContents.capturePage()).toPNG());
  const seed = "localStorage.setItem('hymnix.welcome','1');localStorage.setItem('hymnix.demo','1');localStorage.setItem('hymnix.chat.history', JSON.stringify([{id:'s1',name:'Give me a short Python example.',at:new Date().toISOString(),count:4,model:'qwen3:8b'},{id:'s2',name:'网关隧道怎么配',at:new Date().toISOString(),count:6,model:'qwen3:8b'}]))";
  await win.webContents.executeJavaScript(seed);
  win.webContents.reload();await new Promise(r=>setTimeout(r,1400));
  for(const [name,index] of pages){
    if(index>=0){ await win.webContents.executeJavaScript("document.querySelectorAll('.nav-group button')["+index+"].click()"); await new Promise(r=>setTimeout(r,650)); }
    await win.webContents.executeJavaScript(clean);
    fs.writeFileSync(join(outDir,"shot-"+name+".png"),(await win.webContents.capturePage()).toPNG());
  }
  console.log("SHOTS_OK");
  app.exit(0);
});