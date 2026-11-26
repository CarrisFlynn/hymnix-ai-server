import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-revoke", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); localStorage.setItem("hymnix.approvals.always.v1", JSON.stringify(["fs.write"])); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
await win.evaluate(() => { window.__hymnixDev.seedApprovals([{ id: "revoke-1", tool: "fs.write", risk: "moderate", reasons: ["writes a file"], argsRedacted: { path: "x.txt" }, createdAt: Date.now() }]); window.__hymnixDev.openApprovals(); });
await win.waitForTimeout(600);
const before = await win.evaluate(() => ({ buttons: [...document.querySelectorAll(".approval-row button")].map((el) => el.textContent?.trim()), rows: document.querySelectorAll(".approval-row").length }));
console.log("BEFORE " + JSON.stringify(before));
await win.evaluate(() => { const b = [...document.querySelectorAll(".approval-row button")].find((el) => (el.textContent || "").includes("撤销")); b?.click(); });
await win.waitForTimeout(800);
const after = await win.evaluate(() => ({
  always: JSON.parse(localStorage.getItem("hymnix.approvals.always.v1") || "[]"),
  rows: document.querySelectorAll(".approval-row").length,
  dialog: Boolean(document.querySelector(".risk-dialog")),
  label: [...document.querySelectorAll(".approval-row button")].map((el) => el.textContent?.trim()).find((text) => text?.includes("允许")),
}));
console.log("AFTER " + JSON.stringify(after));
await app.close();
