import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanSkills, readSkill } from "../src/main/skills.ts";

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "hx-skills-"));
  mkdirSync(join(dir, "demo"), { recursive: true });
  writeFileSync(join(dir, "demo", "SKILL.md"), "# Demo Skill\ndescription: Does demo things\n\nBody text\n", "utf8");
  mkdirSync(join(dir, "empty"));
  return dir;
}

test("a skill folder is discovered with its heading and description", () => {
  const dir = workspace();
  const skills = scanSkills([dir]);
  assert.equal(skills.length, 1);
  assert.equal(skills[0].id, "demo");
  assert.equal(skills[0].name, "Demo Skill");
  assert.equal(skills[0].description, "Does demo things");
});

test("loading returns the document, traversal is refused", () => {
  const dir = workspace();
  assert.equal(readSkill([dir], "demo").content.includes("Body text"), true);
  assert.equal(readSkill([dir], "../demo").error, "invalid_id");
  assert.equal(readSkill([dir], "missing").error, "not_found");
});

test("an empty or missing directory is not an error", () => {
  assert.deepEqual(scanSkills(["/definitely/not/here"]), []);
});
