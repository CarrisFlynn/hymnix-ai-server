import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobCenter } from "../src/main/job-center.ts";
import { AutomationCenter } from "../src/main/automation.ts";
import { findJob, jobForModel, summarizeJob, tailOutput } from "../src/renderer/lib/jobs.js";
import { buildSchedulePatch, isEmptyPatch, scheduleForModel, summarizeTask } from "../src/renderer/lib/schedule-view.js";

/** A real job center: the tools talk to this, not to a mock. */
function jobs() {
  return new JobCenter(() => {});
}

/** A real automation store on a throwaway file, with a frozen clock. */
function schedules(now = 1_700_000_000_000) {
  const dir = mkdtempSync(join(tmpdir(), "hx-ops-"));
  return new AutomationCenter(join(dir, "automation.json"), () => true, () => {}, () => now);
}

test("job.list never ships raw output and caps the rows", () => {
  const hub = jobs();
  const first = hub.create({ kind: "shell", title: "build", command: "npm run build" });
  hub.append(first.id, "stdout", "x".repeat(50_000));
  hub.finish(first.id, "done", 0);
  for (let index = 0; index < 25; index += 1) hub.create({ kind: "model", title: "pull " + index });

  const page = jobForModel(hub.list(), { limit: 10 });
  assert.equal(page.jobs.length, 10);
  assert.equal(page.total, 26);
  for (const row of page.jobs) {
    assert.equal("output" in row, false, "a row must not carry output");
    assert.ok(row.id && row.status);
  }
  // The finished build row keeps its exit code; running rows have no exit yet.
  const build = jobForModel(hub.list(), { status: "finished" }).jobs.find((row) => row.id === first.id);
  assert.equal(build.exitCode, 0);
  assert.equal(build.error, "");
  assert.equal("exitCode" in jobForModel(hub.list(), { status: "running" }).jobs[0], false);
});

test("job.output returns the tail of what the process printed", () => {
  const hub = jobs();
  const job = hub.create({ kind: "shell", title: "chatty", command: "seq 1 100000" });
  hub.append(job.id, "stdout", "head\n" + "middle\n".repeat(2000) + "tail-line\n");

  const read = hub.get(job.id);
  assert.ok(read, "get returns the job");
  const tail = tailOutput(read.output, 400);
  assert.equal(tail.truncated, true);
  assert.ok(tail.text.length <= 400);
  assert.ok(tail.text.trimEnd().endsWith("tail-line"), "the end of the log survives");
  assert.equal(tailOutput("short", 400).truncated, false);
});

test("findJob accepts an exact id or one unique prefix, and refuses the rest", () => {
  const only = jobs();
  const single = only.create({ kind: "shell", title: "only" });
  assert.equal(findJob(only.list(), single.id).job.id, single.id);
  // With a single job any prefix of its id is unique, so the short form works.
  assert.equal(findJob(only.list(), single.id.slice(0, 8)).job.id, single.id);
  assert.equal(findJob(only.list(), "").error, "id_required");
  assert.equal(findJob(only.list(), "job-does-not-exist").error, "not_found");

  // Two ids created in the same millisecond share everything up to the counter,
  // so a short prefix must be refused rather than guessed at.
  const two = jobs();
  const a = two.create({ kind: "shell", title: "a" });
  const b = two.create({ kind: "shell", title: "b" });
  assert.notEqual(a.id, b.id);
  assert.equal(findJob(two.list(), "job-").error, "ambiguous_id");
  assert.equal(findJob(two.list(), a.id).job.id, a.id);
});

test("job.kill only lands on a running job, and the list shows it cancelled", () => {
  const hub = jobs();
  const running = hub.create({ kind: "shell", title: "long" });
  const finished = hub.create({ kind: "shell", title: "quick" });
  hub.finish(finished.id, "done", 0);

  assert.equal(hub.stop(finished.id), false, "a finished job is not stoppable");
  assert.equal(hub.stop(running.id), true);
  const after = jobForModel(hub.list(), {}).jobs.find((row) => row.id === running.id);
  assert.equal(after.status, "cancelled");
  assert.equal(hub.stop(running.id), false, "stopping twice is refused");
});

test("schedule.list exposes the next run but not the whole prompt", () => {
  const now = 1_700_000_000_000;
  const hub = schedules(now);
  const created = hub.create({ title: "nightly", prompt: "y".repeat(500), rule: { kind: "daily", time: "09:00" } });
  assert.equal(created.ok, true);
  hub.create({ title: "paused-source", prompt: "p", rule: { kind: "every", seconds: 600 } });

  const page = scheduleForModel(hub.list(), {}, now);
  assert.equal(page.total, 2);
  const row = page.tasks.find((item) => item.id === created.task.id);
  assert.equal(row.title, "nightly");
  assert.equal(row.enabled, true);
  assert.equal(row.promptChars, 500);
  assert.ok(row.promptPreview.length <= 120, "the prompt is a preview, not the payload");
  assert.equal("prompt" in row, false);
  assert.ok(row.inMs > 0, "a live task reports time to the next run");
  // The tool reaches the store through create/update, so the count is real.
  assert.equal(hub.list().length, 2);
});

test("schedule.update pauses and resumes through the same store", () => {
  const now = 1_700_000_000_000;
  const hub = schedules(now);
  const created = hub.create({ title: "worker", prompt: "go", rule: { kind: "every", seconds: 300 } });
  const id = created.task.id;

  const paused = hub.update(id, buildSchedulePatch({ id, enabled: false }));
  assert.equal(paused.ok, true);
  assert.equal(paused.task.enabled, false);
  assert.equal(paused.task.nextAt, null);
  assert.equal(summarizeTask(paused.task, now).inMs, null);

  const resumed = hub.update(id, buildSchedulePatch({ id, enabled: true }));
  assert.equal(resumed.ok, true);
  assert.equal(resumed.task.enabled, true);
  assert.ok(resumed.task.nextAt > now);

  const edited = hub.update(id, buildSchedulePatch({ id, title: "renamed" }));
  assert.equal(edited.task.title, "renamed");
  assert.equal(edited.task.enabled, true, "an unrelated patch keeps the task enabled");
});

test("schedule.update drops keys the store does not own", () => {
  assert.deepEqual(buildSchedulePatch({ id: "abc", nextAt: 1, createdAt: 2, rule: { kind: "daily", time: "09:00" } }), { rule: { kind: "daily", time: "09:00" } });
  assert.deepEqual(buildSchedulePatch({ enabled: "yes" }), { enabled: true });
  assert.equal(isEmptyPatch(buildSchedulePatch({})), true);
  assert.equal(isEmptyPatch(buildSchedulePatch({ id: "abc" })), true, "an id alone changes nothing");
  assert.equal(isEmptyPatch(buildSchedulePatch({ title: "x" })), false);
});

test("schedule.remove deletes, and the list agrees", () => {
  const now = 1_700_000_000_000;
  const hub = schedules(now);
  const created = hub.create({ title: "temp", prompt: "p", rule: { kind: "every", seconds: 300 } });
  assert.equal(hub.list().length, 1);
  assert.deepEqual(hub.remove(created.task.id), { ok: true });
  assert.equal(scheduleForModel(hub.list(), {}, now).total, 0);
  assert.deepEqual(hub.remove("nope"), { ok: false });
});
