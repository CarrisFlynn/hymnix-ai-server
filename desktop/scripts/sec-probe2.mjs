import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import http from "node:http";
import net from "node:net";

const serverDir = resolve(process.cwd(), "../server");
const dir = mkdtempSync(join(tmpdir(), "hx-sec-"));
const child = spawn("python", ["-u", "headless_gateway.py"], { cwd: serverDir, env: { ...process.env, HYMNIX_DESKTOP_CONTROL_DIR: dir }, stdio: "ignore" });
let ready = null;
for (let i = 0; i < 100; i += 1) {
  await new Promise((r) => setTimeout(r, 250));
  const file = join(dir, "ready.json");
  if (existsSync(file)) { try { ready = JSON.parse(readFileSync(file, "utf8")); } catch { /* partial */ } if (ready) break; }
}
if (!ready) { console.log("NO_READY"); child.kill(); process.exit(1); }
const cfg = JSON.parse(readFileSync(join(process.env.LOCALAPPDATA || "", "Hymnix", "gateway_config.json"), "utf8"));
const apiKey = cfg.api_key || "";
const adminKey = cfg.admin_key || "";

const request = (method, path, headers, body) => new Promise((done) => {
  const req = http.request({ host: "127.0.0.1", port: ready.port, method, path, headers }, (res) => {
    let data = ""; res.on("data", (c) => { data += c; }); res.on("end", () => done({ status: res.statusCode, body: data.slice(0, 120) }));
  });
  req.on("error", (error) => done({ error: String(error) }));
  req.setTimeout(4000, () => { req.destroy(); done({ error: "timeout" }); });
  if (body) req.write(body);
  req.end();
});

const post = (path) => request("POST", path, { "X-API-Key": apiKey, "Content-Type": "application/json", "Content-Length": Buffer.byteLength("{}") }, "{}");
const out = {};
out.health = await request("GET", "/health", {}, null);
out.pull_plain = await post("/api/pull");
out.pull_encoded = await post("/api/%70ull");
out.pull_slashes = await post("/api//pull");
out.smuggle = await new Promise((done) => {
  const socket = net.connect(ready.port, "127.0.0.1", () => {
    socket.write("POST /connect HTTP/1.1\r\nHost: 127.0.0.1\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n");
    socket.write("GET /admin/config?key=" + encodeURIComponent(adminKey) + " HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
  });
  let data = "";
  socket.on("data", (c) => { data += c.toString(); });
  const finish = () => done({ responses: (data.match(/HTTP\/1\.1/g) || []).length, head: data.slice(0, 160).replace(/\r?\n/g, " ") });
  socket.on("close", finish); socket.on("error", finish);
  setTimeout(() => { socket.destroy(); finish(); }, 3000);
});
console.log("SEC_PROBE " + JSON.stringify(out));
child.kill();
try { execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" }); } catch { /* gone */ }
rmSync(dir, { recursive: true, force: true });
