import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const out = resolve(cwd, "../docs/screenshots");
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-shots-readme", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });

const iso = new Date().toISOString();
const ymd = iso.slice(0, 10);
const session = {
  id: "readme-demo", name: "Where do the tools run?", createdAt: iso, updatedAt: iso,
  count: 4, model: "qwen3:8b", draft: "", pinned: false,
  messages: [
    { role: "user", content: "Where do the tools run now that the agent is local?" },
    { role: "assistant", content: "Inside this desktop process. Files, patches, repositories, commands, terminals and web fetches all moved out of the Python gateway, so they answer with the gateway stopped — which is the normal case, because the gateway exists for sharing only." },
    { role: "user", content: "And when a friend connects to my machine?" },
    { role: "assistant", content: "Then the model stays here and the tools run on their computer. The shared endpoint returns model output and tool calls; it never reads this machine's disk. A guest asking for a file here gets files_local_only." },
  ],
};
const sessions = [session];
await win.evaluate(([rows]) => {
  localStorage.setItem("hymnix.welcome", "1");
  localStorage.setItem("hymnix.whatsNew", window.__hymnixDev.version);
  localStorage.setItem("hymnix.lang", "en");
  localStorage.setItem("hymnix.surface", "orbit");
  localStorage.setItem("hymnix.chat.sessions.v2", JSON.stringify(rows));
}, [sessions]);
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 60; i += 1) { const b = await win.evaluate(() => window.hymnix.bootstrap()); if (b.ready) break; await win.waitForTimeout(500); }
await win.evaluate(() => window.__hymnixDev.navigate("Chat"));
await win.waitForTimeout(900);
// Open the seeded session from the sidebar
await win.evaluate(() => { const b = [...document.querySelectorAll('button, a, li')].find((x) => /Where do the tools run/i.test(x.textContent || '')); b?.click(); });
await win.waitForTimeout(1200);
await win.evaluate(() => { document.activeElement?.blur(); const sc = document.querySelector('.chat-scroll'); if (sc) sc.scrollTop = 0; });
await win.waitForTimeout(600);
await win.screenshot({ path: resolve(out, "orbit-chat.png") });
console.log("SHOT chat");

// Terminal
await win.evaluate(() => window.__hymnixDev.navigate("Terminal"));
await win.waitForTimeout(800);
await win.evaluate(() => { const b = [...document.querySelectorAll(".term-mode-switch button")].find((x) => /TERMINAL/i.test(x.textContent)); b?.click(); });
await win.waitForTimeout(800);
await win.evaluate(() => { const sel = document.querySelector(".pty-bar select"); if (sel) { sel.value = "agent"; sel.dispatchEvent(new Event("change", { bubbles: true })); } });
await win.waitForTimeout(400);
await win.evaluate(() => document.querySelector(".pty-bar .term-btn")?.click());
await win.waitForTimeout(6000);
await win.evaluate(() => window.hymnix.pty.write("shot", "\r"));
await win.waitForTimeout(2500);
await win.screenshot({ path: resolve(out, "orbit-terminal.png") });
console.log("SHOT terminal");

await win.evaluate(() => window.__hymnixDev.navigate("Models"));
await win.waitForTimeout(1800);
await win.screenshot({ path: resolve(out, "orbit-models.png") });
console.log("SHOT models");

await win.evaluate(() => window.__hymnixDev.navigate("Gateway"));
await win.waitForTimeout(1500);
await win.screenshot({ path: resolve(out, "orbit-sharing.png") });
console.log("SHOT sharing");
await app.close();