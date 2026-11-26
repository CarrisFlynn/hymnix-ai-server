import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import net from "node:net";

const serverDir = resolve(process.cwd(), "../server");
const dir = mkdtempSync(join(tmpdir(), "hx-sec-"));
const child = spawn("python", ["-u", "headless_gateway.py"], { cwd: serverDir, env: { ...process.env, HYMNIX_DESKTOP_CONTROL_DIR: dir }, stdio: ["ignore", "pipe", "pipe"] });
let ready = null;
for (let i = 0; i < 100; i += 1) {
  await new Promise((r) => setTimeout(r, 200));
  const file = join(dir, "ready.json");
  if (existsSync(file)) { ready = JSON.parse(readFileSync(file, "utf8")); break; }
}
if (!ready) { console.log("NO_READY"); child.kill(); process.exit(1); }
const cfgPath = join(process.env.LOCALAPPDATA || "", "Hymnix", "gateway_config.json");
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const apiKey = cfg.api_key;
const adminKey = cfg.admin_key;
const base = "http://127.0.0.1:" + ready.port;
const results = {};

const post = async (path, key) => {
  try {
    const response = await fetch(base + path, { method: "POST", headers: { "X-API-Key": key, "Content-Type": "application/json" }, body: JSON.stringify({ model: "x" }) });
    return { status: response.status, body: (await response.text()).slice(0, 120) };
  } catch (error) { return { error: String(error).slice(0, 120) }; }
};
results.pull_plain = await post("/api/pull", apiKey);
results.pull_encoded = await post("/api/%70ull", apiKey);
results.pull_slashes = await post("/api//pull", apiKey);

// request smuggling: chunked first request, then a smuggled admin GET
const smuggle = await new Promise((resolvePromise) => {
  const socket = net.connect(ready.port, "127.0.0.1", () => {
    socket.write("POST /connect HTTP/1.1\r\nHost: 127.0.0.1\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n");
    socket.write("GET /admin/config?key=" + encodeURIComponent(adminKey) + " HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
  });
  let data = "";
  socket.on("data", (chunk) => { data += chunk.toString(); });
  socket.on("close", () => resolvePromise({ responses: (data.match(/HTTP\/1\.1/g) || []).length, head: data.slice(0, 200).replace(/\r?\n/g, " ") }));
  socket.on("error", (error) => resolvePromise({ error: String(error).slice(0, 100) }));
  setTimeout(() => { socket.destroy(); resolvePromise({ responses: (data.match(/HTTP\/1\.1/g) || []).length, head: data.slice(0, 200).replace(/\r?\n/g, " ") }); }, 3000);
});
results.smuggle = smuggle;

console.log("SEC_PROBE " + JSON.stringify(results));
child.kill();
try { execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"]); } catch { /* gone */ }
rmSync(dir, { recursive: true, force: true });
