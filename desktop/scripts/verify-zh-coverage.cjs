const {app,BrowserWindow,net,protocol}=require("electron");
const {join}=require("node:path");const {pathToFileURL}=require("node:url");
protocol.registerSchemesAsPrivileged([{scheme:"app",privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
const rootDir=process.cwd();const rendererRoot=join(rootDir,"dist/renderer");
app.whenReady().then(async()=>{
  protocol.handle("app",(r)=>{const u=new URL(r.url);const rel=decodeURIComponent(u.pathname).replace(/^\/+/,"")||"index.html";return net.fetch(pathToFileURL(join(rendererRoot,rel)).toString());});
  const win=new BrowserWindow({show:false,width:1400,height:900,webPreferences:{preload:join(rootDir,"dist/preload/preload.js"),contextIsolation:true,sandbox:true,nodeIntegration:false}});
  await win.loadURL("app://hymnix/index.html");await new Promise(r=>setTimeout(r,700));
  await win.webContents.executeJavaScript("localStorage.setItem('hymnix.lang','zh')");
  win.webContents.reload();await new Promise(r=>setTimeout(r,1500));
  const total=await win.webContents.executeJavaScript("document.querySelectorAll('.nav-group button').length");
  const leftovers=new Set();
  for(let i=0;i<total;i++){
    await win.webContents.executeJavaScript("document.querySelectorAll('.nav-group button')["+i+"].click()");
    await new Promise(r=>setTimeout(r,450));
    const text=await win.webContents.executeJavaScript("document.body.innerText");
    for(const word of (text||"").match(/[A-Za-z][A-Za-z .:\/\-]{3,}/g)||[]){
      const clean=word.trim();
      if(/^(Hymnix|Hymnix Orbit|ORBIT|Ollama|English|http|127\.0\.0\.1|1\.3\.0|API)/.test(clean)) continue;
      leftovers.add(clean);
    }
  }
  console.log("LEFT_OVER_COUNT "+leftovers.size);
  console.log("LEFT_OVER "+JSON.stringify([...leftovers].slice(0,25)));
  app.exit(0);
});
