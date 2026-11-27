import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

/**
 * Gates for what the eighth audit found by calling the real path.
 *
 * Each one fails on the code as it was: a tool could be advertised and then
 * refused by the default policy, fs.edit could shrink a large file and rewrite
 * its line endings, and a registered plugin tool was invisible to the policy.
 */
const root = resolve(process.cwd(), "..");
const server = join(root, "server");
const renderer = readFileSync(join(process.cwd(), "src/renderer/main.tsx"), "utf8");
const gateway = readFileSync(join(server, "gateway_core.py"), "utf8");

function probe(name) {
  return execFileSync("python", [join(process.cwd(), "tests/probes", name)], { cwd: server, encoding: "utf8" });
}

/** The names inside one `_TOOL_* = { ... }` literal, without regex escaping games. */
function setMembers(source, name) {
  const start = source.indexOf(name + " = {");
  if (start < 0) return [];
  const body = source.slice(start, source.indexOf("}", start));
  return [...body.matchAll(/"([^"]+)"/g)].map((row) => row[1]);
}

test("every advertised tool is allowed by the default workspace policy", () => {
  const start = renderer.indexOf("ADVERTISED_TOOLS = new Set([");
  assert.ok(start > 0, "the advertised list must be findable");
  const body = renderer.slice(start, renderer.indexOf("])", start));
  const advertised = [...body.matchAll(/"([^"]+)"/g)].map((row) => row[1]);
  assert.ok(advertised.length >= 19, "expected the full advertised list, got " + advertised.length);
  const classified = new Set([...setMembers(gateway, "_TOOL_READ"), ...setMembers(gateway, "_TOOL_WRITE")]);
  const denied = advertised.filter((name) => !classified.has(name));
  assert.deepEqual(denied, [], "advertised but unclassified (=> exec => policy_denied): " + denied.join(", "));
});

test("the tools that used to be refused now pass the default policy", () => {
  const out = probe("policy.py");
  assert.ok(out.includes("patch.apply True"), out);
  assert.ok(out.includes("web.fetch True"), out);
  assert.ok(out.includes("plugin write True"), "a registered plugin tool is a write, not an unknown exec");
  assert.ok(out.includes("unknown exec False"), "an unregistered name is still refused");
});

test("fs.edit keeps a large file size and line endings", () => {
  const out = probe("edit.py");
  const size = out.match(/SIZE (\d+) (\d+)/);
  assert.ok(size, out);
  assert.equal(size[2], size[1], "the file must not shrink: " + out);
  assert.ok(out.includes("CRLF False"), "line endings must not be rewritten");
  assert.ok(out.includes("TAIL True"), "the tail must survive");
});

test("fs.read marks a truncated body instead of trimming silently", () => {
  const out = probe("read.py");
  assert.ok(out.includes("READ True 300000"), out);
});
