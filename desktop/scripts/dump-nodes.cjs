const {app,BrowserWindow,net,protocol}=require("electron");
const {join}=require("node:path");const {pathToFileURL}=require("node:url");
protocol.registerSchemesAsPrivileged([{scheme:"app",privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
const rootDir=process.cwd();const rendererRoot=join(rootDir,"dist/renderer");
app.whenReady().then(async()=>{
  protocol.handle("app",(r)=>{const u=new URL(r.url);const rel=decodeURIComponent(u.pathname).replace(/^\/+/,"")||"index.html";return net.fetch(pathToFileURL(join(rendererRoot,rel)).toString());});
  const win=new BrowserWindow({show:false,webPreferences:{preload:join(rootDir,"dist/preload/preload.js"),contextIsolation:true,sandbox:true,nodeIntegration:false}});
  await win.loadURL("app://hymnix/index.html");await new Promise(r=>setTimeout(r,900));
  const count=await win.webContents.executeJavaScript("document.querySelectorAll('.nav-group button').length");
  const all=new Set();
  for(let i=0;i<count;i++){
    await win.webContents.executeJavaScript("document.querySelectorAll('.nav-group button')["+i+"].click()");
    await new Promise(r=>setTimeout(r,350));
    const nodes=await win.webContents.executeJavaScript(`(function(){const out=[];const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);while(w.nextNode()){const t=(w.currentNode.nodeValue||'').trim();if(t.length>12&&/[A-Za-z]{3}/.test(t)&&!/[\u4e00-\u9fa5]/.test(t))out.push(t);}return JSON.stringify(out);})()`);
    for(const t of JSON.parse(nodes)) all.add(t);
  }
  console.log("NODES "+JSON.stringify([...all]));
  app.exit(0);
});