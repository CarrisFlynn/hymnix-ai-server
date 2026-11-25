#!/usr/bin/env node
/**
 * WCAG contrast gate for every theme (Phase 1 definition of done).
 *
 * Reads desktop/src/styles/themes/*.css, resolves the semantic tokens (any depth of
 * var() indirection, including color-mix()) and checks the pairs the UI actually
 * renders. The list is deliberately the set of combinations that failed in real
 * screenshots: labels on accent fills, status colours on the dark console, the
 * close button hover, the tonal button hover and the pressed state.
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

/** Pairs the component layer depends on. `min` is the required ratio. */
const PAIRS = [
  { fg: "text", bg: "bg", min: AA_TEXT, name: "body text" },
  { fg: "text", bg: "surface", min: AA_TEXT, name: "text on surface" },
  { fg: "text", bg: "sidebar", min: AA_TEXT, name: "text on sidebar" },
  { fg: "text", bg: "raised", min: AA_TEXT, name: "text on raised" },
  { fg: "muted", bg: "surface", min: AA_TEXT, name: "muted on surface" },
  { fg: "muted", bg: "bg", min: AA_TEXT, name: "muted on canvas" },
  { fg: "muted", bg: "raised", min: AA_TEXT, name: "muted on raised" },
  { fg: "faint", bg: "surface", min: AA_TEXT, name: "caption on surface" },
  { fg: "faint", bg: "bg", min: AA_TEXT, name: "caption on canvas" },
  { fg: "faint", bg: "sunken", min: AA_LARGE, name: "placeholder on sunken" },
  { fg: "accent-text", bg: "surface", min: AA_TEXT, name: "accent text on surface" },
  { fg: "accent-text", bg: "accent-soft", min: AA_TEXT, name: "accent text on soft tint" },
  { fg: "on-accent", bg: "accent-fill", min: AA_TEXT, name: "label on accent fill" },
  { fg: "on-accent", bg: "accent-hover", min: AA_TEXT, name: "label on accent hover" },
  { fg: "on-accent", bg: "accent-pressed", min: AA_TEXT, name: "label on accent pressed" },
  { fg: "text", bg: "accent-soft", min: AA_TEXT, name: "text on soft tint" },
  { fg: "surface", bg: "danger", min: AA_TEXT, name: "close button hover" },
  { fg: "success", bg: "success-soft", min: AA_TEXT, name: "success on tint" },
  { fg: "warning", bg: "warning-soft", min: AA_TEXT, name: "warning on tint" },
  { fg: "danger", bg: "danger-soft", min: AA_TEXT, name: "danger on tint" },
  { fg: "text", bg: "sunken", min: AA_TEXT, name: "text on sunken" },
  { fg: "border-strong", bg: "bg", min: AA_LARGE, name: "strong border (outline)" },
  { fg: "accent-fill", bg: "bg", min: AA_LARGE, name: "accent outline" },
  { fg: "term-fg", bg: "term-bg", min: AA_TEXT, name: "terminal text" },
  { fg: "term-muted", bg: "term-bg", min: AA_TEXT, name: "terminal muted" },
  { fg: "term-prompt", bg: "term-bg", min: AA_LARGE, name: "terminal prompt" },
  { fg: "term-success", bg: "term-bg", min: AA_TEXT, name: "terminal SYS tag" },
  { fg: "term-warning", bg: "term-bg", min: AA_TEXT, name: "terminal WRN tag" },
  { fg: "term-error", bg: "term-bg", min: AA_TEXT, name: "terminal ERR tag" },
];

/** Mixed backgrounds the component layer builds at runtime. */
const MIXES = [
  { fg: "text", base: "accent-soft", other: "accent-fill", weight: 74, min: AA_TEXT, name: "tonal button hover label" },
  { fg: "on-accent", base: "accent-fill-base", other: "text", weight: 78, min: AA_TEXT, name: "softened accent fill label" },
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

/** Expand var(--x, fallback) at any depth, including inside color-mix(). */
function expand(value, tokens, seen = new Set(), depth = 0) {
  if (typeof value !== "string" || depth > 10) return value;
  return value.replace(/var\(\s*--([\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (whole, name, fallback) => {
    const raw = tokens[name];
    if (raw === undefined || seen.has(name)) return fallback !== undefined ? fallback.trim() : whole;
    return expand(raw, tokens, new Set([...seen, name]), depth + 1);
  });
}

function resolve(name, tokens) {
  if (tokens[name] === undefined) return undefined;
  return expand(tokens[name], tokens, new Set([name]));
}

function parseColour(raw) {
  if (!raw) return null;
  const value = String(raw).trim().toLowerCase();
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
  if (value.startsWith("color-mix(")) return parseMix(value);
  return null;
}

/** Split a color-mix() argument list at the top level commas. */
function splitArgs(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) { parts.push(current); current = ""; continue; }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim());
}

/** Real srgb color-mix(): interpolate in sRGB, as the browser does. */
function parseMix(value) {
  const inner = value.slice(value.indexOf("(") + 1, value.lastIndexOf(")"));
  const args = splitArgs(inner);
  if (args.length < 3) return null;
  const colourArgs = args.slice(1);
  const parsed = colourArgs.map((arg) => {
    const match = arg.match(/^(#[0-9a-f]{3,8}|rgba?\([^)]*\))\s*([\d.]+)?%?$/);
    if (!match) return null;
    return { colour: parseColour(match[1]), weight: match[2] === undefined ? null : Number(match[2]) };
  });
  if (parsed.some((row) => !row || !row.colour)) return null;
  const specified = parsed.filter((row) => row.weight !== null).reduce((sum, row) => sum + row.weight, 0);
  const missing = parsed.filter((row) => row.weight === null).length;
  const weights = parsed.map((row) => row.weight === null ? (100 - specified) / (missing || 1) : row.weight);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const blended = parsed.reduce((acc, row, index) => ({
    r: acc.r + row.colour.r * (weights[index] / total),
    g: acc.g + row.colour.g * (weights[index] / total),
    b: acc.b + row.colour.b * (weights[index] / total),
  }), { r: 0, g: 0, b: 0 });
  return { r: Math.round(blended.r), g: Math.round(blended.g), b: Math.round(blended.b) };
}

function mixColours(first, weightA, second) {
  const w = Math.max(0, Math.min(100, weightA)) / 100;
  return {
    r: Math.round(first.r * w + second.r * (1 - w)),
    g: Math.round(first.g * w + second.g * (1 - w)),
    b: Math.round(first.b * w + second.b * (1 - w)),
  };
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
  const push = (pair, fgRaw, bgRaw) => {
    const fg = parseColour(fgRaw);
    const bg = parseColour(bgRaw);
    if (!fg || !bg) {
      results.push({ theme: theme.id, pair: pair.name, ratio: NaN, min: pair.min, status: "missing", fg: fgRaw, bg: bgRaw });
      failures++;
      return;
    }
    const value = ratio(fg, bg);
    const status = value + 1e-9 >= pair.min ? "pass" : "fail";
    if (status === "fail") failures++;
    results.push({ theme: theme.id, pair: pair.name, ratio: value, min: pair.min, status, fg: fgRaw, bg: bgRaw });
  };
  for (const pair of PAIRS) push(pair, resolve(pair.fg, theme.tokens), resolve(pair.bg, theme.tokens));
  for (const pair of MIXES) {
    const a = parseColour(resolve(pair.base, theme.tokens));
    const b = parseColour(resolve(pair.other, theme.tokens));
    if (!a || !b) {
      results.push({ theme: theme.id, pair: pair.name, ratio: NaN, min: pair.min, status: "missing" });
      failures++;
      continue;
    }
    const mixed = mixColours(a, pair.weight, b);
    push(pair, resolve(pair.fg, theme.tokens), "#" + [mixed.r, mixed.g, mixed.b].map((v) => v.toString(16).padStart(2, "0")).join(""));
  }
}

if (asJson) {
  console.log(JSON.stringify({ failures, results }, null, 2));
} else {
  let current = "";
  for (const row of results) {
    if (row.theme !== current) {
      current = row.theme;
      console.log("\n" + current);
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
