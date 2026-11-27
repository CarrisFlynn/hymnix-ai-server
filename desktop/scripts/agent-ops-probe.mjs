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

// ---- 1. what the model is actually offered ------------------------------
const names = await win.evaluate(() => window.__hymnixDev.toolNames());
const wanted = ["job.list", "job.output", "job.kill", "schedule.list", "schedule.create", "schedule.update", "schedule.remove"];
const missing = wanted.filter((name) => !names.includes(name));
console.log("TOOL_COUNT " + names.length);
console.log("TOOL_NAMES " + names.join(","));
console.log("TOOL_NEW_PRESENT " + (missing.length === 0));
console.log("TOOL_MISSING " + (missing.join(",") || "-"));

// ---- 2. job.* against a real background command --------------------------
const started = await win.evaluate(() => window.hymnix.jobs.start({ command: 'node -e "console.log(\'job-marker-output\')"' }));
const jobId = started.job?.id || "";
console.log("JOB_STARTED " + Boolean(jobId));

let read = null;
for (let i = 0; i < 40; i += 1) {
  read = await win.evaluate((id) => window.hymnix.jobs.read(id), jobId);
  if (read.job && read.job.status !== "running") break;
  await win.waitForTimeout(250);
}
console.log("JOB_STATUS " + (read?.job?.status || "none"));
console.log("JOB_EXIT " + String(read?.job?.exitCode));
console.log("JOB_OUTPUT_HAS_MARKER " + String((read?.job?.output || "").includes("job-marker-output")));

const listed = await win.evaluate(() => window.hymnix.jobs.list());
const row = (listed.jobs || []).find((item) => item.id === jobId);
console.log("JOB_IN_LIST " + Boolean(row) + " / rows " + (listed.jobs || []).length);

const prefixRead = await win.evaluate((id) => window.hymnix.jobs.read(id.slice(0, 1)), jobId);
console.log("JOB_UNKNOWN_ID_REFUSED " + String(!prefixRead.job));

// ---- 3. a long job, then kill it (job.kill path) -------------------------
const long = await win.evaluate(() => window.hymnix.jobs.start({ command: 'node -e "setTimeout(()=>{},60000)"' }));
const longId = long.job?.id || "";
await win.waitForTimeout(600);
const runningRow = (await win.evaluate(() => window.hymnix.jobs.list())).jobs.find((item) => item.id === longId);
console.log("JOB_RUNNING " + (runningRow?.status || "none"));
const killed = await win.evaluate((id) => window.hymnix.jobs.stop(id), longId);
console.log("JOB_KILL_OK " + String(killed.ok));
await win.waitForTimeout(400);
const killedRow = (await win.evaluate(() => window.hymnix.jobs.list())).jobs.find((item) => item.id === longId);
console.log("JOB_AFTER_KILL " + (killedRow?.status || "gone"));

// ---- 4. schedule.* against the real store -------------------------------
const created = await win.evaluate(() => window.hymnix.automation.create({ title: "probe-task", prompt: "probe prompt", rule: { kind: "every", seconds: 600 } }));
const taskId = created.task?.id || "";
console.log("SCHEDULE_CREATED " + Boolean(taskId) + " nextAt=" + String(created.task?.nextAt));

const tasks = await win.evaluate(() => window.hymnix.automation.list());
console.log("SCHEDULE_LISTED " + String((tasks.tasks || []).some((item) => item.id === taskId)));

const paused = await win.evaluate((id) => window.hymnix.automation.update(id, { enabled: false }), taskId);
console.log("SCHEDULE_PAUSED " + String(paused.ok && paused.task?.enabled === false && paused.task?.nextAt === null));

const resumed = await win.evaluate((id) => window.hymnix.automation.update(id, { enabled: true, title: "probe-renamed" }), taskId);
console.log("SCHEDULE_RESUMED " + String(resumed.ok && resumed.task?.enabled === true && resumed.task?.title === "probe-renamed"));

const bad = await win.evaluate((id) => window.hymnix.automation.update(id, { rule: { kind: "every", seconds: 5 } }), taskId);
console.log("SCHEDULE_BAD_RULE_REFUSED " + String(bad.ok === false && bad.error === "frequency_too_high"));

const removed = await win.evaluate((id) => window.hymnix.automation.remove(id), taskId);
const after = await win.evaluate(() => window.hymnix.automation.list());
console.log("SCHEDULE_REMOVED " + String(removed.ok && !(after.tasks || []).some((item) => item.id === taskId)));

await win.screenshot({ path: resolve(cwd, "../docs/audit-1.4.0/agent-ops-probe.png") });
await app.close();
