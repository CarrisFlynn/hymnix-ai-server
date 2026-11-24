#!/usr/bin/env node
/**
 * WCAG contrast gate for every theme (Phase 1 definition of done).
 *
 * Reads desktop/src/styles/themes/*.css, resolves the semantic tokens (including one
 * level of var() indirection) and checks the pairs the UI actually renders:
 * body text, muted text, captions, accent text on soft tint, labels on accent fills,
 * status colours on their tinted backgrounds, and 3:1 outline pairs.
 *
 * Usage: node tools/check-contrast.mjs [--verbose] [--json]
 * Exit code 1 when any pair is under its target ratio.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const themeDir = join(root, "desktop", "src", "styles", "themes");
const verbose = process.argv.includes("--verbose");
const asJson = process.argv.includes("--json");

const AA_TEXT = 4.5; // WCAG 2.2 AA, normal text
const AA_LARGE = 3; // large text and non-text contrast (outlines, borders)
const AAA_TEXT = 7;

/** Pairs the component layer depends on. `min` is the required ratio. */
const PAIRS = [
  { fg: "text", bg: "bg", min: AA_TEXT, name: "body text" },
  { fg: "text", bg: "surface", min: AA_TEXT, name: "text on surface" },
  { fg: "text", bg: "sidebar", min: AA_TEXT, name: "text on sidebar" },
  { fg: "text", bg: "raised", min: AA_TEXT, name: "text on raised" },
  { fg: "muted", bg: "surface", min: AA_TEXT, name: "muted on surface" },
  { fg: "muted", bg: "bg", min: AA_TEXT, name: "muted on canvas" },
  { fg: "faint", bg: "surface", min: AA_TEXT, name: "caption on surface" },
  { fg: "faint", bg: "bg", min: AA_TEXT, name: "caption on canvas" },
  { fg: "accent-text", bg: "surface", min: AA_TEXT, name: "accent text on surface" },
  { fg: "accent-text", bg: "accent-soft", min: AA_TEXT, name: "accent text on soft tint" },
  { fg: "on-accent", bg: "accent-fill", min: AA_TEXT, name: "label on accent fill" },
  { fg: "on-accent", bg: "accent-hover", min: AA_TEXT, name: "label on accent hover" },
  { fg: "success", bg: "success-soft", min: AA_TEXT, name: "success on tint" },
  { fg: "warning", bg: "warning-soft", min: AA_TEXT, name: "warning on tint" },
  { fg: "danger", bg: "danger-soft", min: AA_TEXT, name: "danger on tint" },
  { fg: "text", bg: "sunken", min: AA_TEXT, name: "text on sunken" },
  { fg: "border-strong", bg: "bg", min: AA_LARGE, name: "strong border (outline)" },
  { fg: "accent-fill", bg: "bg", min: AA_LARGE, name: "accent outline" },
  { fg: "term-fg", bg: "term-bg", min: AA_TEXT, name: "terminal text" },
  { fg: "term-muted", bg: "term-bg", min: AA_TEXT, name: "terminal muted" },
  { fg: "term-prompt", bg: "term-bg", min: AA_LARGE, name: "terminal prompt" },
];

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function declarations(block) {
  const out = {};
  for (const match of stripComments(block).matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    out[match[1]] = match[2].trim();
  }
  return out;
}

/** Resolve `var(--x)` against the same theme, then against a fallback map. */
function resolve(name, tokens, seen = new Set()) {
  if (seen.has(name)) return undefined;
  seen.add(name);
  let value = tokens[name];
  if (!value) return undefined;
  const nested = value.match(/^var\(\s*--([\w-]+)\s*(?:,\s*([^)]+))?\)$/);
  if (nested) {
    const next = resolve(nested[1], tokens, seen);
    return next ?? (nested[2] ? nested[2].trim() : undefined);
  }
  return value;
}

function parseColour(raw) {
  if (!raw) return null;
  let value = raw.trim().toLowerCase();
  if (value.startsWith("#")) {
    let hex = value.slice(1);
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    if (hex.length === 8) hex = hex.slice(0, 6);
    if (!/^[0-9a-f]{6}$/.test(hex)) return null;
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  const rgb = value.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3] };
  // color-mix is used by the Soften accent switch; approximate with the first colour.
  const mix = value.match(/^color-mix\([^,]+,\s*(#[0-9a-f]{3,8})\s*,\s*(#[0-9a-f]{3,8})/);
  if (mix) return parseColour(mix[1]);
  return null;
}

function luminance({ r, g, b }) {
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function readThemes() {
  const themes = [];
  for (const file of readdirSync(themeDir).filter((name) => name.endsWith(".css")).sort()) {
    const css = stripComments(readFileSync(join(themeDir, file), "utf8"));
    const match = css.match(/:root\[data-theme="([^"]+)"\]\s*\{([\s\S]*?)\}/);
    if (!match) continue;
    themes.push({ id: match[1], file, tokens: declarations(match[2]) });
  }
  return themes;
}

const results = [];
let failures = 0;

for (const theme of readThemes()) {
  for (const pair of PAIRS) {
    const fgRaw = resolve(pair.fg, theme.tokens);
    const bgRaw = resolve(pair.bg, theme.tokens);
    const fg = parseColour(fgRaw);
    const bg = parseColour(bgRaw);
    if (!fg || !bg) {
      results.push({ theme: theme.id, pair: pair.name, ratio: NaN, min: pair.min, status: "missing", fg: fgRaw, bg: bgRaw });
      failures++;
      continue;
    }
    const value = ratio(fg, bg);
    const status = value + 1e-9 >= pair.min ? "pass" : "fail";
    if (status === "fail") failures++;
    results.push({ theme: theme.id, pair: pair.name, ratio: value, min: pair.min, status, fg: fgRaw, bg: bgRaw });
  }
}

if (asJson) {
  console.log(JSON.stringify({ failures, results }, null, 2));
} else {
  let current = "";
  for (const row of results) {
    if (row.theme !== current) {
      current = row.theme;
      console.log(`\n${current}`);
    }
    const value = Number.isFinite(row.ratio) ? row.ratio.toFixed(2) : "n/a";
    if (row.status === "pass" && !verbose) continue;
    const mark = row.status === "pass" ? "ok  " : row.status === "fail" ? "FAIL" : "MISS";
    console.log(`  ${mark} ${value}:1 (min ${row.min})  ${row.pair}  [${row.fg} on ${row.bg}]`);
  }
  const total = results.length;
  console.log(`\n${total - failures}/${total} pairs pass across ${new Set(results.map((r) => r.theme)).size} themes.`);
}

process.exit(failures ? 1 : 0);
