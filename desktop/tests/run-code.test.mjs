import { test } from "node:test";
import assert from "node:assert/strict";
import { runProgram } from "../src/main/run-code.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cwd = mkdtempSync(join(tmpdir(), "hx-runcode-"));
const noCall = async () => { throw new Error("should not call a tool"); };

test("runProgram returns the exported value", async () => {
  const result = await runProgram({ code: "export default { answer: 42 };", cwd, onCall: noCall });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { answer: 42 });
  assert.ok(result.durationMs >= 0);
});

test("runProgram bridges tools.call to onCall and records the names", async () => {
  const seen = [];
  const result = await runProgram({
    code: "const a = await tools.call(\"time.now\", {}); const b = await tools.call(\"calc\", { expression: \"1+1\" }); export default { a, b };",
    cwd,
    onCall: async (call) => { seen.push(call.name); return call.name === "time.now" ? "T" : 2; },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(seen, ["time.now", "calc"]);
  assert.deepEqual(result.calls, ["time.now", "calc"]);
  assert.deepEqual(result.value, { a: "T", b: 2 });
});

test("a rejected tool call surfaces to the program", async () => {
  const result = await runProgram({
    code: "let out; try { await tools.call(\"fs.write\", {}); out = \"no\"; } catch (error) { out = \"caught:\" + error.message; } export default out;",
    cwd,
    onCall: async () => { throw new Error("denied_by_user"); },
  });
  assert.equal(result.ok, true);
  assert.equal(result.value, "caught:denied_by_user");
});

test("a syntax error is reported, not swallowed", async () => {
  const result = await runProgram({ code: "export default (((;", cwd, onCall: noCall });
  assert.equal(result.ok, false);
  assert.ok(String(result.error).length > 0);
});

test("console output is captured without running twice", async () => {
  const result = await runProgram({ code: "console.log(\"hello\", 1); export default null;", cwd, onCall: noCall });
  assert.equal(result.ok, true);
  assert.deepEqual(result.logs, ["hello 1"]);
});

test("an empty or oversized program is refused before spawning", async () => {
  assert.equal((await runProgram({ code: "   ", cwd, onCall: noCall })).error, "code_required");
  assert.equal((await runProgram({ code: "x".repeat(20_001), cwd, onCall: noCall })).error, "code_too_large");
});

test("a program that never finishes is stopped by the timeout", async () => {
  const result = await runProgram({ code: "await new Promise(() => {}); export default 1;", cwd, timeoutMs: 1000, onCall: noCall });
  assert.equal(result.ok, false);
  assert.equal(result.error, "run_timeout");
});
