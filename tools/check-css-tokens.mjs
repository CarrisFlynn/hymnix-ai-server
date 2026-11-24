#!/usr/bin/env node
/**
 * Design-token gate: component CSS may only use semantic tokens.
 *
 * Fails when a stylesheet outside `src/styles/themes/` and `src/styles/tokens/`
 * contains a hex colour or reads a raw `--p-*` primitive. This is the dependency-free
 * equivalent of the stylelint `color-no-hex` rule configured in .stylelintrc.json,
 * so CI can enforce it without installing anything.
 *
 * Usage: node tools/check-css-tokens.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "desktop", "src");
const allowed = ["styles/themes", "styles/tokens"].map((part) => join(src, part).replace(/\\/g, "/"));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".css")) out.push(full);
  }
  return out;
}

const failures = [];
let checked = 0;
for (const file of walk(src)) {
  const normalized = file.replace(/\\/g, "/");
  if (allowed.some((prefix) => normalized.startsWith(prefix))) continue;
  checked++;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    // Comments are allowed to mention a colour in prose.
    const code = line.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of code.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      failures.push(`${relative(root, file).replace(/\\/g, "/")}:${index + 1}  hex colour ${match[0]}`);
    }
    for (const match of code.matchAll(/var\(\s*--p-[a-z0-9-]+/g)) {
      failures.push(`${relative(root, file).replace(/\\/g, "/")}:${index + 1}  raw primitive ${match[0]}`);
    }
  });
}

if (failures.length) {
  console.error(`Design-token check failed (${failures.length}):`);
  for (const line of failures) console.error("  " + line);
  console.error("\nMove colours into desktop/src/styles/themes/*.css and reference semantic tokens.");
  process.exit(1);
}
console.log(`Design-token check passed: ${checked} component stylesheets use semantic tokens only.`);
