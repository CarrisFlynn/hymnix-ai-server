import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { estimateTokens, parseSlashCommand, classifyConnectError, downloadBytes, passwordStrength } from "../src/renderer/lib/pure.js";

/**
 * These cover the parts of the Phase 1 component layer that are pure logic, so a
 * regression shows up here instead of as a broken dialog nobody opened.
 */

test("estimateTokens counts CJK as one token and Latin as about four chars", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("你好世界"), 4);
  assert.equal(estimateTokens("hello"), 1);           // 5 / 4 -> 1
  assert.equal(estimateTokens("hello world!"), 3);    // 12 / 4 -> 3
  // Mixed text must not double count the CJK glyphs.
  const mixed = estimateTokens("你好 hello");
  assert.equal(mixed, 2 + Math.round(6 / 4));
  assert.ok(estimateTokens("中文".repeat(100)) === 200);
});

test("parseSlashCommand only treats a leading slash as a command", () => {
  assert.deepEqual(parseSlashCommand("/model llama3"), { command: "model", argument: "llama3", isCommand: true });
  assert.deepEqual(parseSlashCommand("/clear"), { command: "clear", argument: "", isCommand: true });
  assert.deepEqual(parseSlashCommand("/system You are terse."), { command: "system", argument: "You are terse.", isCommand: true });
  // Collapses runs of whitespace and lowercases the verb.
  assert.deepEqual(parseSlashCommand("/MODEL   qwen2.5\t7b"), { command: "model", argument: "qwen2.5 7b", isCommand: true });
  for (const input of ["hello", "", "/", "  /model x"]) {
    const parsed = parseSlashCommand(input);
    assert.equal(parsed.isCommand, false, `"${input}" must not be a command`);
    assert.equal(parsed.command, "");
  }
});

test("classifyConnectError maps failures to one actionable hint each", () => {
  assert.equal(classifyConnectError("HTTP 401 bad_password").category, "password");
  assert.equal(classifyConnectError("密码错误").category, "password");
  assert.equal(classifyConnectError("protocol version mismatch").category, "version");
  assert.equal(classifyConnectError("协议不匹配").category, "version");
  assert.equal(classifyConnectError("fetch failed: ECONNREFUSED 127.0.0.1:11435").category, "unreachable");
  assert.equal(classifyConnectError("connect timeout").category, "unreachable");
  assert.equal(classifyConnectError("ENOTFOUND host").category, "unreachable");
  assert.equal(classifyConnectError("something odd").category, "unknown");
  // Every category must carry a non-empty sentence the panel can render.
  for (const message of ["401", "version", "timeout", "?", undefined, null]) {
    const { hint } = classifyConnectError(message);
    assert.ok(hint.length > 10, `hint for ${message} must be usable copy`);
  }
});

test("downloadBytes uses decimal units and one decimal place above bytes", () => {
  assert.equal(downloadBytes(0, "en"), "0 B");
  assert.equal(downloadBytes(999, "en"), "999 B");
  assert.equal(downloadBytes(1000, "en"), "1 KB");
  assert.equal(downloadBytes(1_500_000, "en"), "1.5 MB");
  assert.equal(downloadBytes(4_700_000_000, "en"), "4.7 GB");
  // Never spends two decimals or a trailing .0
  assert.equal(downloadBytes(2_000_000, "en"), "2 MB");
  // Locale formatting must not leak into the unit label
  assert.ok(downloadBytes(1_234_567, "zh").endsWith(" MB"));
  // Garbage input degrades to zero rather than NaN in the UI
  assert.equal(downloadBytes(Number.NaN, "en"), "0 B");
  assert.equal(downloadBytes(-5, "en"), "0 B");
});

test("passwordStrength escalates with length and character classes", () => {
  assert.deepEqual(passwordStrength(""), { score: 0, label: "empty" });
  assert.equal(passwordStrength("abc").score, 1);              // too short
  assert.equal(passwordStrength("password").score, 1);         // common password
  assert.equal(passwordStrength("aaaaaaaabbbb").score, 1);     // repeated run, one class
  assert.equal(passwordStrength("password123").score, 3);      // 11 chars, lower + digits
  assert.equal(passwordStrength("Mellon-2024x").score, 3);     // 12 chars, four classes
  assert.equal(passwordStrength("Mellon-Bread-2024").score, 4); // 17 chars, four classes
  assert.equal(passwordStrength("Ab1!").score, 1);             // short even with classes
  // A long single-class password is still not trustworthy.
  assert.equal(passwordStrength("abcdefghijklmnopqrstuvwxyz").score, 2);
  // Score is always within the four-bar meter's range.
  for (const sample of ["a", "aaaaaaaaaaaaaaaaaaaa", "ÄÖÜ-äöü-1234", "x".repeat(64)]) {
    const { score } = passwordStrength(sample);
    assert.ok(score >= 0 && score <= 4, `score out of range for ${sample}`);
  }
});

test("every interface string has Chinese copy", () => {
  // The plan makes both languages first-class, so a missing key is a bug, not a
  // fallback. Scan the literals passed to t()/tf() and require a zh entry each.
  const dir = new URL("../src/renderer/", import.meta.url);
  const sources = ["main.tsx", "components.tsx", "chat.tsx", "chat-navigation.tsx", "ModelCatalog.tsx"];
  const keys = new Set();
  for (const file of sources) {
    const text = fs.readFileSync(new URL(file, dir), "utf8");
    // Every string that reaches t()/tf() as copy, including the branches of a
    // ternary. Comparison operands ("danger", "running") are skipped: they are
    // values the code compares against, not sentences a reader ever sees.
    for (const call of text.matchAll(/\btf?\((?:[^()]|\([^()]*\))*\)/g)) {
      for (const literal of call[0].matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
        const before = call[0].slice(0, literal.index).replace(/\s+$/, "").slice(-1);
        if (before === "=" || before === "!" || before === ">" || before === "<") continue;
        keys.add(literal[1]);
      }
    }
  }
  const i18n = fs.readFileSync(new URL("i18n.ts", dir), "utf8");
  const translated = new Set([...i18n.matchAll(/^ {2}"((?:[^"\\]|\\.)*)":/gm)].map((match) => match[1]));
  const missing = [...keys].filter((key) => /[a-zA-Z]/.test(key) && !translated.has(key)).sort();
  assert.deepEqual(missing, [], `untranslated strings: ${missing.slice(0, 12).join(" | ")}`);
  assert.ok(translated.size > 600, "the zh dictionary must stay substantial");
});

test("theme swatches mirror the accent colour in each theme file", () => {
  // The first-run row previews each preset before it is applied, so the swatch has
  // to match `--accent` in the stylesheet. This keeps the two from drifting apart.
  const themes = fs.readFileSync(new URL("../src/theme/themeManager.ts", import.meta.url), "utf8");
  const definitions = [...themes.matchAll(/\{ id: "([\w-]+)", mode: "(light|dark)", label: "[^"]+", swatch: "(#[0-9a-fA-F]{6})", bg: "(#[0-9a-fA-F]{6})", surface: "(#[0-9a-fA-F]{6})" \}/g)]
    .map((match) => ({ id: match[1], mode: match[2], swatch: match[3].toLowerCase(), bg: match[4].toLowerCase(), surface: match[5].toLowerCase() }));
  assert.equal(definitions.length, 9, "all nine presets must declare swatch, bg and surface");
  const files = {
    "camellia-white": "light-camellia", "deep-sea-blue": "light-deepsea", "ink-green": "light-ink",
    "honey-crimson": "light-honey", "cyan-dark": "dark-cyan", "orange-dark": "dark-orange",
    "rog-red-black": "dark-rog", "neon-black": "dark-neon", "graphite-gold": "dark-graphite",
  };
  for (const definition of definitions) {
    const css = fs.readFileSync(new URL(`../src/styles/themes/${files[definition.id]}.css`, import.meta.url), "utf8");
    const accent = /--accent:(#[0-9a-fA-F]{6})/.exec(css);
    assert.ok(accent, `${definition.id} must declare --accent`);
    assert.equal(definition.swatch, accent[1].toLowerCase(), `${definition.id} swatch must match --accent`);
    // A settings card paints its own preview from these two, so they cannot drift either.
    const bg = /--bg:(#[0-9a-fA-F]{6})/.exec(css);
    const surface = /--surface:(#[0-9a-fA-F]{6})/.exec(css);
    assert.ok(bg && surface, `${definition.id} must declare --bg and --surface`);
    assert.equal(definition.bg, bg[1].toLowerCase(), `${definition.id} preview background must match --bg`);
    assert.equal(definition.surface, surface[1].toLowerCase(), `${definition.id} preview panel must match --surface`);
  }
});
import { createToolCallCollector } from "../src/renderer/lib/tool-stream.js";
import { DEFAULT_SHORTCUTS, bindingKey, eventBinding, findConflicts, formatBinding, matchesBinding, resolveShortcuts, withOverride, withoutOverride } from "../src/renderer/lib/shortcuts.js";
import { applyTodos, attachEvidence, createPlan, markStep, planPercent, planStats } from "../src/renderer/lib/plan.js";
import { activeJobCount, filterJobs, formatElapsed, jobElapsed, mergeJob, sortJobs } from "../src/renderer/lib/jobs.js";

// --- 1.4: plan, jobs and rebindable shortcuts -------------------------------


test("tool-call fragments from either dialect assemble into one call", () => {
  // OpenAI: name once, arguments streamed as JSON text, keyed by index.
  const openai = createToolCallCollector();
  openai.push([{ index: 0, id: "call_1", function: { name: "todo_write", arguments: '{"todos":[{"content":"a",' } }]);
  openai.push([{ index: 0, function: { arguments: '"status":"pending"}]}' } }]);
  const first = openai.calls(() => "generated");
  assert.equal(first.length, 1);
  assert.equal(first[0].id, "call_1");
  assert.equal(first[0].name, "todo_write");
  assert.deepEqual(JSON.parse(first[0].arguments).todos, [{ content: "a", status: "pending" }]);

  // Ollama: the whole call in one delta, arguments already parsed as an object.
  const ollama = createToolCallCollector();
  ollama.push([{ function: { name: "fs.list", arguments: { path: "." } } }]);
  const second = ollama.calls(() => "generated");
  assert.equal(second.length, 1);
  assert.equal(second[0].id, "generated");
  assert.equal(second[0].arguments, '{"path":"."}');
});

test("a nameless fragment is dropped and parallel calls keep their order", () => {
  const collector = createToolCallCollector();
  collector.push([{ index: 0, id: "a", function: { name: "fs.read", arguments: "{}" } }]);
  collector.push([{ index: 1, id: "b", function: { arguments: "{}" } }]);   // name never arrives
  collector.push([{ index: 2, id: "c", function: { name: "calc", arguments: '{"expr":"1+1"}' } }]);
  const calls = collector.calls(() => "x");
  assert.deepEqual(calls.map((call) => call.id), ["a", "c"]);
  assert.equal(calls[1].name, "calc");
  // A second read of the same collector must not duplicate anything.
  assert.equal(collector.calls(() => "x").length, 2);
});

test("a shortcut is compared by physical code and modifier set", () => {
  assert.equal(formatBinding({ code: "Slash", modifiers: ["ctrl"] }), "Ctrl+/");
  assert.equal(formatBinding({ code: "Digit1", modifiers: ["ctrl"] }), "Ctrl+1");
  assert.equal(bindingKey({ code: "KeyK", modifiers: ["ctrl"] }), bindingKey({ code: "KeyK", modifiers: ["ctrl"] }));
  // A missing modifier is a different command, not a looser match.
  assert.notEqual(bindingKey({ code: "KeyK", modifiers: ["ctrl"] }), bindingKey({ code: "KeyK", modifiers: ["ctrl", "shift"] }));
  assert.ok(matchesBinding({ code: "KeyK", modifiers: ["ctrl"] }, { code: "KeyK", ctrlKey: true, key: "k" }));
  assert.ok(!matchesBinding({ code: "KeyK", modifiers: ["ctrl"] }, { code: "KeyK", ctrlKey: true, shiftKey: true, key: "K" }));
  // A bare modifier is not a binding.
  assert.equal(eventBinding({ code: "ControlLeft", ctrlKey: true, key: "Control" }), null);
});

test("the editor refuses a combination another command already owns", () => {
  const owner = findConflicts(DEFAULT_SHORTCUTS, "session.new", { code: "KeyK", modifiers: ["ctrl"] });
  assert.deepEqual(owner.map((row) => row.id), ["palette.open"]);
  // Rebinding a command onto its own key is not a conflict.
  assert.deepEqual(findConflicts(DEFAULT_SHORTCUTS, "session.new", { code: "KeyN", modifiers: ["ctrl"] }), []);
  // Fixed rows never lose their key to an editor change.
  assert.deepEqual(findConflicts(DEFAULT_SHORTCUTS, "session.new", { code: "Escape", modifiers: [] }), []);
});

test("overrides store only the changes and reset cleanly", () => {
  const plain = resolveShortcuts(DEFAULT_SHORTCUTS, {}, "win32");
  assert.equal(plain.every((command) => command.overridden === false), true);
  const moved = withOverride({}, "session.new", { code: "KeyT", modifiers: ["ctrl", "shift"] });
  const applied = resolveShortcuts(DEFAULT_SHORTCUTS, moved, "win32");
  const session = applied.find((command) => command.id === "session.new");
  assert.equal(session.binding.code, "KeyT");
  assert.equal(session.overridden, true);
  const reset = resolveShortcuts(DEFAULT_SHORTCUTS, withoutOverride(moved, "session.new"), "win32");
  assert.equal(reset.find((command) => command.id === "session.new").binding.code, "KeyN");
});

test("a rewritten plan keeps step identity and never rewinds a step", () => {
  const plan = createPlan("session-1", 1000);
  const first = applyTodos(plan, { todos: [
    { content: "Read the failing test", status: "in_progress" },
    { content: "Fix the code", status: "pending" },
    { content: "Run the suite", status: "pending" },
  ] }, 1000);
  assert.equal(first.steps.length, 3);
  assert.equal(first.steps[0].status, "running");
  assert.equal(first.steps[0].startedAt, 1000);
  const openedId = first.steps[0].id;

  const second = applyTodos(first, { todos: [
    { content: "Read the failing test", status: "completed" },
    { content: "Fix the code", status: "in_progress" },
    { content: "Run the suite", status: "pending" },
  ] }, 5000);
  assert.equal(second.steps[0].id, openedId, "a step keeps its identity across rewrites");
  assert.equal(second.steps[0].status, "done");
  assert.equal(second.steps[0].finishedAt, 5000);
  assert.equal(second.steps[1].status, "running");
  assert.equal(planPercent(second), 33);

  // The model saying "pending" again must not undo a finished step.
  const third = applyTodos(second, { todos: [
    { content: "Read the failing test", status: "pending" },
    { content: "Fix the code", status: "pending" },
  ] }, 9000);
  assert.equal(third.steps[0].status, "done");
  // A step that was running when it disappeared is closed, not left hanging.
  assert.equal(third.steps.find((step) => step.intent === "Run the suite"), undefined);
  assert.equal(third.steps[1].status, "running", "running never rewinds to pending");
  assert.equal(planStats(third).running + planStats(third).done, 2);
});

test("manual marks and evidence attach to the right step", () => {
  const plan = applyTodos(createPlan("s", 0), { todos: [{ content: "One", status: "in_progress" }, { content: "Two", status: "pending" }] }, 100);
  const done = markStep(plan, plan.steps[0].id, "done", 400);
  assert.equal(done.steps[0].status, "done");
  assert.equal(done.steps[0].finishedAt, 400);
  const withEvidence = attachEvidence(plan, plan.steps[0].id, "ev-1");
  assert.deepEqual(withEvidence.steps[0].evidenceIds, ["ev-1"]);
  // Attaching twice is a no-op, not a duplicate.
  assert.deepEqual(attachEvidence(withEvidence, plan.steps[0].id, "ev-1").steps[0].evidenceIds, ["ev-1"]);
});

test("jobs sort by liveness and one job never appears twice", () => {
  const running = { id: "a", status: "running", startedAt: 100, finishedAt: null, kind: "shell", title: "build" };
  const done = { id: "b", status: "done", startedAt: 50, finishedAt: 200, kind: "shell", title: "test" };
  const sorted = sortJobs([done, running]);
  assert.deepEqual(sorted.map((job) => job.id), ["a", "b"]);
  assert.equal(activeJobCount([running, done]), 1);
  const merged = mergeJob(mergeJob([], running), { ...running, status: "done", finishedAt: 300 });
  assert.equal(merged.length, 1, "an update replaces the row instead of appending");
  assert.equal(merged[0].status, "done");
  assert.equal(jobElapsed({ ...done, finishedAt: 1250 }, 9999), 1200);
  assert.equal(formatElapsed(65_000), "1:05");
  assert.equal(filterJobs([running, done], "running").length, 1);
  assert.equal(filterJobs([running, done], "finished").length, 1);
});
