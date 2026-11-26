import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-always9", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); localStorage.removeItem("hymnix.approvals.always.v1"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 60; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
const call = await win.evaluate(() => window.hymnix.tools.call({ requestId: "always9-" + Date.now(), tool: "fs.write", args: { path: "always9.txt", content: "ok" } }));
console.log("CALL " + JSON.stringify({ ok: call.ok, error: call.error, hasApproval: Boolean(call.approval_required), id: call.approval_required?.id }));
const approval = call.approval_required;
if (!approval) { console.log("NO_APPROVAL"); await app.close(); process.exit(0); }
await win.evaluate((row) => { window.__hymnixDev.seedApprovals([{ id: row.id, tool: row.tool, risk: row.risk || "moderate", reasons: row.reasons || [], argsRedacted: row.argsRedacted || row.args || {}, createdAt: Date.now() }]); window.__hymnixDev.openApprovals(); }, approval);
await win.waitForTimeout(400);
console.log("SEEDED " + JSON.stringify(await win.evaluate(() => document.querySelectorAll(".approval-row").length)));
await win.evaluate(() => { const buttons = [...document.querySelectorAll(".approval-row button")]; buttons.find((el) => (el.textContent || "").includes("总是允许"))?.click(); });
await win.waitForTimeout(500);
console.log("DIALOG " + JSON.stringify(await win.evaluate(() => ({ open: Boolean(document.querySelector(".risk-dialog")), title: document.querySelector(".risk-dialog h3")?.textContent?.trim() }))));
await win.evaluate(() => { document.querySelector(".risk-ack input")?.click(); });
await win.waitForTimeout(200);
await win.evaluate(() => { const b = [...document.querySelectorAll(".risk-dialog .btn")].find((el) => (el.textContent || "").includes("总是允许")); b?.click(); });
for (let i = 0; i < 20; i += 1) {
  await win.waitForTimeout(500);
  const state = await win.evaluate(() => ({ rows: document.querySelectorAll(".approval-row").length, alert: document.querySelector(".drawer-alert, [role=alert]")?.textContent?.trim()?.slice(0, 120) ?? null }));
  if (state.rows === 0) break;
  if (i === 19) console.log("LAST " + JSON.stringify(state));
}
const final = await win.evaluate(async () => ({
  rows: document.querySelectorAll(".approval-row").length,
  always: JSON.parse(localStorage.getItem("hymnix.approvals.always.v1") || "[]"),
  error: document.querySelector(".drawer-alert, [role=alert]")?.textContent?.trim()?.slice(0, 120) ?? null,
  pending: await window.hymnix.tools.pending().then((r) => r.approvals?.length ?? -1).catch(() => -2),
}));
console.log("RESULT " + JSON.stringify(final));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/always-allow-9.png") });
await app.close();
