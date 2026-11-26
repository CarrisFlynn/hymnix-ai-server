import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
const now = Date.now(), at = (m) => new Date(now - m * 60000).toISOString();
const sessions = ["Alpha","Bravo","Charlie","Delta","Echo"].map((n, i) => ({ id: "s"+i, name: n, createdAt: at(60-i), updatedAt: at(60-i), count: 0, model: "qwen3-vl:2b", draft: "", pinned: false, messages: [] }));
await win.addInitScript((data) => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.3.3"); localStorage.setItem("hymnix.chat.sessions.v2", JSON.stringify(data)); }, sessions);
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
await win.waitForTimeout(900);
const order = async () => win.evaluate(() => JSON.parse(localStorage.getItem("hymnix.chat.sessions.v2")||"[]").map(s=>s.name).join(","));
const dom = async () => win.evaluate(() => [...document.querySelectorAll(".side-session, .side-row")].map(e=>e.textContent.trim().split(/\s{2,}/)[0]).filter(Boolean).join(","));
const before = await order(); const domBefore = await dom();
const rows = win.locator(".side-session");
console.log("rows:", await rows.count());
await rows.nth(2).click();
await win.waitForTimeout(1500);
console.log("ORDER before:", before);
console.log("ORDER after :", await order());
console.log("DOM before  :", domBefore);
console.log("DOM after   :", await dom());
for (const h of [900, 700, 640]) {
  await win.setViewportSize({ width: 1200, height: h });
  await win.waitForTimeout(500);
  const chip = win.locator(".cb-chip.model");
  if (await chip.count()) {
    await chip.click(); await win.waitForTimeout(600);
    const m = await win.evaluate(() => { const p=document.querySelector(".model-panel")?.getBoundingClientRect(); return p ? {top:Math.round(p.top),bottom:Math.round(p.bottom),h:Math.round(p.height),vh:window.innerHeight,clipped:p.top<0||p.bottom>window.innerHeight} : null; });
    console.log("PICKER@"+h+":", JSON.stringify(m));
    await win.keyboard.press("Escape"); await win.mouse.click(600, 200); await win.waitForTimeout(300);
  }
}
await app.close();
