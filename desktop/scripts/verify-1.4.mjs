import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";

const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const out = [];
const say = (...parts) => { const line = parts.join(" "); out.push(line); console.log(line); };

// Isolated profile: a user-launched installed copy holds the single-instance
// lock, and verification must never steal their window.
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-verify-profile", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => {
  localStorage.setItem("hymnix.welcome", "1");
  localStorage.setItem("hymnix.whatsNew", "1.3.3");
  localStorage.setItem("hymnix.lang", "zh");
  // Deterministic seed: the app profile survives between runs.
  localStorage.removeItem("hymnix.approvals.always.v1");
  localStorage.removeItem("hymnix.approvals.archive.v1");
  localStorage.removeItem("hymnix.shortcuts.v1");
});
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
await win.waitForTimeout(1200);

// ---------- 1. plan view ----------
await win.evaluate(() => {
  window.__hymnixDev.seedPlan({ todos: [
    { content: "Read the failing test and the code it covers", status: "completed" },
    { content: "Fix the assertion in components.test.mjs", status: "in_progress" },
    { content: "Run the full check gate", status: "pending" },
    { content: "Update CHANGELOG for 1.4.0", status: "pending" },
  ] });
  window.__hymnixDev.setChatTab("plan");
});
await win.waitForTimeout(1600);
await win.evaluate(() => {
  window.__hymnixDev.seedPlan({ todos: [
    { content: "Read the failing test and the code it covers", status: "completed" },
    { content: "Fix the assertion in components.test.mjs", status: "completed" },
    { content: "Run the full check gate", status: "in_progress" },
    { content: "Update CHANGELOG for 1.4.0", status: "pending" },
  ] });
});
await win.waitForTimeout(900);
const planState = await win.evaluate(() => ({
  steps: [...document.querySelectorAll(".plan-step")].map((el) => ({
    text: el.querySelector(".plan-text")?.textContent?.trim(),
    status: el.getAttribute("data-status"),
  })),
  progress: document.querySelector(".plan-progress i")?.getAttribute("style"),
  badge: document.querySelector(".chat-tabs .tab-badge")?.textContent,
  empty: Boolean(document.querySelector(".plan-empty")),
}));
say("PLAN", JSON.stringify(planState));
await win.screenshot({ path: resolve(cwd, "../.verify-plan.png") });
await win.locator(".plan-card").screenshot({ path: resolve(cwd, "../.verify-plan-zoom.png") });

// manual close of a running step
await win.locator(".plan-step").nth(2).hover();
await win.locator(".plan-step").nth(2).locator("button", { hasText: "完成" }).first().click();
await win.waitForTimeout(300);
const afterDone = await win.evaluate(() => ({
  status: document.querySelectorAll(".plan-step")[2]?.getAttribute("data-status"),
  duration: document.querySelectorAll(".plan-step")[2]?.querySelector(".plan-meta .mono")?.textContent,
  badge: document.querySelector(".chat-tabs .tab-badge")?.textContent,
}));
say("PLAN_AFTER_DONE", JSON.stringify(afterDone));

// ---------- 2. approvals drawer ----------
await win.evaluate(() => {
  window.__hymnixDev.seedApprovals([
    { id: "a".repeat(32), requestId: "r1", tool: "web.fetch", argsRedacted: { url: "https://example.com" }, risk: "moderate", reasons: ["tool requires approval"], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() },
    { id: "b".repeat(32), requestId: "r2", tool: "repo.search", argsRedacted: { query: "rm -rf", path: "." }, risk: "danger", reasons: ["recursive delete"], createdAt: new Date(Date.now() - 4000).toISOString(), expiresAt: new Date(Date.now() + 55000).toISOString() },
  ]);
  window.__hymnixDev.openApprovals();
});
await win.waitForTimeout(600);
const drawer = await win.evaluate(() => ({
  open: Boolean(document.querySelector(".approvals-drawer")),
  rows: [...document.querySelectorAll(".approval-row")].map((row) => ({ tool: row.querySelector("strong")?.textContent, risk: row.getAttribute("data-risk") })),
  badge: document.querySelector(".head-badge")?.textContent?.trim(),
  batchButtons: [...document.querySelectorAll(".drawer-toolbar .btn")].map((b) => b.textContent?.trim()),
}));
say("APPROVALS", JSON.stringify(drawer));
await win.locator(".approval-row").first().locator(".link-button").click();
await win.waitForTimeout(300);
say("APPROVAL_ARGS_VISIBLE", String(await win.locator(".approval-args").count()));
await win.screenshot({ path: resolve(cwd, "../.verify-approvals.png") });
const alwaysButton = () => win.locator(".approval-row").first().locator(".approval-row-actions button").nth(2);
say("ALWAYS_ALLOW_INITIAL", await alwaysButton().textContent());
await alwaysButton().click();
await win.waitForTimeout(500);
say("ALWAYS_ALLOW_ON", await alwaysButton().textContent(), await win.evaluate(() => localStorage.getItem("hymnix.approvals.always.v1")));
await alwaysButton().click();
await win.waitForTimeout(500);
say("ALWAYS_ALLOW_OFF", await alwaysButton().textContent(), await win.evaluate(() => localStorage.getItem("hymnix.approvals.always.v1")));
await win.keyboard.press("Escape");
await win.waitForTimeout(300);
say("DRAWER_CLOSED_BY_ESC", String(!(await win.locator(".approvals-drawer").count())));

// ---------- 3. jobs ----------
await win.evaluate(() => window.__hymnixDev.navigate("Jobs"));
await win.waitForTimeout(600);
say("JOBS_EMPTY_COPY", (await win.locator(".job-list .panel-note").first().textContent())?.slice(0, 40));
const command = "powershell -NoProfile -Command \"1..30 | ForEach-Object { Write-Output ('tick ' + $_); Start-Sleep -Seconds 1 }\"";
await win.locator(".job-launcher input").fill(command);
await win.locator(".job-launcher button[type=submit]").click();
await win.waitForTimeout(3200);
const liveJob = await win.evaluate(() => ({
  rows: document.querySelectorAll(".job-row").length,
  output: document.querySelector(".job-output")?.textContent?.slice(0, 120),
  status: document.querySelector(".job-row")?.getAttribute("data-status"),
  elapsed: document.querySelector(".job-time")?.textContent,
}));
say("JOB_RUNNING", JSON.stringify(liveJob));
await win.screenshot({ path: resolve(cwd, "../.verify-jobs.png") });
await win.locator(".job-detail .btn.danger").click();
await win.waitForTimeout(900);
const stopped = await win.evaluate(() => ({
  status: document.querySelector(".job-row")?.getAttribute("data-status"),
  outputLength: document.querySelector(".job-output")?.textContent?.length,
  pill: document.querySelector(".job-detail .status-pill")?.textContent,
}));
say("JOB_STOPPED", JSON.stringify(stopped));
await win.waitForTimeout(1600);
const frozen = await win.evaluate(() => document.querySelector(".job-output")?.textContent?.length);
say("JOB_OUTPUT_FROZEN", String(frozen === stopped.outputLength));

// ---------- 4. shortcuts ----------
await win.evaluate(() => window.__hymnixDev.navigate("Chat"));
await win.waitForTimeout(400);
await win.keyboard.press("Control+/");
await win.waitForTimeout(500);
const sheet = await win.evaluate(() => ({
  open: Boolean(document.querySelector(".shortcuts-sheet")),
  groups: [...document.querySelectorAll(".shortcut-group h3")].map((h) => h.textContent),
  rows: document.querySelectorAll(".shortcut-row").length,
  firstKeys: [...document.querySelectorAll(".shortcut-row .shortcut-keys")].slice(0, 3).map((el) => el.textContent),
}));
say("SHORTCUTS_SHEET", JSON.stringify(sheet));
await win.screenshot({ path: resolve(cwd, "../.verify-shortcuts.png") });
await win.keyboard.press("Escape");
await win.waitForTimeout(300);

await win.evaluate(() => window.__hymnixDev.setSettingsSection("Shortcuts"));
await win.waitForTimeout(600);
const editor = await win.evaluate(() => ({
  rows: document.querySelectorAll(".shortcut-edit-row").length,
  headings: [...document.querySelectorAll(".shortcut-edit-heading")].map((h) => h.textContent),
  locked: document.querySelectorAll(".shortcut-edit-row .chip").length,
}));
say("SHORTCUT_EDITOR", JSON.stringify(editor));
// conflict: move "new chat" onto Ctrl+K, which the palette owns
// Navigation group order follows the shipped table: palette, new chat, ...
const newChatRow = win.locator(".shortcut-edit-row").nth(1);
say("NEW_CHAT_ROW_LABEL", await newChatRow.locator(".shortcut-edit-label").textContent());
await newChatRow.locator("button", { hasText: "改键" }).click();
await win.keyboard.press("Control+k");
await win.waitForTimeout(400);
say("CONFLICT_MESSAGE", (await win.locator(".shortcut-edit-group ~ .error, .card .error").first().textContent().catch(() => ""))?.slice(0, 60));
say("BINDING_UNCHANGED", await win.locator(".shortcut-edit-row").nth(1).locator(".shortcut-keys").textContent());
say("RECORDER_STILL_ARMED", await win.locator(".shortcut-edit-row").nth(1).locator("button").first().textContent());
// still recording: a free combination now sticks without another click
await win.keyboard.press("Control+Shift+n");
await win.waitForTimeout(500);
say("BINDING_AFTER_REBIND", await win.locator(".shortcut-edit-row").nth(1).locator(".shortcut-keys").textContent());
const stored = await win.evaluate(() => localStorage.getItem("hymnix.shortcuts.v1"));
say("SHORTCUT_PERSISTED", String(stored));
await win.screenshot({ path: resolve(cwd, "../.verify-shortcut-editor.png") });
// reset all
await win.locator("button", { hasText: "重置全部快捷键" }).click();
await win.waitForTimeout(300);
say("BINDING_AFTER_RESET", await win.locator(".shortcut-edit-row").nth(1).locator(".shortcut-keys").textContent());
say("SHORTCUTS_CLEARED", String(await win.evaluate(() => localStorage.getItem("hymnix.shortcuts.v1"))));

say("CONSOLE_ERRORS", JSON.stringify(await win.evaluate(() => (window.__hymnixConsoleErrors || []).slice(0, 5))));
await app.close();
