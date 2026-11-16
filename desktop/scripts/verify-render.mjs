import {app,BrowserWindow,net,protocol} from "electron";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
protocol.registerSchemesAsPrivileged([{scheme:"app",privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
const root = process.cwd();
const rendererRoot = join(root,"dist/renderer");
app.whenReady().then(async()=>{
  protocol.handle("app",(request)=>{const url=new URL(request.url);const rel=decodeURIComponent(url.pathname).replace(/^\/+/,"")||"index.html";return net.fetch(pathToFileURL(join(rendererRoot,rel)).toString());});
  const win=new BrowserWindow({show:false,width:1200,height:800,webPreferences:{preload:join(root,"dist/preload/preload.js"),contextIsolation:true,sandbox:true,nodeIntegration:false}});
  win.webContents.on("console-message",(_e,_l,message)=>console.log("renderer-console:",message));
  win.webContents.on("did-fail-load",(_e,code,desc)=>console.log("did-fail-load:",code,desc));
  await win.loadURL("app://hymnix/index.html");
  await new Promise((resolve)=>setTimeout(resolve,2000));
  const result=await win.webContents.executeJavaScript("JSON.stringify({shell:!!document.querySelector('.shell'),navItems:document.querySelectorAll('.nav-group button').length,rootChildren:(document.getElementById('root')||{}).childElementCount||0,bridge:typeof window.hymnix,text:(document.body.innerText||'').slice(0,120)})");
  console.log("RENDER_CHECK "+result);
  app.exit(0);
});
