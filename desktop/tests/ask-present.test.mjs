import { test } from "node:test";
import assert from "node:assert/strict";
import { allSkipped, buildAnswers, normalizeQuestions } from "../src/renderer/lib/ask.js";
import { leafName, normalizeDeliverables } from "../src/renderer/lib/deliverables.js";

test("normalizeQuestions keeps what the dialog can render and drops the rest", () => {
  const questions = normalizeQuestions([
    { question: "Which file?", header: "Target", options: [{ label: "a.ts", description: "first" }, "b.ts"] },
    { question: "   " },
    { question: "How many?", multi_select: true, options: [] },
    null,
  ]);
  assert.equal(questions.length, 2, "an empty question and a null are dropped");
  assert.equal(questions[0].id, "q1");
  assert.deepEqual(questions[0].options, [{ label: "a.ts", description: "first" }, { label: "b.ts", description: "" }]);
  assert.equal(questions[1].multiSelect, true);
  assert.equal(questions[1].header, "");
});

test("normalizeQuestions caps the list and the option count", () => {
  const many = Array.from({ length: 9 }, (_, index) => ({ question: "q" + index }));
  assert.equal(normalizeQuestions(many).length, 4);
  const wide = normalizeQuestions([{ question: "pick", options: Array.from({ length: 20 }, (_, index) => "o" + index) }]);
  assert.equal(wide[0].options.length, 8);
  assert.deepEqual(normalizeQuestions("nope"), []);
});

test("buildAnswers keeps only offered options and carries typed text", () => {
  const questions = normalizeQuestions([
    { id: "q1", question: "pick", options: [{ label: "a" }, { label: "b" }] },
    { id: "q2", question: "why" },
  ]);
  const answers = buildAnswers(questions, { q1: ["a", "ghost"], q2: [] }, { q2: "  because  " });
  assert.equal(answers.length, 2);
  assert.deepEqual(answers[0].selected, ["a"], "a label that was never offered is dropped");
  assert.equal(answers[0].custom, undefined);
  assert.deepEqual(answers[1].selected, []);
  assert.equal(answers[1].custom, "because", "typed text is trimmed");
});

test("allSkipped is the dialog's disabled state, not a guess", () => {
  const questions = normalizeQuestions([{ id: "q1", question: "pick", options: [{ label: "a" }] }]);
  assert.equal(allSkipped(buildAnswers(questions, {}, {})), true);
  assert.equal(allSkipped(buildAnswers(questions, { q1: ["a"] }, {})), false);
  assert.equal(allSkipped(buildAnswers(questions, {}, { q1: "typed" })), false);
});

test("normalizeDeliverables de-duplicates, caps at four and keeps descriptions", () => {
  const rows = normalizeDeliverables([
    { path: "a.ts", description: "first" },
    { path: "A.TS" },
    "  b.ts  ",
    { path: "" },
    { path: "c.ts" },
    { path: "d.ts" },
    { path: "e.ts" },
  ]);
  assert.deepEqual(rows.map((row) => row.path), ["a.ts", "b.ts", "c.ts", "d.ts"]);
  assert.equal(rows[0].description, "first");
  assert.deepEqual(normalizeDeliverables("nope"), []);
});

test("leafName shows the file, not the whole path", () => {
  assert.equal(leafName("src/renderer/main.tsx"), "main.tsx");
  assert.equal(leafName("C:\\work\\out\\report.pdf"), "report.pdf");
  assert.equal(leafName("README.md"), "README.md");
  assert.equal(leafName(""), "");
});
