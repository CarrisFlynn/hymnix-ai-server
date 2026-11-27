import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const bin = "C:\\Users\\xiaoy\\AppData\\Local\\Temp\\lsp-probe\\node_modules\\typescript-language-server\\lib\\cli.mjs";
const root = process.cwd();
const file = resolve(root, "src/main/web-search.ts");
const child = spawn(process.execPath, [bin, "--stdio"], { cwd: root, windowsHide: true });
const enc = (o) => { const b = JSON.stringify(o); return "Content-Length: " + Buffer.byteLength(b) + "\r\n\r\n" + b; };
const uri = "file:///" + file.replace(/\\/g, "/");
let buf = "";
const seen = [];
child.stdout.on("data", (c) => {
  buf += c.toString();
  for (;;) { const i = buf.indexOf("\r\n\r\n"); if (i < 0) break; const len = Number(/content-length:\s*(\d+)/i.exec(buf.slice(0, i))[1]); if (buf.length < i + 4 + len) break; const body = buf.slice(i + 4, i + 4 + len); buf = buf.slice(i + 4 + len); let m; try { m = JSON.parse(body); } catch { continue; } seen.push(m.method || ("response:" + m.id)); if (m.method === "window/logMessage" || m.method === "window/showMessage") { console.log("LOG " + JSON.stringify(m.params).slice(0, 300)); } if (m.id === 1) { child.stdin.write(enc({ jsonrpc: "2.0", method: "initialized", params: {} })); child.stdin.write(enc({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "typescript", version: 1, text: readFileSync(file, "utf8") } } })); setTimeout(() => child.stdin.write(enc({ jsonrpc: "2.0", id: 2, method: "textDocument/documentSymbol", params: { textDocument: { uri } } })), 2500); } if (m.id === 2) { console.log("RESULT " + JSON.stringify(m.result).slice(0, 400)); console.log("METHODS " + seen.slice(0, 12).join(",")); child.kill(); process.exit(0); } }
});
child.stdin.write(enc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { processId: process.pid, rootUri: "file:///" + root.replace(/\\/g, "/"), capabilities: {}, workspaceFolders: [{ uri: "file:///" + root.replace(/\\/g, "/"), name: "root" }] } }));
setTimeout(() => { console.log("TIMEOUT methods=" + seen.join(",")); child.kill(); process.exit(1); }, 20000);