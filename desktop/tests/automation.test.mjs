import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutomationCenter } from "../src/main/automation.ts";

function center() {
  const dir = mkdtempSync(join(tmpdir(), "hx-auto-"));
  return new AutomationCenter(join(dir, "automation.json"), () => true, () => {}, () => Date.now());
}

test("a rejected patch leaves the task untouched", () => {
  const hub = center();
  const created = hub.create({ title: "nightly", prompt: "run", rule: { kind: "daily", time: "09:00" } });
  assert.equal(created.ok, true);
  const before = hub.list()[0];
  const rejected = hub.update(before.id, { rule: { kind: "every", seconds: 5 } });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, "frequency_too_high");
  const after = hub.list()[0];
  assert.deepEqual(after.rule, before.rule);
  assert.equal(after.nextAt, before.nextAt);
});

test("a one-off far in the future is refused without changing the task", () => {
  const hub = center();
  const created = hub.create({ title: "later", prompt: "run", rule: { kind: "daily", time: "09:00" } });
  const before = hub.list()[0];
  const rejected = hub.update(before.id, { rule: { kind: "at", at: Date.now() + 10 * 365 * 24 * 3600 * 1000 } });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, "too_far");
  assert.deepEqual(hub.list()[0].rule, before.rule);
});
