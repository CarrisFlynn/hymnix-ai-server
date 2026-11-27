import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";

const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-agentops", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => {
  localStorage.setItem("hymnix.welcome", "1");
  localStorage.setItem("hymnix.whatsNew", "1.4.2");
  localStorage.setItem("hymnix.lang", "zh");
});
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 60; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }

// ---- 1. the exact tool list the model is offered -------------------------
const named = await win.evaluate(() => window.__hymnixDev.toolNames());
const wanted = ["job.start", "job.list", "job.output", "job.kill", "schedule.list", "schedule.create", "schedule.update", "schedule.remove", "web.search", "ask_user_question", "present"];
console.log("TOOL_COUNT " + named.length);
console.log("TOOL_NEW_PRESENT " + String(wanted.every((name) => named.includes(name))));

// ---- 2. live web.search through the real IPC ------------------------------
const search = await win.evaluate(() => window.hymnix.web.search({ query: "python asyncio", count: 3 }));
console.log("SEARCH_OK " + String(search.ok) + " provider=" + (search.provider || "-") + " hits=" + (search.hits || []).length);
const empty = await win.evaluate(() => window.hymnix.web.search({ query: "   " }));
console.log("SEARCH_EMPTY_REFUSED " + String(empty.ok === false && empty.error === "query_required"));

// ---- 3. ask_user_question: dialog renders, answers come back --------------
const askPromise = win.evaluate(() => window.__hymnixDev.runTool("ask_user_question", {
  questions: [
    { id: "target", header: "目标文件", question: "要改哪一个渲染入口？", options: [{ label: "main.tsx", description: "应用外壳与所有页面" }, { label: "chat.tsx" }] },
    { id: "how", question: "改完要我做哪些验证？", multi_select: true, options: [{ label: "跑 pnpm check" }, { label: "截图自查" }] },
  ],
}));
await win.waitForTimeout(600);
const dialog = await win.evaluate(() => ({
  open: Boolean(document.querySelector(".ask-dialog")),
  title: document.querySelector("#ask-title")?.textContent?.trim(),
  questions: [...document.querySelectorAll(".ask-prompt p")].map((el) => el.textContent?.trim()),
  options: [...document.querySelectorAll(".ask-option strong")].map((el) => el.textContent?.trim()),
  submitDisabled: Boolean(document.querySelector(".ask-dialog .btn.primary")?.disabled),
}));
console.log("ASK_OPEN " + dialog.open + " title=" + dialog.title);
console.log("ASK_QUESTIONS " + JSON.stringify(dialog.questions));
console.log("ASK_SUBMIT_DISABLED_WHEN_EMPTY " + dialog.submitDisabled);
await win.evaluate(() => { const all = document.querySelectorAll(".ask-option"); all[0]?.click(); all[2]?.click(); all[3]?.click(); });
await win.waitForTimeout(200);
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/ask-dialog.png") });
await win.evaluate(() => document.querySelector(".ask-dialog .btn.primary")?.click());
const askResult = await askPromise;
console.log("ASK_RESULT " + askResult);

// ---- 4. present: real file validation, real chips -------------------------
const presentOk = await win.evaluate(([main, handoff]) => window.__hymnixDev.runTool("present", { files: [{ path: main, description: "tools" }, { path: handoff }] }), [resolve(cwd, "src/renderer/main.tsx"), resolve(cwd, "../HANDOFF.md")]);
console.log("PRESENT_OK " + presentOk);
const presentBad = await win.evaluate(([missing]) => window.__hymnixDev.runTool("present", { files: [{ path: missing }] }), [resolve(cwd, "does/not/exist.ts")]);
console.log("PRESENT_MISSING_REFUSED " + String(presentBad.includes("files_not_found")));
const strip = await win.evaluate(() => ({
  visible: Boolean(document.querySelector(".deliverable-strip")),
  label: document.querySelector(".deliverable-label")?.textContent?.trim(),
  chips: [...document.querySelectorAll(".deliverable-open span")].map((el) => el.textContent?.trim()),
}));
console.log("DELIVERABLES " + JSON.stringify(strip));
await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/deliverables-strip.png") });

// ---- 5. job.start really sits behind the approval drawer -----------------
const jobsBefore = (await win.evaluate(() => window.hymnix.jobs.list())).jobs.length;
const cmd = 'node -e "console.log(\'job-start-marker\')"';
const deniedPromise = win.evaluate((command) => window.__hymnixDev.runTool("job.start", { command, title: "denied probe" }), cmd);
await win.waitForTimeout(700);
const drawer = await win.evaluate(() => ({
  open: Boolean(document.querySelector(".approvals-drawer")),
  tools: [...document.querySelectorAll(".approval-row strong")].map((el) => el.textContent?.trim()),
  reasons: [...document.querySelectorAll(".approval-reasons")].map((el) => el.textContent?.trim()),
}));
console.log("JOBSTART_APPROVAL_OPEN " + drawer.open + " tools=" + JSON.stringify(drawer.tools));
console.log("JOBSTART_REASONS " + JSON.stringify(drawer.reasons));
await win.evaluate(() => document.querySelector(".approval-row-actions .btn.danger")?.click());
console.log("JOBSTART_DENIED " + (await deniedPromise));
console.log("JOBS_AFTER_DENY " + (await win.evaluate(() => window.hymnix.jobs.list())).jobs.length + " (was " + jobsBefore + ")");

const allowPromise = win.evaluate((command) => window.__hymnixDev.runTool("job.start", { command, title: "approved probe" }), cmd);
await win.waitForTimeout(700);
await win.evaluate(() => document.querySelector(".approval-row-actions .btn.primary")?.click());
console.log("JOBSTART_APPROVED " + (await allowPromise));
let found = null;
for (let i = 0; i < 40; i += 1) {
  const list = (await win.evaluate(() => window.hymnix.jobs.list())).jobs;
  found = list.find((job) => job.title === "approved probe");
  if (found && found.status !== "running") break;
  await win.waitForTimeout(250);
}
const read = found ? await win.evaluate((id) => window.hymnix.jobs.read(id), found.id) : null;
console.log("JOBSTART_JOB " + (found ? found.status + " exit=" + found.exitCode : "none"));
console.log("JOBSTART_OUTPUT " + String((read?.job?.output || "").includes("job-start-marker")));

await win.evaluate(() => document.querySelector(".approvals-drawer .btn.ghost")?.click());
await app.close();
