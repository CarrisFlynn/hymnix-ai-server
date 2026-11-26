import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceOccurrence, nextOccurrence, normalizeRule, describeRule, isValidRule, msUntilNext } from "../src/shared/schedule.ts";

const local = (y, m, d, hh, mm) => new Date(y, m - 1, d, hh, mm, 0, 0).getTime();

test("daily fires at the next wall-clock time, never twice in the same minute", () => {
  const base = local(2026, 11, 26, 9, 0);
  assert.equal(nextOccurrence({ kind: "daily", time: "09:00" }, base), local(2026, 11, 27, 9, 0));
  assert.equal(nextOccurrence({ kind: "daily", time: "10:30" }, base), local(2026, 11, 26, 10, 30));
});

test("weekly walks to the next listed weekday", () => {
  const base = local(2026, 11, 26, 9, 0); // Thursday
  assert.equal(nextOccurrence({ kind: "weekly", time: "08:00", weekdays: [4] }, base), local(2026, 12, 3, 8, 0));
  assert.equal(nextOccurrence({ kind: "weekly", time: "10:00", weekdays: [4] }, base), local(2026, 11, 26, 10, 0));
});

test("interval and one-off rules", () => {
  assert.equal(nextOccurrence({ kind: "every", seconds: 90 }, 1000), 1000 + 90000);
  assert.equal(nextOccurrence({ kind: "at", at: 5000 }, 1000), 5000);
  assert.equal(nextOccurrence({ kind: "at", at: 5000 }, 6000), null);
});

test("validation matches the UI contract", () => {
  assert.deepEqual(normalizeRule({ kind: "every", seconds: 10 }), { error: "frequency_too_high" });
  assert.deepEqual(normalizeRule({ kind: "daily", time: "25:00" }), { error: "invalid_rule" });
  assert.deepEqual(normalizeRule({ kind: "weekly", time: "08:00", weekdays: [] }), { error: "invalid_rule" });
  assert.equal(isValidRule({ kind: "daily", time: "07:05" }), true);
  assert.equal(normalizeRule({ kind: "weekly", time: "8:05", weekdays: [1, 1, 3] }).rule.weekdays.join(","), "1,3");
});

test("describeRule and countdowns agree with the schedule", () => {
  assert.deepEqual(describeRule({ kind: "daily", time: "09:00" }), { kind: "daily", parts: ["09:00"] });
  const base = local(2026, 11, 26, 9, 0);
  assert.equal(msUntilNext({ kind: "daily", time: "10:00" }, base), 3600000);
});

test("advance keeps the cadence instead of drifting with the tick", () => {
  // A 60 s task scheduled at 0 fires 20 s late; the next slot stays on the grid.
  assert.equal(advanceOccurrence({ kind: "every", seconds: 60 }, 0, 20000), 60000);
  // Daily at 09:00 that fired at 09:00:20 must still be tomorrow at 09:00, not a day later.
  const fired = local(2026, 11, 26, 9, 0, 20);
  const next = advanceOccurrence({ kind: "daily", time: "09:00" }, local(2026, 11, 26, 9, 0), fired);
  assert.equal(new Date(next).toDateString(), new Date(local(2026, 11, 27, 9, 0)).toDateString());
  assert.equal(new Date(next).getHours(), 9);
});

test("advance skips a long outage to the next slot after now", () => {
  const now = local(2026, 11, 26, 12, 0);
  const next = advanceOccurrence({ kind: "daily", time: "09:00" }, local(2026, 11, 10, 9, 0), now);
  assert.equal(new Date(next).toDateString(), new Date(local(2026, 11, 27, 9, 0)).toDateString());
});
