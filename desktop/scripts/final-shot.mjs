import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-final", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1926, height: 1200 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 40; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
await win.evaluate(() => window.__hymnixDev.navigate("Changelog"));
await win.waitForTimeout(1500);
const zh = await win.evaluate(() => {
  const text = document.querySelector(".timeline")?.innerText || "";
  return { hasChineseBody: /补上桌面端缺的四件事|评测|审批收件箱/.test(text), length: text.length, sample: text.slice(0, 120) };
});
console.log("CHANGELOG_ZH", JSON.stringify(zh));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/changelog-zh.png") });
await win.evaluate(() => window.__hymnixDev.navigate("Chat"));
await win.waitForTimeout(1200);
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/final-chat-1926.png") });
await app.close();
