const {app,BrowserWindow,net,protocol}=require("electron");
const {join}=require("node:path");const {pathToFileURL}=require("node:url");
protocol.registerSchemesAsPrivileged([{scheme:"app",privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
const root=process.cwd();const rendererRoot=join(root,"dist/renderer");
app.whenReady().then(async()=>{
  protocol.handle("app",(r)=>{const u=new URL(r.url);const rel=decodeURIComponent(u.pathname).replace(/^\/+/,"")||"index.html";return net.fetch(pathToFileURL(join(rendererRoot,rel)).toString());});
  const win=new BrowserWindow({show:false,webPreferences:{preload:join(root,"dist/preload/preload.js"),contextIsolation:true,sandbox:true,nodeIntegration:false}});
  await win.loadURL("app://hymnix/index.html");await new Promise(r=>setTimeout(r,800));
  await win.webContents.executeJavaScript("localStorage.setItem('hymnix.lang','en')");
  win.webContents.reload();await new Promise(r=>setTimeout(r,1600));
  console.log("EN "+await win.webContents.executeJavaScript("JSON.stringify({text:(document.body.innerText||'').slice(0,70),nav:document.querySelectorAll('.nav-group button').length})"));
  app.exit(0);
});