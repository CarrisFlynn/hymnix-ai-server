import {app,BrowserWindow,Menu,Notification,Tray,WebContentsView,dialog,ipcMain,net,nativeTheme,protocol,safeStorage,screen,session,shell} from "electron";
import {basename,extname,join,relative,resolve,sep} from "node:path";
import {pathToFileURL} from "node:url";
import {GatewayLifecycle} from "./gateway-lifecycle";
import {existsSync,realpathSync,statfsSync,statSync,readdirSync,readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {spawn,execFile,ChildProcess} from "node:child_process";
import os from "node:os";
import {readPullStream} from "./pull-stream";
import {TerminalBridge} from "./terminal-bridge";
import type {AdminClientsResponse,AdminErrorRecord,AdminHistoryQuery,AdminHistoryResponse,AdminStatus,ChatDelta,GatewayHealth,GatewayMessage,GatewayModelsResponse,OllamaControlResult} from "../shared/protocol";

// ---------- persistent app settings ----------
type AppSettings = {
  betaChannel: boolean; runAtStartup: boolean; dpiScaling: boolean; startFullscreen: boolean;
  autoUpdate: boolean; smoothScroll: boolean; gpuAcceleration: boolean; cacheDir: string;
  previewMode: "inapp" | "browser";
};
const DEFAULT_SETTINGS: AppSettings = {
  betaChannel: false, runAtStartup: false, dpiScaling: false, startFullscreen: false,
  autoUpdate: true, smoothScroll: true, gpuAcceleration: true, cacheDir: "",
  previewMode: "inapp"
};
function settingsPath(): string { return join(app.getPath("userData"), "orbit-settings.json"); }
/** Electron resolves the cache folder at runtime; the bundled type union omits it. */
function cachePath(): string { return (app.getPath as unknown as (name: string) => string)("cache"); }
function readSettings(): AppSettings {
  try {
    const raw = readFileSync(settingsPath(), "utf8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
function writeSettings(patch: Record<string, unknown>): AppSettings {
  const next = { ...readSettings() };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key in patch) (next as Record<string, unknown>)[key] = patch[key];
  }
  try { writeFileSync(settingsPath(), JSON.stringify(next, null, 2), "utf8"); } catch { /* ignore */ }
  applyStartupSideEffects(next);
  return next;
}
function applyStartupSideEffects(settings: AppSettings): void {
  try { app.setLoginItemSettings({ openAtLogin: settings.runAtStartup, args: ["--hidden"] }); } catch { /* ignore */ }
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.setZoomFactor(settings.dpiScaling ? (screen.getPrimaryDisplay().scaleFactor >= 1.5 ? 1.1 : 1) : 1); } catch { /* ignore */ }
  }
}

function bootLog(message: string): void {
  try {
    const line = new Date().toISOString() + " " + message + "\n";
    writeFileSync(join(app.getPath("userData"), "startup.log"), line, { flag: "a" });
  } catch { /* ignore */ }
}
let mainWindow: BrowserWindow | null = null;
let selectedFilesRoot: string | null = null;
const fileLimits = {treeDepth:8,treeLimit:500,searchLimit:200,readLines:400,readBytes:256*1024} as const;
const chatControllers = new Map<string, AbortController>();
const channels = {health:"gateway:health",models:"gateway:models",adminHistory:"gateway:admin-history",adminStatus:"gateway:admin-status",adminErrors:"gateway:admin-errors",adminClients:"gateway:admin-clients",stream:"gateway:stream",cancel:"gateway:cancel",delta:"gateway:delta",complete:"gateway:complete"} as const;
const productRoot = app.isPackaged ? process.resourcesPath : join(__dirname,"../../..");
const backendPath = app.isPackaged ? join(process.resourcesPath,"backend-gateway-headless.exe") : join(productRoot,"server","headless_gateway.py");
const gateway = new GatewayLifecycle({
  command: app.isPackaged ? backendPath : process.env.HYMNIX_PYTHON || (process.platform === "win32" ? "python" : "python3"),
  args: app.isPackaged ? [] : ["-u", backendPath],
  requiredPath: backendPath,
  cwd: productRoot,
  log: bootLog,
});
function gatewayBase(): string {
  const {base, ready, error} = gateway.snapshot();
  if (!ready) throw new Error(JSON.stringify({code: "gateway_not_ready", message: error}));
  return base;
}
const rendererRoot = join(__dirname,"../renderer");
const rendererPath = join(rendererRoot,"index.html");

// Local desktop mode: the gateway generates its own key into gateway_config.json next to the
// app data. The desktop app reads it itself, so the user never has to paste a key by hand.
function localConfigCandidates(): string[] {
  const list: string[] = [];
  const dataDir = process.env.HYMNIX_DATA_DIR;
  if (dataDir) list.push(join(dataDir, "gateway_config.json"));
  const appData = process.env.LOCALAPPDATA || process.env.APPDATA;
  if (appData) list.push(join(appData, "Hymnix", "gateway_config.json"));
  list.push(join(productRoot, "gateway_config.json"));
  return list;
}
function readLocalConfig(): { apiKey: string; adminKey: string } {
  for (const candidate of localConfigCandidates()) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { api_key?: unknown; admin_key?: unknown };
      const apiKey = typeof parsed.api_key === "string" ? parsed.api_key.trim() : "";
      const adminKey = typeof parsed.admin_key === "string" ? parsed.admin_key.trim() : "";
      if (apiKey) return { apiKey, adminKey };
    } catch { /* try next candidate */ }
  }
  return { apiKey: "", adminKey: "" };
}
function localApiKey(): string {
  const { apiKey } = readLocalConfig();
  if (!apiKey) throw new Error(JSON.stringify({ code: "local_key_missing", message: "The local gateway configuration has no API key yet. Start the gateway once, then retry." }));
  return apiKey;
}
function resolveAdminKey(raw: unknown): string {
  if (typeof raw === "string" && raw.trim()) return raw;
  const { adminKey } = readLocalConfig();
  if (!adminKey) throw new Error(JSON.stringify({ code: "local_admin_key_missing", message: "The local gateway configuration has no admin key yet." }));
  return adminKey;
}
const rendererUrl = "app://hymnix/index.html";
// A privileged custom scheme gives the renderer a real origin, so relative assets
// and the CSP "self" directive work (file:// gives an opaque origin and blocks both).
protocol.registerSchemesAsPrivileged([{scheme:"app",privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);

function isAllowedRendererUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "app:") return url.host === "hymnix";
    return url.origin === "http://localhost" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function assertSender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): void {
  if (!isAllowedRendererUrl(event.sender.getURL())) throw new Error("Unauthorized IPC sender");
}
function gatewayUrl(base: string, path: string): URL { const url = new URL(base); if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") || !url.port || url.username || url.password) throw new Error("Gateway URL must target the local gateway"); return new URL(path, url.href.endsWith("/") ? url.href : url.href + "/"); }
type GatewayError = {status?: number; code?: string; message: string};
function errorPayload(status: number, payload: unknown, fallback: string): GatewayError { const root = payload && typeof payload === "object" ? payload as Record<string,unknown> : {}; const nested = root.error && typeof root.error === "object" ? root.error as Record<string,unknown> : root; return {status, code: typeof nested.code === "string" ? nested.code : undefined, message: typeof nested.message === "string" ? nested.message : fallback}; }
function required(value: unknown, name: string): string { if (typeof value !== "string" || !value.trim()) throw new Error("Invalid " + name); return value; }
function healthSchemaError(message: string): Error { return new Error(JSON.stringify({code:"health_schema_error",message})); }
function parseGatewayHealth(payload: unknown): GatewayHealth {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw healthSchemaError("Gateway health response must be a JSON object");
  const value=payload as Record<string,unknown>;
  if (typeof value.ok !== "boolean") throw healthSchemaError("Gateway health field ok must be boolean");
  if (typeof value.gateway !== "string") throw healthSchemaError("Gateway health field gateway must be string");
  if (typeof value.ollama !== "boolean") throw healthSchemaError("Gateway health field ollama must be boolean");
  if (typeof value.models !== "number" || !Number.isFinite(value.models)) throw healthSchemaError("Gateway health field models must be a finite number");
  if (typeof value.uptime_s !== "number" || !Number.isFinite(value.uptime_s)) throw healthSchemaError("Gateway health field uptime_s must be a finite number");
  if (value.tunnel !== undefined && typeof value.tunnel !== "string") throw healthSchemaError("Gateway health field tunnel must be string when present");
  if (value.clients_online !== undefined && (typeof value.clients_online !== "number" || !Number.isFinite(value.clients_online))) throw healthSchemaError("Gateway health field clients_online must be a finite number when present");
  return value as GatewayHealth;
}
function boundedInteger(value: unknown, name: string, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) throw new Error(JSON.stringify({code:"invalid_admin_history_parameter",message:name + " must be an integer"}));
  return Math.max(minimum,Math.min(maximum,value));
}
function adminStatusSchemaError(message: string): Error { return new Error(JSON.stringify({code:"admin_status_schema_error",message})); }
function parseAdminStatus(payload: unknown): AdminStatus {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw adminStatusSchemaError("Gateway admin status response must be a JSON object");
  const value=payload as Record<string,unknown>;
  if (value.gateway !== undefined && (!value.gateway || typeof value.gateway !== "object" || Array.isArray(value.gateway))) throw adminStatusSchemaError("Gateway admin status field gateway must be an object when present");
  if (value.ollama !== undefined && (!value.ollama || typeof value.ollama !== "object" || Array.isArray(value.ollama))) throw adminStatusSchemaError("Gateway admin status field ollama must be an object when present");
  if (value.tunnel !== undefined && typeof value.tunnel !== "string") throw adminStatusSchemaError("Gateway admin status field tunnel must be string when present");
  if (value.clients !== undefined && !Array.isArray(value.clients)) throw adminStatusSchemaError("Gateway admin status field clients must be an array when present");
  if (value.online !== undefined && (typeof value.online !== "number" || !Number.isFinite(value.online))) throw adminStatusSchemaError("Gateway admin status field online must be a finite number when present");
  if (value.stats !== undefined && (!value.stats || typeof value.stats !== "object" || Array.isArray(value.stats))) throw adminStatusSchemaError("Gateway admin status field stats must be an object when present");
  if (value.recent !== undefined && !Array.isArray(value.recent)) throw adminStatusSchemaError("Gateway admin status field recent must be an array when present");
  return value as AdminStatus;
}
function filesError(code: string, message: string): Error { return new Error(JSON.stringify({code,message})); }
function filesRootOrThrow(): string { if (!selectedFilesRoot) throw filesError("root_not_selected","Choose a workspace root first"); return selectedFilesRoot; }
function validateFilePath(raw: unknown): string { if (typeof raw !== "string" || !raw.trim()) throw filesError("invalid_path","Path must be a non-empty relative path"); if (raw.includes("\0") || raw.includes("\\") || /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("/") || raw.startsWith("\\")) throw filesError("invalid_path","Absolute, UNC, and NUL paths are not allowed"); const root=filesRootOrThrow(); const candidate=resolve(root,raw); const rel=relative(root,candidate); if (rel.startsWith(".."+sep) || rel===".." || rel.includes(".."+sep)) throw filesError("out_of_scope","Path is outside the selected root"); let real:string; try { real=realpathSync(candidate); } catch { throw filesError("not_found","Path does not exist"); } const rr=realpathSync(root); const rrel=relative(rr,real); if (rrel.startsWith(".."+sep) || rrel===".." || /^[A-Za-z]:/.test(rrel)) throw filesError("out_of_scope","Path is outside the selected root"); return real; }
function parseFileLimit(raw: unknown, fallback: number, max: number, name: string, minimum=1): number { if (raw===undefined) return fallback; if(typeof raw!=="number"||!Number.isInteger(raw)||raw<minimum||raw>max) throw filesError("invalid_parameter",name+" is outside the allowed range"); return raw; }
function fileEntry(real: string, root: string): {name:string;rel:string;isDir:boolean;size:number;mtime:number;ext:string} { const info=statSync(real); const name=basename(real); return {name,rel:relative(root,real).replaceAll(sep,"/"),isDir:info.isDirectory(),size:info.isFile()?info.size:0,mtime:info.mtimeMs,ext:info.isFile()?extname(name):""}; }
function readUtf8Bounded(path: string): string { let bytes: Buffer; try { bytes=readFileSync(path); } catch { throw filesError("not_found","File does not exist"); } if (bytes.length>fileLimits.readBytes) throw filesError("too_large","File exceeds read limit"); try { return new TextDecoder("utf-8",{fatal:true}).decode(bytes); } catch { throw filesError("binary_file","File is not valid UTF-8"); } }
function registerFilesIpc(): void {
  ipcMain.handle("files:choose-root", async (event) => { assertSender(event); const result=await dialog.showOpenDialog(mainWindow ?? BrowserWindow.getFocusedWindow()!,{properties:["openDirectory","createDirectory"]}); if(result.canceled||!result.filePaths[0]) return {selected:Boolean(selectedFilesRoot),path:selectedFilesRoot}; try { const root=realpathSync(result.filePaths[0]); if(!statSync(root).isDirectory()) throw new Error(); selectedFilesRoot=root; return {selected:true,path:root}; } catch { throw filesError("invalid_root","Selected root is not a directory"); } });
  ipcMain.handle("files:current", (event) => { assertSender(event); return {selected:Boolean(selectedFilesRoot),path:selectedFilesRoot}; });
  ipcMain.handle("files:tree", (event, raw: unknown) => { assertSender(event); const v=raw&&typeof raw==="object"?raw as Record<string,unknown>:{}; if(v.path!==undefined && (typeof v.path!=="string" || v.path!=="." && !v.path.trim())) throw filesError("invalid_path","Path must be relative"); const start=v.path===undefined||v.path==="."?filesRootOrThrow():validateFilePath(v.path); const depth=parseFileLimit(v.depth,1,fileLimits.treeDepth,"depth",0); const limit=parseFileLimit(v.limit,100,fileLimits.treeLimit,"limit"); const results:{name:string;rel:string;isDir:boolean;size:number;mtime:number;ext:string}[]=[]; const walk=(dir:string,d:number) => { if(results.length>=limit||d>depth)return; let entries; try{entries=readdirSync(dir,{withFileTypes:true});}catch{throw filesError("read_failed","Unable to read directory");} for(const e of entries){if(results.length>=limit)break; const full=join(dir,e.name); let real:string; try{real=realpathSync(full);}catch{continue;} try{const root=filesRootOrThrow(); const rr=relative(root,real); if(rr.startsWith(".."+sep)||rr==="..")continue; const rel=rr.replaceAll(sep,"/"); results.push(fileEntry(real,root)); if(e.isDirectory())walk(real,d+1);}catch{} } }; walk(start,0); return {ok:true,results,count:results.length}; });
  ipcMain.handle("files:search", (event, raw: unknown) => { assertSender(event); if(!raw||typeof raw!=="object")throw filesError("invalid_request","Search request must be an object"); const v=raw as Record<string,unknown>; if(typeof v.query!=="string"||!v.query)throw filesError("missing_required","query is required"); if(v.query.length>200)throw filesError("query_too_long","query exceeds 200 characters"); const limit=parseFileLimit(v.limit,50,fileLimits.searchLimit,"limit"); if(v.path!==undefined && (typeof v.path!=="string" || v.path!=="." && !v.path.trim())) throw filesError("invalid_path","Path must be relative"); const start=v.path===undefined||v.path==="."?filesRootOrThrow():validateFilePath(v.path); const include=typeof v.include==="string"?v.include:null; const results:{rel:string;line:number;text:string}[]=[]; const walk=(dir:string) => {if(results.length>=limit)return; let entries;try{entries=readdirSync(dir,{withFileTypes:true});}catch{return;}for(const e of entries){if(results.length>=limit)break;const full=join(dir,e.name);let real;try{real=realpathSync(full);}catch{continue;}const rel=relative(filesRootOrThrow(),real).replaceAll(sep,"/");if(e.isDirectory())walk(real);else if((!include||rel.includes(include))){let text;try{text=readUtf8Bounded(real);}catch(error){if(error instanceof Error && error.message.includes("too_large")) continue; continue;}const index=text.indexOf(v.query as string); if(index>=0){const line=text.slice(0,index).split(/\r?\n/).length; results.push({rel,line,text:text.split(/\r?\n/)[line-1]??""});}}}};walk(start);return {ok:true,count:results.length,results}; });
  ipcMain.handle("files:read", (event, raw: unknown) => { assertSender(event); if(!raw||typeof raw!=="object")throw filesError("invalid_request","Read request must be an object"); const v=raw as Record<string,unknown>; const path=validateFilePath(v.path); const start=parseFileLimit(v.start,1,Number.MAX_SAFE_INTEGER,"start"); const lines=parseFileLimit(v.lines,100,fileLimits.readLines,"lines"); const text=readUtf8Bounded(path); const all=text.split(/\r?\n/); const end=Math.min(all.length,start+lines-1); return {ok:true,path:relative(filesRootOrThrow(),path).replaceAll(sep,"/"),start,end,total:all.length,text:all.slice(start-1,end).join("\n")}; });
}
function registerGatewayIpc(): void {
  ipcMain.handle(channels.health, async (event): Promise<GatewayHealth> => { assertSender(event); await gateway.bootstrap(); const response = await fetch(gatewayUrl(gatewayBase(),"health"), {signal:AbortSignal.timeout(5000),headers:{Accept:"application/json"}}); if (!response.ok) { const body=await response.json().catch(() => null); throw new Error(JSON.stringify(errorPayload(response.status,body,"Gateway health HTTP " + response.status))); } let payload: unknown; try { payload=await response.json(); } catch { throw healthSchemaError("Gateway health response must be valid JSON"); } return parseGatewayHealth(payload); });
  ipcMain.handle(channels.adminHistory, async (event, rawAdminKey: unknown, rawQuery: unknown): Promise<AdminHistoryResponse> => {
    assertSender(event);
    const adminKey=resolveAdminKey(rawAdminKey);
    if (rawQuery !== undefined && (!rawQuery || typeof rawQuery !== "object" || Array.isArray(rawQuery))) throw new Error(JSON.stringify({code:"invalid_admin_history_request",message:"Admin history query must be an object"}));
    const query=(rawQuery || {}) as AdminHistoryQuery;
    const limit=boundedInteger(query.limit,"limit",1000,1,5000);
    const days=boundedInteger(query.days,"days",7,1,365);
    const url=gatewayUrl(gatewayBase(),"admin/history");
    url.searchParams.set("limit",String(limit));
    url.searchParams.set("days",String(days));
    const response=await fetch(url,{signal:AbortSignal.timeout(5000),headers:{Accept:"application/json","X-Admin-Key":adminKey}});
    if (!response.ok) { const body=await response.json().catch(() => null); throw new Error(JSON.stringify(errorPayload(response.status,body,"Gateway admin history HTTP " + response.status))); }
    try { return await response.json(); } catch { throw new Error(JSON.stringify({code:"admin_history_schema_error",message:"Gateway admin history response must be valid JSON"})); }
  });
  ipcMain.handle(channels.models, async (event, apiKey: unknown): Promise<GatewayModelsResponse> => { assertSender(event); const response = await fetch(gatewayUrl(gatewayBase(),"api/tags"), {headers:{Accept:"application/json","X-API-Key":localApiKey()}}); if (!response.ok) throw new Error(JSON.stringify(errorPayload(response.status, await response.json().catch(() => null), "Gateway models HTTP " + response.status))); return response.json() as Promise<GatewayModelsResponse>; });
  ipcMain.handle(channels.adminStatus, async (event, rawAdminKey: unknown): Promise<AdminStatus> => {
    assertSender(event);
    const adminKey=resolveAdminKey(rawAdminKey);
    const response=await fetch(gatewayUrl(gatewayBase(),"admin/status"),{signal:AbortSignal.timeout(5000),headers:{Accept:"application/json","X-Admin-Key":adminKey}});
    if (!response.ok) { const body=await response.json().catch(() => null); throw new Error(JSON.stringify(errorPayload(response.status,body,"Gateway admin status HTTP " + response.status))); }
    let payload: unknown;
    try { payload=await response.json(); } catch { throw adminStatusSchemaError("Gateway admin status response must be valid JSON"); }
    return parseAdminStatus(payload);
  });
  ipcMain.handle(channels.adminErrors, async (event, rawAdminKey: unknown, rawLimit: unknown): Promise<AdminErrorRecord[]> => {
    assertSender(event);
    const adminKey=resolveAdminKey(rawAdminKey);
    const limit=boundedInteger(rawLimit,"limit",50,1,200);
    const url=gatewayUrl(gatewayBase(),"admin/errors");
    url.searchParams.set("limit",String(limit));
    const response=await fetch(url,{signal:AbortSignal.timeout(5000),headers:{Accept:"application/json","X-Admin-Key":adminKey}});
    if (!response.ok) { const body=await response.json().catch(() => null); throw new Error(JSON.stringify(errorPayload(response.status,body,"Gateway admin errors HTTP " + response.status))); }
    let payload: unknown;
    try { payload=await response.json(); } catch { throw new Error(JSON.stringify({code:"admin_errors_schema_error",message:"Gateway admin errors response must be valid JSON"})); }
    if (!Array.isArray(payload)) throw new Error(JSON.stringify({code:"admin_errors_schema_error",message:"Gateway admin errors response must be an array"}));
    return payload as AdminErrorRecord[];
  });
  ipcMain.handle(channels.adminClients, async (event, rawAdminKey: unknown): Promise<AdminClientsResponse> => {
    assertSender(event);
    const adminKey=resolveAdminKey(rawAdminKey);
    const response=await fetch(gatewayUrl(gatewayBase(),"admin/clients"),{signal:AbortSignal.timeout(5000),headers:{Accept:"application/json","X-Admin-Key":adminKey}});
    if (!response.ok) { const body=await response.json().catch(() => null); throw new Error(JSON.stringify(errorPayload(response.status,body,"Gateway admin clients HTTP " + response.status))); }
    let payload: unknown;
    try { payload=await response.json(); } catch { throw new Error(JSON.stringify({code:"admin_clients_schema_error",message:"Gateway admin clients response must be valid JSON"})); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error(JSON.stringify({code:"admin_clients_schema_error",message:"Gateway admin clients response must be an object"}));
    const value=payload as Record<string,unknown>;
    if (!Array.isArray(value.clients)) throw new Error(JSON.stringify({code:"admin_clients_schema_error",message:"Gateway admin clients response field clients must be an array"}));
    return value as AdminClientsResponse;
  });
  ipcMain.on(channels.cancel, (event, requestId: unknown) => { assertSender(event); if (typeof requestId === "string") chatControllers.get(requestId)?.abort(); });
  ipcMain.handle(channels.stream, async (event, raw: unknown): Promise<void> => {
    assertSender(event); if (!raw || typeof raw !== "object") throw new Error("Invalid chat request"); const value = raw as Record<string,unknown>; const requestId = required(value.requestId,"request id"); const requestedBase = required(value.baseUrl,"base URL"); const suppliedKey = typeof value.apiKey === "string" ? value.apiKey.trim() : ""; const model = required(value.model,"model"); const messages = value.messages; if (!Array.isArray(messages)) throw new Error("Invalid messages"); if (chatControllers.has(requestId)) throw new Error("Duplicate request id");
    const controller = new AbortController(); chatControllers.set(requestId,controller);
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let completed=false; let doneSeen=false;
    const sendComplete=(error?:GatewayError) => { if (completed || (!error && !doneSeen)) return; completed=true; event.sender.send(channels.complete,{requestId,error}); };
    try {
      const base = suppliedKey ? requestedBase : gatewayBase();
      const apiKey = suppliedKey || localApiKey();
      const response = await fetch(gatewayUrl(base,"v1/chat/completions"), {method:"POST",signal:controller.signal,headers:{Accept:"text/event-stream","Content-Type":"application/json",Authorization:"Bearer "+apiKey},body:JSON.stringify({model,messages:messages as GatewayMessage[],stream:true,...(typeof value.reasoningEffort==="string"&&value.reasoningEffort?{reasoning_effort:value.reasoningEffort}:{})})});
      if (!response.ok) { const body=await response.json().catch(()=>null); throw new Error(JSON.stringify(errorPayload(response.status,body,"Gateway chat HTTP "+response.status))); }
      if (!response.body) throw new Error(JSON.stringify({status:response.status,message:"Gateway chat response has no body"}));
      reader=response.body.getReader();
      const decoder=new TextDecoder(); let buffer="", dataLines:string[]=[];
      const dispatch=() => { if (!dataLines.length) return; const payload=dataLines.join("\n"); dataLines=[]; if (payload.trim()==="[DONE]") { doneSeen=true; sendComplete(); return; } let parsed:unknown; try { parsed=JSON.parse(payload); } catch { throw new Error(JSON.stringify({status:response.status,code:"invalid_sse_json",message:"Gateway returned malformed SSE JSON"})); } const delta=parsed as ChatDelta; if (delta.error) throw new Error(JSON.stringify({status:response.status,code:delta.error.code||"gateway_error",message:delta.error.message||"Gateway stream error"})); event.sender.send(channels.delta,{requestId,delta}); };
      const line=(value:string) => { if (value==="") { dispatch(); return; } if (value.startsWith(":")) return; const colon=value.indexOf(":"); const field=colon<0?value:value.slice(0,colon); let content=colon<0?"":value.slice(colon+1); if (content.startsWith(" ")) content=content.slice(1); if (field==="data") dataLines.push(content); };
      while (!completed) { const part=await reader.read(); buffer+=decoder.decode(part.value||new Uint8Array(),{stream:!part.done}); const lines=buffer.split(/\r\n|\n|\r/); buffer=lines.pop()||""; for (const item of lines) line(item); if (part.done) { if (buffer) line(buffer); buffer=""; if (dataLines.length) dispatch(); if (!doneSeen) throw new Error(JSON.stringify({status:response.status,code:"incomplete_stream",message:"Gateway stream ended before [DONE]"})); break; } }
    } catch (reason) { let error:GatewayError; if (controller.signal.aborted) error={code:"aborted",message:"Gateway stream aborted"}; else { const message=reason instanceof Error?reason.message:String(reason); try { error=JSON.parse(message) as GatewayError; } catch { error={message}; } } sendComplete(error); } finally { if (reader) { await reader.cancel().catch(() => undefined); reader.releaseLock(); reader=null; } chatControllers.delete(requestId); }
  });
}
registerFilesIpc();

// ---------- terminal ----------
const terminalChannels = { start:"terminal:start", cancel:"terminal:cancel", output:"terminal:output", complete:"terminal:complete" } as const;
const terminalProcesses = new Map<string, ChildProcess>();
const terminalBridge = new TerminalBridge();
function registerTerminalIpc(): void {
  ipcMain.handle("terminal:bridge", (event, action: unknown) => {
    assertSender(event);
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error("Invalid terminal sender");
    if (action !== "on" && action !== "off" && action !== "status" && action !== "inbox") throw new Error("Invalid bridge command");
    return terminalBridge.run(action);
  });
  ipcMain.handle(terminalChannels.start, async (event, raw: unknown) => {
    assertSender(event);
    if (!raw || typeof raw !== "object") throw new Error("Invalid terminal request");
    const value = raw as Record<string, unknown>;
    const command = required(value.command, "command");
    const requestId = "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const cwd = typeof value.cwd === "string" && value.cwd.trim() ? value.cwd : process.cwd();
    const child = spawn(command, [], { cwd, shell: true, windowsHide: true, env: { ...process.env } });
    terminalProcesses.set(requestId, child);
    const send = (stream: "stdout" | "stderr", chunk: string) => { if (!event.sender.isDestroyed()) event.sender.send(terminalChannels.output, { id: requestId, stream, text: chunk }); };
    child.stdout?.on("data", (data: Buffer) => send("stdout", data.toString()));
    child.stderr?.on("data", (data: Buffer) => send("stderr", data.toString()));
    child.once("error", (error: Error) => { terminalProcesses.delete(requestId); if (!event.sender.isDestroyed()) event.sender.send(terminalChannels.complete, { id: requestId, code: null, signal: null, error: { code: "spawn_failed", message: error.message } }); });
    child.once("exit", (code: number | null) => { terminalProcesses.delete(requestId); if (!event.sender.isDestroyed()) event.sender.send(terminalChannels.complete, { id: requestId, code, signal: null }); });
    return { id: requestId };
  });
  ipcMain.on(terminalChannels.cancel, (event, requestId: unknown) => { assertSender(event); if (typeof requestId !== "string") return; const child = terminalProcesses.get(requestId); if (!child) return; try { child.kill(); } catch { /* already gone */ } });
}

// ---------- model management ----------
const modelChannels = { list:"models:list", pull:"models:pull", remove:"models:delete", start:"models:start", stop:"models:stop" } as const;
function adminHeaders(): Record<string,string> { return { Accept:"application/json", "X-Admin-Key": resolveAdminKey(undefined) }; }
async function adminJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(gatewayUrl(gatewayBase(), path), { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000), headers: { ...adminHeaders(), ...(init?.headers as Record<string,string> | undefined) } });
  if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(JSON.stringify(errorPayload(response.status, body, "Gateway " + path + " HTTP " + response.status))); }
  return response.json().catch(() => ({}));
}
function parseToolsResponse(payload: unknown): {ok:true;tools:Array<{name:string;description:string;schema:Record<string,unknown>;danger:boolean;permission:string|null}>;count:number} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error(JSON.stringify({code:"tools_schema_error",message:"Tools response must be an object"}));
  const value = payload as Record<string, unknown>;
  if (value.ok !== true || !Array.isArray(value.tools) || typeof value.count !== "number" || !Number.isInteger(value.count) || value.count !== value.tools.length) throw new Error(JSON.stringify({code:"tools_schema_error",message:"Invalid tools response shape"}));
  const forbidden = new Set(["callable","handler","args"]);
  const inspect = (item: unknown): void => { if (!item || typeof item !== "object") return; if (Array.isArray(item)) { for (const child of item) inspect(child); return; } for (const [key, child] of Object.entries(item as Record<string, unknown>)) { if (forbidden.has(key)) throw new Error(JSON.stringify({code:"tools_schema_error",message:"Tools response contains forbidden executable field: "+key})); inspect(child); } };
  inspect(value);
  const tools = value.tools.map((raw, index) => { if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(JSON.stringify({code:"tools_schema_error",message:"Invalid tool descriptor at index "+index})); const item=raw as Record<string,unknown>; if (typeof item.name !== "string" || !item.name || typeof item.description !== "string" || !item.schema || typeof item.schema !== "object" || Array.isArray(item.schema) || typeof item.danger !== "boolean" || (item.permission !== null && typeof item.permission !== "string")) throw new Error(JSON.stringify({code:"tools_schema_error",message:"Invalid tool descriptor at index "+index})); return {name:item.name,description:item.description,schema:item.schema as Record<string,unknown>,danger:item.danger,permission:item.permission as string|null}; });
  return {ok:true,tools,count:value.count};
}
function parseToolCallResponse(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error(JSON.stringify({code:"tools_schema_error",message:"Tool call response must be an object"}));
  const value=payload as Record<string,unknown>;
  if (typeof value.ok !== "boolean") throw new Error(JSON.stringify({code:"tools_schema_error",message:"Tool call response ok must be boolean"}));
  if (value.approval_required !== undefined && (!value.approval_required || typeof value.approval_required !== "object" || Array.isArray(value.approval_required))) throw new Error(JSON.stringify({code:"tools_schema_error",message:"Invalid approval_required"}));
  if (value.error !== undefined && (!value.error || typeof value.error !== "object" || Array.isArray(value.error) || typeof (value.error as Record<string,unknown>).message !== "string")) throw new Error(JSON.stringify({code:"tools_schema_error",message:"Invalid tool error"}));
  return value;
}
function parseApprovalListResponse(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error(JSON.stringify({code:"approval_schema_error",message:"Approval response must be an object"}));
  const value=payload as Record<string,unknown>; if(typeof value.ok!=="boolean"||!Array.isArray(value.approvals)||typeof value.count!=="number"||!Number.isInteger(value.count)||value.count!==value.approvals.length) throw new Error(JSON.stringify({code:"approval_schema_error",message:"Invalid approval list response"}));
  for(const item of value.approvals){if(!item||typeof item!=="object"||Array.isArray(item))throw new Error(JSON.stringify({code:"approval_schema_error",message:"Invalid approval record"})); const record=item as Record<string,unknown>; for(const key of ["id","requestId","tool","risk","createdAt","expiresAt"]){if(typeof record[key]!=="string"||!(record[key] as string))throw new Error(JSON.stringify({code:"approval_schema_error",message:"Invalid approval record field: "+key}));} if(!record.argsRedacted||typeof record.argsRedacted!=="object"||Array.isArray(record.argsRedacted)||!Array.isArray(record.reasons))throw new Error(JSON.stringify({code:"approval_schema_error",message:"Invalid approval record details"}));}
  return value;
}
function parseApprovalDecisionResponse(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error(JSON.stringify({code:"approval_schema_error",message:"Approval decision response must be an object"})); const value=payload as Record<string,unknown>; if(typeof value.ok!=="boolean"||typeof value.id!=="string"||!value.id||value.decision!=="approved"&&value.decision!=="denied") throw new Error(JSON.stringify({code:"approval_schema_error",message:"Invalid approval decision response"})); if(value.error!==undefined&&(!value.error||typeof value.error!=="object"||Array.isArray(value.error)||typeof (value.error as Record<string,unknown>).message!=="string")) throw new Error(JSON.stringify({code:"approval_schema_error",message:"Invalid approval decision error"})); return value;
}
async function toolsJson(path: string, init: RequestInit, keyHeader: "X-API-Key" | "X-Admin-Key", fallback: string): Promise<unknown> {
  const response=await fetch(gatewayUrl(gatewayBase(),path),{...init,signal:AbortSignal.timeout(5000),headers:{Accept:"application/json",...(init.headers as Record<string,string>||{}),[keyHeader]:keyHeader==="X-API-Key"?localApiKey():resolveAdminKey(undefined)}}); const body=await response.json().catch(()=>null); if(!response.ok) throw new Error(JSON.stringify(errorPayload(response.status,body,fallback+" HTTP "+response.status))); return body;
}
function registerToolsIpc(): void {
  ipcMain.handle("tools:list", async (event): Promise<ReturnType<typeof parseToolsResponse>> => { assertSender(event); const url=gatewayUrl(gatewayBase(),"api/tools"); const response=await fetch(url,{method:"GET",signal:AbortSignal.timeout(5000),headers:{Accept:"application/json","X-API-Key":localApiKey()}}); if (!response.ok) { const body=await response.json().catch(() => null); throw new Error(JSON.stringify(errorPayload(response.status,body,"Gateway tools HTTP "+response.status))); } let payload: unknown; try { payload=await response.json(); } catch { throw new Error(JSON.stringify({code:"tools_schema_error",message:"Tools response must be valid JSON"})); } return parseToolsResponse(payload); });
  ipcMain.handle("tools:call", async (event, raw: unknown) => { assertSender(event); if(!raw||typeof raw!=="object"||Array.isArray(raw)) throw new Error(JSON.stringify({code:"invalid_request",message:"Tool call request must be an object"})); const value=raw as Record<string,unknown>; if(typeof value.requestId!=="string"||!value.requestId.trim()||typeof value.tool!=="string"||!value.tool.trim()||!value.args||typeof value.args!=="object"||Array.isArray(value.args)) throw new Error(JSON.stringify({code:"invalid_request",message:"Invalid tool call request"})); const payload=await toolsJson("api/tools/call",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({requestId:value.requestId,tool:value.tool,args:value.args})},"X-API-Key","Tool call"); return parseToolCallResponse(payload); });
  ipcMain.handle("tools:pending", async (event) => { assertSender(event); return parseApprovalListResponse(await toolsJson("admin/approvals",{method:"GET"},"X-Admin-Key","Approval list")); });
  for(const decision of ["approve","deny"] as const) ipcMain.handle("tools:"+decision, async (event, rawId: unknown) => { assertSender(event); if(typeof rawId!=="string"||!rawId.trim()||rawId.length>256||/[\/\0]/.test(rawId)) throw new Error(JSON.stringify({code:"invalid_request",message:"Invalid approval id"})); const payload=await toolsJson("admin/approvals/"+encodeURIComponent(rawId),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({decision})},"X-Admin-Key","Approval decision"); return parseApprovalDecisionResponse(payload); });
}
const pluginPermissions = new Set(["fs.read", "fs.write", "net.http", "ui.toast", "tools.register", "log.write"]);
const pluginActions = new Set(["grant", "revoke", "enable", "disable", "load", "unload", "reload", "uninstall"]);
function registerPluginsIpc(): void {
  ipcMain.handle("plugins:list", async (event) => { assertSender(event); return adminJson("admin/plugins"); });
  ipcMain.handle("plugins:install", async (event) => {
    assertSender(event);
    const options: Electron.OpenDialogOptions = { title: "Choose a local plugin folder", properties: ["openDirectory"] };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    return adminJson("admin/plugins", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "install", source: result.filePaths[0] }) });
  });
  ipcMain.handle("plugins:action", async (event, raw: unknown) => {
    assertSender(event);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(JSON.stringify({ code: "invalid_request", message: "Plugin action must be an object" }));
    const input = raw as Record<string, unknown>;
    const action = typeof input.action === "string" ? input.action : "";
    const id = typeof input.id === "string" ? input.id : "";
    if (!pluginActions.has(action) || !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(id)) throw new Error(JSON.stringify({ code: "invalid_request", message: "Invalid plugin action or ID" }));
    const payload: Record<string, string> = { action, id };
    if (action === "grant" || action === "revoke") {
      const permission = typeof input.permission === "string" ? input.permission : "";
      if (!pluginPermissions.has(permission)) throw new Error(JSON.stringify({ code: "invalid_request", message: "Invalid plugin permission" }));
      payload.permission = permission;
    }
    return adminJson("admin/plugins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  });
}
const activePulls = new Map<number, { id: string; controller: AbortController }>();
function registerModelIpc(): void {
  ipcMain.on("models:pull-cancel", (event, id: unknown) => {
    assertSender(event);
    const current = activePulls.get(event.sender.id);
    if (current && current.id === id) current.controller.abort();
  });
  ipcMain.handle("models:pull-stream", async (event, raw: unknown) => {
    assertSender(event);
    if (!raw || typeof raw !== "object") throw new Error("Invalid model download request.");
    const {requestId, model} = raw as Record<string, unknown>;
    const id = required(requestId, "request id");
    const name = required(model, "model").trim();
    const sender = event.sender;
    const senderId = sender.id;
    if (activePulls.has(senderId)) throw new Error("A model download is already running.");
    const controller = new AbortController();
    const abort = () => controller.abort();
    activePulls.set(senderId, {id, controller});
    sender.once("destroyed", abort);
    app.once("before-quit", abort);
    try {
      const config = await adminJson("admin/config", {signal: controller.signal}) as {values?: {upstream_host?: string; upstream_port?: number}};
      const host = config.values?.upstream_host || "127.0.0.1";
      const port = config.values?.upstream_port;
      if (!port || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid Ollama port.");
      const target = new URL("http://127.0.0.1/api/pull");
      target.hostname = host === "::1" ? "[::1]" : host;
      target.port = String(port);
      const response = await fetch(target, {
        method: "POST", signal: controller.signal, redirect: "error",
        headers: {"Content-Type": "application/json", Accept: "application/x-ndjson"},
        body: JSON.stringify({model: name, stream: true}),
      });
      await readPullStream(response, (progress) => {
        if (!sender.isDestroyed()) sender.send("models:pull-progress", id, progress);
      });
      return { cancelled: false };
    } catch (reason) {
      if (controller.signal.aborted) return { cancelled: true };
      if (reason instanceof TypeError && reason.message === "fetch failed") throw new Error("Cannot connect to Ollama. Check that the model service is running.");
      throw reason;
    } finally {
      sender.removeListener("destroyed", abort);
      app.removeListener("before-quit", abort);
      activePulls.delete(senderId);
    }
  });
  ipcMain.handle(modelChannels.list, async (event) => { assertSender(event); return adminJson("admin/models"); });
  ipcMain.handle(modelChannels.pull, async (event, model: unknown) => { assertSender(event); return adminJson("admin/models/pull", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ model: required(model, "model") }) }); });
  ipcMain.handle(modelChannels.remove, async (event, model: unknown) => { assertSender(event); return adminJson("admin/models/delete", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ model: required(model, "model") }) }); });
  ipcMain.handle(modelChannels.start, async (event, model: unknown) => { assertSender(event); return adminJson("admin/models/start", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ model: required(model, "model") }) }); });
  ipcMain.handle(modelChannels.stop, async (event, model: unknown) => { assertSender(event); return adminJson("admin/models/stop", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ model: required(model, "model") }) }); });
}
// ---------- integrated host / guest networking ----------
const netChannels = { connect:"network:connect", network:"network:info", tunnel:"network:tunnel", networkSave:"network:save", tunnelStatus:"network:tunnelStatus", get:"network:get", clients:"network:clients", disconnect:"network:disconnect" } as const;
function registerNetworkIpc(): void {
  ipcMain.handle(netChannels.connect, async (event, raw: unknown) => {
    assertSender(event);
    const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const base = typeof value.baseUrl === "string" && value.baseUrl.trim() ? value.baseUrl.trim().replace(/\/+$/, "") : "http://127.0.0.1:11435";
    let target: URL;
    try { target = new URL(base + "/connect"); } catch { throw new Error("Invalid server address"); }
    if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error("Server address must be http(s)");
    const response = await fetch(target, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: typeof value.name === "string" ? value.name : "", password: typeof value.password === "string" ? value.password : "" }), signal: AbortSignal.timeout(20000) });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !payload || payload.ok !== true) { const error = errorPayload(response.status, payload, "Connection failed"); throw new Error(JSON.stringify(error)); }
    return payload;
  });
  ipcMain.handle(netChannels.network, async (event) => { assertSender(event); return adminJson("admin/network"); });
  ipcMain.handle(netChannels.networkSave, async (event, raw: unknown) => { assertSender(event); return adminJson("admin/network", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(raw && typeof raw === "object" ? raw : {}) }); });
  ipcMain.handle(netChannels.tunnelStatus, async (event) => { assertSender(event); return adminJson("admin/tunnel", { method: "GET" }); });
  ipcMain.handle(netChannels.get, async (event, raw: unknown) => {
    assertSender(event);
    const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const base = typeof value.baseUrl === "string" ? value.baseUrl.trim().replace(/\/+$/, "") : "";
    const path = typeof value.path === "string" ? value.path.trim() : "";
    const allowed = ["/health", "/api/tags", "/api/version"];
    if (!allowed.includes(path)) throw new Error("Path not allowed");
    let target: URL;
    try { target = new URL(base + path); } catch { throw new Error("Invalid server address"); }
    if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error("Server address must be http(s)");
    const headers: Record<string, string> = { Accept: "application/json" };
    if (typeof value.token === "string" && value.token.trim()) headers.Authorization = "Bearer " + value.token.trim();
    const response = await fetch(target, { headers, signal: AbortSignal.timeout(15000) });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(JSON.stringify(errorPayload(response.status, payload, "Remote " + path + " HTTP " + response.status)));
    return payload ?? {};
  });
  ipcMain.handle(netChannels.tunnel, async (event, action: unknown) => { assertSender(event); return adminJson("admin/tunnel", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ action: action === "stop" ? "stop" : "start" }) }); });
  // Who is currently connected to this computer. Shown in Sharing so a stranger
  // in the list can be disconnected without stopping the whole share.
  ipcMain.handle(netChannels.clients, async (event) => {
    assertSender(event);
    try {
      const payload = await adminJson("admin/clients") as Record<string, unknown> | null;
      const list = Array.isArray(payload?.clients) ? payload!.clients as Record<string, unknown>[] : [];
      return {
        ok: true,
        total: typeof payload?.count === "number" ? payload.count : list.length,
        clients: list.map((entry) => ({
          ip: String(entry.ip ?? entry.address ?? ""),
          ua: typeof entry.ua === "string" ? entry.ua : "",
          requests: typeof entry.requests === "number" ? entry.requests : 0,
          conversations: typeof entry.conversations === "number" ? entry.conversations : 0,
          online: entry.online === true,
          last_seen: typeof entry.last_seen === "string" ? entry.last_seen : "",
          last_model: typeof entry.last_model === "string" ? entry.last_model : ""
        })).filter((entry) => entry.ip)
      };
    } catch (error) {
      return { ok: false, clients: [], error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(netChannels.disconnect, async (event, rawIp: unknown) => {
    assertSender(event);
    const ip = typeof rawIp === "string" ? rawIp.trim() : "";
    if (!ip || ip.length > 64) return { ok: false, error: "invalid_ip" };
    try {
      const payload = await adminJson("admin/clients/disconnect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ip }) }) as Record<string, unknown> | null;
      return { ok: payload?.ok !== false, ip, error: typeof payload?.error === "string" ? payload.error : undefined };
    } catch (error) {
      return { ok: false, ip, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
// ---------- system telemetry ----------
type SystemStats = { gpu: number | null; vramUsed: number | null; vramTotal: number | null; ramUsed: number; ramTotal: number; ai: number | null };
function registerSystemIpc(): void {
  ipcMain.handle("system:stats", async (event): Promise<SystemStats> => {
    assertSender(event);
    const total = os.totalmem();
    const used = total - os.freemem();
    const stats: SystemStats = { gpu: null, vramUsed: null, vramTotal: null, ramUsed: Math.round(used / 1024 / 1024), ramTotal: Math.round(total / 1024 / 1024), ai: null };
    const candidates = ["nvidia-smi"];
    for (const exe of candidates) {
      try {
        const output = await new Promise<string>((resolve, reject) => {
          execFile(exe, ["--query-gpu=utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"], { timeout: 4000, windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(String(stdout)));
        });
        const first = output.split(/\r?\n/).find((line) => line.trim());
        if (first) {
          const [gpu, vramUsed, vramTotal] = first.split(",").map((part) => Number(part.trim()));
          if (Number.isFinite(gpu)) stats.gpu = Math.round(gpu);
          if (Number.isFinite(vramUsed)) stats.vramUsed = Math.round(vramUsed / 1024 * 10) / 10;
          if (Number.isFinite(vramTotal)) stats.vramTotal = Math.round(vramTotal / 1024 * 10) / 10;
          stats.ai = stats.gpu;
        }
        break;
      } catch { /* no nvidia gpu or smi missing */ }
    }
    return stats;
  });
  // Free disk space is checked before a model download so the UI can refuse a
  // pull that would fill the volume instead of failing halfway through.
  ipcMain.handle("system:disk", (event, raw: unknown) => {
    assertSender(event);
    const requested = typeof raw === "string" && raw.trim() ? resolve(raw.trim()) : "";
    const target = requested && existsSync(requested) ? requested : app.getPath("userData");
    try {
      const info = statfsSync(target);
      return { path: target, free: Number(info.bavail) * Number(info.bsize), total: Number(info.blocks) * Number(info.bsize), ok: true };
    } catch {
      return { path: target, free: 0, total: 0, ok: false };
    }
  });
  // The settings page shows real folders instead of names like "default location".
  ipcMain.handle("system:paths", (event) => {
    assertSender(event);
    const settings = readSettings();
    return {
      cache: settings.cacheDir || cachePath(),
      cacheDefault: defaultCacheDir,
      appData: userDataDir,
      workspace: selectedFilesRoot || "",
    };
  });
  // Reveal a folder the settings page already shows; anything else is refused.
  ipcMain.handle("shell:reveal", async (event, raw: unknown) => {
    assertSender(event);
    const target = typeof raw === "string" ? resolve(raw.trim()) : "";
    if (!target) throw new Error("Path is empty");
    const settings = readSettings();
    const allowed = [userDataDir, cachePath(), settings.cacheDir].filter(Boolean).map((item) => resolve(String(item)));
    if (!allowed.includes(target)) throw new Error("Path is not one of the app folders");
    const error = await shell.openPath(target);
    return { ok: !error, error };
  });
  // Native toast for long-running work the user has almost certainly tabbed away from.
  ipcMain.handle("system:notify", (event, raw: unknown) => {
    assertSender(event);
    const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const title = typeof value.title === "string" ? value.title.slice(0, 120) : "";
    const body = typeof value.body === "string" ? value.body.slice(0, 400) : "";
    if (!title) return { ok: false };
    if (!Notification.isSupported()) return { ok: false };
    try {
      const toast = new Notification({ title, body, silent: false });
      toast.on("click", () => { if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
      toast.show();
      return { ok: true };
    } catch { return { ok: false }; }
  });
}
// ---------- credential vault ----------
// Secrets used to live in plaintext JSON next to the settings file. They now go
// through safeStorage (DPAPI on Windows), so a copied profile folder leaks nothing.
function credentialsPath(): string { return join(app.getPath("userData"), "orbit-credentials.bin"); }
function readVault(): Record<string, string> {
  try { return JSON.parse(readFileSync(credentialsPath(), "utf8")) as Record<string, string>; } catch { return {}; }
}
function writeVault(vault: Record<string, string>): void {
  try { mkdirSync(app.getPath("userData"), { recursive: true }); writeFileSync(credentialsPath(), JSON.stringify(vault), { encoding: "utf8", mode: 0o600 }); } catch { /* ignore */ }
}
function registerCredentialsIpc(): void {
  ipcMain.handle("credentials:get", (event, rawKey: unknown) => {
    assertSender(event);
    const key = typeof rawKey === "string" ? rawKey.trim() : "";
    if (!key || key.length > 128) return null;
    const sealed = readVault()[key];
    if (typeof sealed !== "string" || !sealed) return null;
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      return safeStorage.decryptString(Buffer.from(sealed, "base64"));
    } catch { return null; }
  });
  ipcMain.handle("credentials:set", (event, rawKey: unknown, rawValue: unknown) => {
    assertSender(event);
    const key = typeof rawKey === "string" ? rawKey.trim() : "";
    const value = typeof rawValue === "string" ? rawValue : "";
    if (!key || key.length > 128) return { ok: false, encrypted: false };
    if (!value) { const vault = readVault(); delete vault[key]; writeVault(vault); return { ok: true, encrypted: true }; }
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, encrypted: false };
    const vault = readVault();
    vault[key] = safeStorage.encryptString(value).toString("base64");
    writeVault(vault);
    return { ok: true, encrypted: true };
  });
  ipcMain.handle("credentials:remove", (event, rawKey: unknown) => {
    assertSender(event);
    const key = typeof rawKey === "string" ? rawKey.trim() : "";
    if (!key) return { ok: false };
    const vault = readVault();
    delete vault[key];
    writeVault(vault);
    return { ok: true };
  });
}
// ---------- settings + in-app preview ----------
let previewView: WebContentsView | null = null;
function previewBounds(win: BrowserWindow): Electron.Rectangle {
  const { width, height } = win.getContentBounds();
  const paneWidth = Math.max(360, Math.round(width * 0.45));
  return { x: width - paneWidth, y: 40, width: paneWidth, height: height - 40 };
}
function closePreview(): void {
  if (!previewView) return;
  try { mainWindow?.contentView.removeChildView(previewView); } catch { /* ignore */ }
  try { previewView.webContents.close(); } catch { /* ignore */ }
  previewView = null;
}
function registerSettingsIpc(): void {
  ipcMain.handle("github:stars", async (event) => {
    assertSender(event);
    try {
      const response = await fetch("https://api.github.com/repos/CarrisFlynn/hymnix-ai-server", { headers: { Accept: "application/vnd.github+json", "User-Agent": "Hymnix-Orbit" }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) return { ok: false, stars: null };
      const data = await response.json() as { stargazers_count?: number };
      return { ok: true, stars: typeof data.stargazers_count === "number" ? data.stargazers_count : null };
    } catch { return { ok: false, stars: null }; }
  });
  ipcMain.handle("gateway:restart", (event) => { assertSender(event); return gateway.restart(); });
ipcMain.handle("app:log", async (event, message: unknown) => { assertSender(event); bootLog("renderer: " + String(message).slice(0, 400)); return true; });
  ipcMain.handle("app:bootstrap", (event) => { assertSender(event); return gateway.bootstrap(); });
ipcMain.handle("settings:get", async (event) => { assertSender(event); return readSettings(); });
  ipcMain.handle("settings:set", async (event, raw: unknown) => { assertSender(event); return writeSettings(raw && typeof raw === "object" ? raw as Record<string, unknown> : {}); });
  ipcMain.handle("preview:open", async (event, raw: unknown) => {
    assertSender(event);
    const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const target = typeof value.target === "string" ? value.target.trim() : "";
    if (!target) throw new Error("Preview target is empty");
    if (!mainWindow) throw new Error("No window");
    const url = /^https?:\/\//i.test(target) ? target : pathToFileURL(target).toString();
    if (previewView) { await previewView.webContents.loadURL(url); return { ok: true, reused: true }; }
    const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    previewView = view;
    mainWindow.contentView.addChildView(view);
    view.setBounds(previewBounds(mainWindow));
    await view.webContents.loadURL(url);
    return { ok: true };
  });
  ipcMain.handle("preview:close", async (event) => { assertSender(event); closePreview(); return { ok: true }; });
  ipcMain.handle("preview:resize", async (event) => { assertSender(event); if (previewView && mainWindow) previewView.setBounds(previewBounds(mainWindow)); return { ok: true }; });
}
registerSettingsIpc();
registerSystemIpc();
// ---------- cloud api settings ----------
function registerCloudIpc(): void {
  ipcMain.handle("ollama:control", async (event, action: unknown): Promise<OllamaControlResult> => {
    assertSender(event);
    const command = action === "start" || action === "stop" ? action : "status";
    const payload = await adminJson("admin/ollama", {
      method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({action: command}),
    }) as Partial<OllamaControlResult>;
    if (typeof payload.ok !== "boolean" || typeof payload.online !== "boolean") {
      throw new Error(JSON.stringify({code: "ollama_schema_error", message: "Invalid Ollama control response"}));
    }
    const ready = payload.online && payload.ready !== false;
    if (command === "start" && payload.ok && !ready) {
      const code = "ollama_start_timeout";
      return {...payload, ok: false, online: payload.online, ready, code, error: code,
        detail: payload.detail || "Ollama did not become ready before the startup deadline."};
    }
    return {...payload, ok: payload.ok, online: payload.online, ready};
  });
  ipcMain.handle("config:get", async (event) => { assertSender(event); return adminJson("admin/config", { method: "GET" }); });
  ipcMain.handle("config:set", async (event, raw: unknown) => { assertSender(event); return adminJson("admin/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(raw && typeof raw === "object" ? raw : {}) }); });
  ipcMain.handle("cloud:get", async (event) => {
    assertSender(event);
    await gateway.bootstrap();
    return adminJson("admin/cloud");
  });
  ipcMain.handle("cloud:save", async (event, raw: unknown) => { assertSender(event); return adminJson("admin/cloud", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(raw && typeof raw === "object" ? raw : {}) }); });
  ipcMain.handle("cloud:test", async (event) => { assertSender(event); return adminJson("admin/cloud/test", { method:"POST", headers:{ "Content-Type":"application/json" }, body: "{}" }); });
}
// ---------- tray ----------
// Hiding to the tray is only offered when sharing is on, so a user who keeps the
// window closed still has a way back and a way to quit cleanly.
let tray: Tray | null = null;
function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
function ensureTray(): void {
  if (tray) return;
  const icon = app.isPackaged
    ? join(process.resourcesPath, "assets", "hymnix-red-white-star.png")
    : join(productRoot, "desktop", "src", "renderer", "assets", "hymnix-red-white-star.png");
  if (!existsSync(icon)) return;
  try { tray = new Tray(icon); } catch { return; }
  tray.setToolTip("Hymnix Orbit");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Hymnix Orbit", click: () => showWindow() },
    { type: "separator" },
    { label: "Quit", click: () => { app.quit(); } }
  ]));
  tray.on("click", () => showWindow());
}
function disposeTray(): void {
  if (!tray) return;
  try { tray.destroy(); } catch { /* ignore */ }
  tray = null;
}
ipcMain.handle("window:control", (event, raw: unknown) => {
  assertSender(event);
  const action = typeof raw === "string" ? raw : "";
  const win = BrowserWindow.fromWebContents(event.sender);
  if (action === "restart") { allowQuit = true; app.relaunch(); app.quit(); return { ok: true }; }
  if (!win) return { ok: false };
  if (action === "minimize") win.minimize();
  else if (action === "maximize") win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === "close") win.close();
  else if (action === "hide") { ensureTray(); win.hide(); return { ok: true, hidden: true, maximized: win.isMaximized() }; }
  else return { ok: false };
  return { ok: true, maximized: win.isMaximized(), hidden: false };
});
ipcMain.handle("window:appearance", (event, raw: unknown) => {
  assertSender(event);
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !raw || typeof raw !== "object") return { ok: false };
  const input = raw as { mode?: unknown; backgroundColor?: unknown };
  if (input.mode !== "light" && input.mode !== "dark" && input.mode !== "auto") return { ok: false };
  if (typeof input.backgroundColor !== "string" || !/^#[\da-f]{6}$/i.test(input.backgroundColor)) return { ok: false };
  nativeTheme.themeSource = input.mode === "auto" ? "system" : input.mode;
  win.setBackgroundColor(input.backgroundColor);
  return { ok: true };
});
ipcMain.handle("shell:open", async (event, raw: unknown) => { assertSender(event); const url = typeof raw === "string" ? raw.trim() : ""; if (!/^https?:\/\//i.test(url)) throw new Error("Only http(s) links are allowed"); await shell.openExternal(url); return { ok: true }; });
registerCloudIpc();
registerNetworkIpc();
registerCredentialsIpc();
registerTerminalIpc();
registerModelIpc();
registerToolsIpc();
registerPluginsIpc();

registerGatewayIpc();
function createWindow(){
  const icon = app.isPackaged
    ? join(process.resourcesPath, "assets", "hymnix-red-white-star.png")
    : join(productRoot, "desktop", "src", "renderer", "assets", "hymnix-red-white-star.png");
  const win=new BrowserWindow({width:1440,height:900,minWidth:800,minHeight:560,frame:false,titleBarStyle:"hidden",fullscreen:readSettings().startFullscreen,backgroundColor:nativeTheme.shouldUseDarkColors?"#151c27":"#fdf7f7",...(existsSync(icon)?{icon}:{}),webPreferences:{preload:join(__dirname,"../preload/preload.js"),contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true}});win.webContents.setWindowOpenHandler(()=>({action:"deny"}));win.webContents.on("will-navigate",(event,url)=>{if(!isAllowedRendererUrl(url))event.preventDefault()});void win.loadURL(rendererUrl);mainWindow=win;
  win.webContents.on("did-start-loading", () => terminalBridge.stop());
  win.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => { if (isMainFrame) bootLog(`renderer load failed code=${code} description=${description} url=${url}`); });
  win.webContents.on("did-finish-load", () => bootLog("renderer finished loading"));
  win.webContents.on("render-process-gone", (_event, details) => { bootLog(`renderer process exited reason=${details.reason} code=${details.exitCode}`); void terminalBridge.stop(); });
  win.webContents.once("destroyed", () => terminalBridge.stop());
  win.on("resize",()=>{if(previewView)previewView.setBounds(previewBounds(win));});win.on("closed",()=>{if(mainWindow===win)mainWindow=null;});}
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) { app.quit(); } else { app.on("second-instance",()=>{ if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } }); }
const bootSettings = readSettings();
if (!bootSettings.gpuAcceleration) { try { app.disableHardwareAcceleration(); } catch { /* ignore */ } }
// Electron's own "cache" default lands in the roaming root on Windows, which is
// both wrong-looking and shared with other apps. Pin it to <userData>\Cache so
// the settings page can show the folder the app really writes to.
const userDataDir = app.getPath("userData");
const defaultCacheDir = join(userDataDir, "Cache");
try { const cacheDir = bootSettings.cacheDir || defaultCacheDir; mkdirSync(cacheDir, { recursive: true }); app.setPath("cache", cacheDir); } catch { /* ignore */ }
app.whenReady().then(async()=>{if (!hasInstanceLock) return; const bootT0=Date.now();bootLog("boot start");Menu.setApplicationMenu(null);protocol.handle("app",(request)=>{ const url=new URL(request.url); const relative=decodeURIComponent(url.pathname).replace(/^\/+/, "")||"index.html"; const target=join(rendererRoot,relative); if(!target.startsWith(rendererRoot)) return new Response("Forbidden",{status:403}); return net.fetch(pathToFileURL(target).toString()); });session.defaultSession.webRequest.onHeadersReceived((details,callback)=>callback({responseHeaders:{...details.responseHeaders,"Content-Security-Policy":["default-src 'self'; connect-src 'self' http://127.0.0.1:* http://localhost:*; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'"]}}));bootLog("pre-window t=" + (Date.now()-bootT0)); createWindow(); bootLog("window created t=" + (Date.now()-bootT0)); void gateway.start();app.on("activate",()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});}).catch((error)=>{console.error(error);app.quit();});
let allowQuit = false;
let quitCleanup: Promise<void> | undefined;
app.on("before-quit", (event) => {
  if (!hasInstanceLock || allowQuit) return;
  event.preventDefault();
  if (quitCleanup) return;
  terminalBridge.stop();
  for (const controller of chatControllers.values()) controller.abort();
  chatControllers.clear();
  quitCleanup = gateway.stop().catch((error: unknown) => bootLog("gateway shutdown failed: " + String(error))).finally(() => {
    allowQuit = true;
    app.quit();
  });
});
app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit();});
