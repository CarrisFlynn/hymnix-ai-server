import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outlineFile, findDefinition, findReferences } from "../src/main/code-nav.ts";

function tree() {
  const dir = mkdtempSync(join(tmpdir(), "hx-nav-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "a.py"), "class Alpha:\n    pass\n\ndef helper(x):\n    return x\n", "utf8");
  writeFileSync(join(dir, "src", "b.ts"), "export function buildThing(input: string) {\n  return helper(1);\n}\n", "utf8");
  return dir;
}

test("outline lists declarations with line numbers", () => {
  const dir = tree();
  const result = outlineFile(dir, "src/a.py");
  assert.equal(result.ok, true);
  assert.deepEqual(result.symbols.map((s) => s.name), ["Alpha", "helper"]);
  assert.equal(result.symbols[1].line, 4);
});

test("definition finds the declaring file", () => {
  const dir = tree();
  const result = findDefinition(dir, "buildThing");
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].file, join("src", "b.ts"));
});

test("references span files, and bad input is refused", () => {
  const dir = tree();
  const result = findReferences(dir, "helper");
  assert.ok(result.hits.length >= 2);
  assert.equal(outlineFile(dir, "../outside.py").error, "out_of_scope");
  assert.equal(findDefinition(dir, "not a symbol").error, "invalid_symbol");
});
