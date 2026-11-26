import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";

/**
 * Full UI inventory for one build, so 1.3.3 and 1.4.0 can be compared item by item.
 * argv: <exe path or "."> <profile dir> <label> <out dir>
 */
const [, , target, profile, label, outDir] = process.argv;
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const launch = target === "." ? { args: ["--user-data-dir=" + profile, "."], cwd, env } : { executablePath: resolve(target), args: ["--user-data-dir=" + profile], cwd, env };
const app = await electron.launch(launch);
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 90000 });
await win.evaluate(() => {
  localStorage.setItem("hymnix.welcome", "1");
  localStorage.setItem("hymnix.lang", "zh");
  localStorage.setItem("hymnix.whatsNew", "9.9.9");
  localStorage.removeItem("hymnix.chat.sessions.v2");
});
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 90000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
await win.waitForTimeout(3500);

const text = (selector) => [...document.querySelectorAll(selector)].map((el) => (el.textContent || "").trim()).filter(Boolean);
const inventory = await win.evaluate(() => {
  const txt = (selector) => [...document.querySelectorAll(selector)].map((el) => (el.textContent || "").trim()).filter(Boolean);
  const attr = (selector, name) => [...document.querySelectorAll(selector)].map((el) => el.getAttribute(name)).filter(Boolean);
  return {
    title: document.title,
    version: window.__hymnixDev?.version ?? null,
    surfaceLabel: document.querySelector(".side-product, .product-switch, .side-brand")?.textContent?.trim() ?? null,
    nav: txt(".nav-item, .side-nav button, nav.side-nav button"),
    navHtml: document.querySelector(".side-nav")?.innerHTML?.slice(0, 600) ?? null,
    workspaceLabels: txt(".side-group-title, .side-section-title, .workspace-title"),
    chatTabs: txt(".chat-tabs button"),
    chatHeadActions: [...document.querySelectorAll(".chat-head-actions button")].map((el) => el.getAttribute("aria-label") || el.textContent?.trim()),
    emptyBlocks: txt(".empty-card, .orbit-board, .model-ready, .empty-state, .welcome-card"),
    emptyHeadings: txt(".empty-card strong, .orbit-board strong, .model-ready strong, .empty-state strong"),
    actionCards: txt(".orbit-action strong, .orbit-action span"),
    composerChips: [...document.querySelectorAll(".composer .cb-chip, .composer .cb-icon, .composer button")].map((el) => (el.getAttribute("aria-label") || el.textContent || "").trim()).filter(Boolean),
    composerHint: document.querySelector(".composer-hint")?.textContent?.trim() ?? null,
    statusBar: txt(".statusbar span, .status-bar span, .statusbar div").slice(0, 14),
    settingsNav: null,
  };
});

const pages = [];
const pageNames = ["对话", "模型", "共享", "插件", "更新日志", "赞助", "监控", "终端", "任务", "设置"];
for (const name of pageNames) {
  const clicked = await win.evaluate((label) => {
    const target = [...document.querySelectorAll(".nav-item, nav button, .side-nav button")].find((el) => (el.textContent || "").trim() === label);
    if (!target) return false;
    target.click();
    return true;
  }, name);
  if (!clicked) { pages.push({ name, present: false }); continue; }
  await win.waitForTimeout(700);
  const info = await win.evaluate(() => ({
    heading: document.querySelector(".view-page h2, .page-head h2")?.textContent?.trim() ?? null,
    sub: document.querySelector(".view-page .page-head p, .page-head p")?.textContent?.trim() ?? null,
    cards: [...document.querySelectorAll(".view-page .card-title, .view-page h3")].map((el) => el.textContent?.trim()).slice(0, 10),
    buttons: [...document.querySelectorAll(".view-page .btn")].map((el) => (el.textContent || "").trim()).filter(Boolean).slice(0, 14),
    empty: [...document.querySelectorAll(".view-page .empty-state, .view-page .panel-note")].map((el) => (el.textContent || "").trim()).slice(0, 3),
  }));
  pages.push({ name, present: true, ...info });
  await win.screenshot({ path: resolve(outDir, label + "-page-" + name + ".png") });
}

// settings sections
await win.evaluate(() => {
  const target = [...document.querySelectorAll(".nav-item, nav button")].find((el) => (el.textContent || "").trim() === "设置");
  target?.click();
});
await win.waitForTimeout(700);
const settings = await win.evaluate(() => ({
  sections: [...document.querySelectorAll(".settings-nav button")].map((el) => (el.textContent || "").trim()),
}));
for (const section of settings.sections) {
  await win.evaluate((name) => {
    const target = [...document.querySelectorAll(".settings-nav button")].find((el) => (el.textContent || "").trim() === name);
    target?.click();
  }, section);
  await win.waitForTimeout(450);
  const rows = await win.evaluate(() => [...document.querySelectorAll(".settings-content .setting-row, .settings-content .shortcut-list, .settings-content .theme-gallery-section")].map((el) => {
    const label = el.querySelector("label, strong");
    return (label?.textContent || el.className).trim().slice(0, 60);
  }).slice(0, 30));
  (inventory.settings ??= {})[section] = rows;
  await win.screenshot({ path: resolve(outDir, label + "-settings-" + section + ".png") });
}

// product switcher
await win.evaluate(() => { window.__hymnixDev?.navigate?.("Chat"); });
await win.waitForTimeout(500);
const switcher = await win.evaluate(() => {
  const trigger = document.querySelector(".side-product, .product-switch, .side-brand");
  const before = trigger ? trigger.textContent?.trim() : null;
  trigger?.click();
  return { before, menu: [...document.querySelectorAll(".product-menu button, .surface-menu button, [role=menu] button")].map((el) => (el.textContent || "").trim()) };
});
await win.waitForTimeout(600);
const switcherAfter = await win.evaluate(() => ({
  menu: [...document.querySelectorAll(".product-menu button, .surface-menu button, [role=menu] button, .menu-item")].map((el) => (el.textContent || "").trim()),
  bodyText: document.body.innerText.includes("Hymnix Orbit"),
}));
await win.screenshot({ path: resolve(outDir, label + "-switcher.png") });

const result = { ...inventory, pages, switcher, switcherAfter };
const fs = await import("node:fs");
fs.writeFileSync(resolve(outDir, label + "-inventory.json"), JSON.stringify(result, null, 2), "utf8");
console.log("INVENTORY " + label + " " + JSON.stringify({ nav: result.nav, tabs: result.chatTabs, switcher: switcherAfter.menu, settings: settings.sections, pages: pages.map((p) => p.name + ":" + (p.present ? (p.heading || "?") : "MISSING")) }));
await app.close();
