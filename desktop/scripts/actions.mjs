import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-actions", "."], cwd, env });
const win = await app.firstWindow();
const errors = [];
win.on("pageerror", (error) => errors.push(String(error).slice(0, 160)));
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.0"); localStorage.setItem("hymnix.lang","zh"); localStorage.removeItem("hymnix.chat.sessions.v2"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 40; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }
const out = {};
const check = async (name, fn) => { try { out[name] = await fn(); } catch (error) { out[name] = "ERROR " + String(error).slice(0, 120); } console.log("ACT " + name + " " + JSON.stringify(out[name])); };

// sessions: create two, rename, pin, delete + undo
await check("session_new", async () => { await win.keyboard.press("Control+n"); await win.waitForTimeout(600); return await win.locator(".side-session").count(); });
await check("session_rename", async () => {
  await win.locator(".chat-title").dblclick();
  await win.locator(".rename-session input").fill("回归测试会话");
  await win.locator(".rename-session button[type=submit]").click();
  await win.waitForTimeout(500);
  return (await win.locator(".chat-title").textContent())?.trim();
});
await check("session_pin", async () => {
  await win.locator(".conversation-menu-wrap .btn").click();
  await win.waitForTimeout(300);
  await win.locator(".conversation-menu button", { hasText: "固定对话" }).click();
  await win.waitForTimeout(400);
  return await win.evaluate(() => [...document.querySelectorAll(".side-session")].some((el) => el.className.includes("pinned")));
});
await check("session_delete_undo", async () => {
  const before = await win.locator(".side-session").count();
  await win.locator(".side-session").first().hover();
  await win.locator(".side-session .session-delete, .side-session .row-action").first().click().catch(() => undefined);
  const menuShown = await win.locator(".conversation-menu").count();
  if (!menuShown) return "NO_MENU";
  await win.locator(".conversation-menu button", { hasText: "删除对话" }).click();
  await win.waitForTimeout(500);
  const afterDelete = await win.locator(".side-session").count();
  await win.locator(".toast button").click();
  await win.waitForTimeout(500);
  return { before, afterDelete, afterUndo: await win.locator(".side-session").count() };
});

// language switch
await check("language_en", async () => {
  await win.evaluate(() => window.__hymnixDev.setLanguage("en"));
  await win.waitForTimeout(800);
  const nav = await win.evaluate(() => [...document.querySelectorAll(".nav-item, .side-nav button")].map((el) => el.textContent?.trim()).slice(0, 6));
  await win.evaluate(() => window.__hymnixDev.setLanguage("zh"));
  await win.waitForTimeout(600);
  return nav;
});

// model unload dialog
await check("model_unload_dialog", async () => {
  await win.evaluate(() => window.__hymnixDev.navigate("Models"));
  await win.waitForTimeout(700);
  const unload = win.locator(".model-table-card button", { hasText: /卸载|Unload/ }).first();
  if (!(await unload.count())) return "NO_UNLOAD_BUTTON";
  await unload.click();
  await win.waitForTimeout(500);
  const dialog = await win.locator(".confirm-dialog, [role=dialog]").count();
  return { dialog };
});

// changelog + plugins + monitor render
await check("changelog_rendered", async () => {
  await win.evaluate(() => window.__hymnixDev.navigate("Changelog"));
  await win.waitForTimeout(900);
  return await win.evaluate(() => (document.querySelector(".view-page")?.innerText || "").length > 200);
});
await check("plugins_rendered", async () => {
  await win.evaluate(() => window.__hymnixDev.navigate("Plugins"));
  await win.waitForTimeout(900);
  return await win.evaluate(() => ({
    cards: document.querySelectorAll(".plugin-card").length,
    hasInstall: [...document.querySelectorAll("button")].some((el) => (el.textContent || "").includes("安装本地插件")),
  }));
});
await check("monitor_rendered", async () => {
  await win.evaluate(() => window.__hymnixDev.navigate("Monitor"));
  await win.waitForTimeout(900);
  return await win.evaluate(() => ({
    cards: [...document.querySelectorAll(".card-title")].map((el) => el.textContent?.trim()),
    clients: document.querySelectorAll(".client-row").length,
  }));
});

// message actions after one reply
await check("message_actions", async () => {
  await win.evaluate(() => window.__hymnixDev.navigate("Chat"));
  await win.waitForTimeout(500);
  await win.locator(".composer textarea").fill("say hi");
  await win.keyboard.press("Enter");
  for (let i = 0; i < 40; i += 1) { await win.waitForTimeout(1000); if ((await win.locator(".bubble.assistant .bubble-actions").count()) > 0) break; }
  const actions = await win.evaluate(() => [...document.querySelectorAll(".bubble.assistant .bubble-actions button")].map((el) => el.getAttribute("aria-label") || el.textContent?.trim()));
  return { actions };
});

out.errors = errors.slice(0, 5);
console.log("ACTIONS " + JSON.stringify(out).slice(0, 2500));
fs.writeFileSync(resolve(cwd, "../docs/audit-1.4.0/actions.json"), JSON.stringify(out, null, 2), "utf8");
await app.close();
