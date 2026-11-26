import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import http from "node:http";
const serverDir = resolve(process.cwd(), "../server");
const dir = mkdtempSync(join(tmpdir(), "hx-err-"));
const child = spawn("python", ["-u", "headless_gateway.py"], { cwd: serverDir, env: { ...process.env, HYMNIX_DESKTOP_CONTROL_DIR: dir }, stdio: ["ignore", "pipe", "pipe"] });
let err = "";
child.stderr.on("data", (c) => { err += c.toString(); });
child.stdout.on("data", (c) => { err += c.toString(); });
let ready = null;
for (let i = 0; i < 100; i += 1) { await new Promise((r) => setTimeout(r, 250)); const f = join(dir, "ready.json"); if (existsSync(f)) { try { ready = JSON.parse(readFileSync(f, "utf8")); } catch {} if (ready) break; } }
const cfg = JSON.parse(readFileSync(join(process.env.LOCALAPPDATA || "", "Hymnix", "gateway_config.json"), "utf8"));
const req = (path) => new Promise((done) => {
  const r = http.request({ host: "127.0.0.1", port: ready.port, method: "POST", path, headers: { "X-API-Key": cfg.api_key, "Content-Type": "application/json", "Content-Length": 2 } }, (res) => { let d = ""; res.on("data", (c) => d += c); res.on("end", () => done({ status: res.statusCode, body: d.slice(0, 100) })); });
  r.on("error", (e) => done({ error: String(e) })); r.write("{}"); r.end();
});
const out = {};
out.plain = await req("/api/pull");
out.encoded = await req("/api/%70ull");
await new Promise((r) => setTimeout(r, 800));
console.log("PROBE " + JSON.stringify(out));
console.log("LOG " + JSON.stringify(err.split("\n").filter((l) => l.includes("Traceback") || l.includes("Error") || l.includes("line ") || l.includes("admin_only")).slice(-12)));
child.kill();
try { execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" }); } catch {}
rmSync(dir, { recursive: true, force: true });
