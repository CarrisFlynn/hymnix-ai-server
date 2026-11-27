import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const userData = "C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-cap";
const app = await electron.launch({ args: ["--user-data-dir=" + userData, "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 60; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
// a skill on disk, discovered through the real IPC
const dir = resolve(userData, "skills", "demo");
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, "SKILL.md"), "# Demo Skill\ndescription: Does demo things\n", "utf8");
const skills = await win.evaluate(() => window.hymnix.skills.list());
const loaded = await win.evaluate(() => window.hymnix.skills.read("demo"));
console.log("SKILLS " + JSON.stringify({ count: skills.skills?.length, first: skills.skills?.[0]?.name, loaded: loaded.ok }));
const reply = await win.evaluate(async () => {
  try { await window.hymnix.models.start("qwen3:0.6b"); } catch {}
  return window.hymnix.gateway.complete({ baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3:0.6b", kind: "openai", prompt: "只回复两个字：收到", system: "You are a subagent. Answer with the two words only." });
});
console.log("SUBAGENT " + JSON.stringify({ ok: reply.ok, text: (reply.text || "").slice(0, 40), error: (reply.error || "").slice(0, 60) }));
try { rmSync(dir, { recursive: true, force: true }); } catch {}
await app.close();
