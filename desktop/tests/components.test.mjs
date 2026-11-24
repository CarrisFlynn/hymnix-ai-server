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
  const sources = ["main.tsx", "components.tsx", "chat.tsx", "chat-navigation.tsx", "design-lab.tsx", "ModelCatalog.tsx"];
  const keys = new Set();
  for (const file of sources) {
    const text = fs.readFileSync(new URL(file, dir), "utf8");
    for (const match of text.matchAll(/\btf?\("((?:[^"\\]|\\.)*)"/g)) keys.add(match[1]);
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
