/**
 * Symbol navigation without a language server.
 *
 * A real LSP needs a running language server per project; this reads the tree
 * and answers the three questions that matter inside a tool loop: what is in
 * this file, where is this symbol defined, and where is it used. It is honest
 * about being a scan: patterns cover Python and JS/TS, everything else is text.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

export type SymbolHit = { name: string; kind: string; file: string; line: number; preview: string };

const SKIP = new Set(["node_modules", ".git", "dist", "build", "release", ".vite", "DSH", "__pycache__"]);
const SOURCE = new Set([".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const MAX_FILES = 3000;
const MAX_FILE_BYTES = 1024 * 1024;

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function* walk(root: string, directory = root, budget = { files: 0 }): Generator<string> {
  if (budget.files >= MAX_FILES) return;
  let names: string[] = [];
  try { names = readdirSync(directory); } catch { return; }
  for (const name of names) {
    if (budget.files >= MAX_FILES) return;
    if (SKIP.has(name) || name.startsWith(".")) continue;
    const path = join(directory, name);
    let info;
    try { info = statSync(path); } catch { continue; }
    if (info.isDirectory()) yield* walk(root, path, budget);
    else if (SOURCE.has(extname(name).toLowerCase()) && info.size <= MAX_FILE_BYTES) budget.files += 1, void (yield path);
  }
}

function patterns(file: string): { pattern: RegExp; kind: string }[] {
  const ext = extname(file).toLowerCase();
  if (ext === ".py") {
    return [
      { pattern: /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)/, kind: "function" },
      { pattern: /^(\s*)class\s+([A-Za-z_]\w*)/, kind: "class" },
    ];
  }
  return [
    { pattern: /^(\s*)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: "function" },
    { pattern: /^(\s*)(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class" },
    { pattern: /^(\s*)(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/, kind: "binding" },
    { pattern: /^(\s*)(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/, kind: "type" },
    { pattern: /^(\s*)(?:export\s+)?(?:const\s+)?([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?\(/, kind: "method" },
  ];
}

function scanFile(root: string, file: string): SymbolHit[] {
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const hits: SymbolHit[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    for (const { pattern, kind } of patterns(file)) {
      const match = pattern.exec(lines[index]);
      if (!match) continue;
      hits.push({ name: match[2], kind, file: relative(root, file), line: index + 1, preview: lines[index].trim().slice(0, 120) });
      break;
    }
  }
  return hits;
}

/** Every named declaration in one file; paths outside the root are refused. */
export function outlineFile(rootDir: string, file: string, limit = 200): { ok: boolean; root?: string; symbols?: SymbolHit[]; error?: string } {
  const base = resolve(rootDir);
  const target = resolve(base, file);
  if (!inside(base, target)) return { ok: false, error: "out_of_scope" };
  if (!existsSync(target) || !statSync(target).isFile()) return { ok: false, error: "not_a_file" };
  if (!SOURCE.has(extname(target).toLowerCase())) return { ok: false, error: "unsupported_file" };
  return { ok: true, root: base, symbols: scanFile(base, target).slice(0, limit) };
}

/** Where a symbol is declared, across the tree. */
export function findDefinition(rootDir: string, symbol: string, limit = 20): { ok: boolean; root?: string; hits?: SymbolHit[]; error?: string } {
  const name = String(symbol || "").trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return { ok: false, error: "invalid_symbol" };
  const base = resolve(rootDir);
  const hits: SymbolHit[] = [];
  for (const file of walk(base)) {
    for (const hit of scanFile(base, file)) if (hit.name === name) hits.push(hit);
    if (hits.length >= limit) break;
  }
  return { ok: true, root: base, hits: hits.slice(0, limit) };
}

/** Every line that mentions the symbol, definitions included. */
export function findReferences(rootDir: string, symbol: string, limit = 50): { ok: boolean; root?: string; hits?: SymbolHit[]; error?: string } {
  const name = String(symbol || "").trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return { ok: false, error: "invalid_symbol" };
  const base = resolve(rootDir);
  const word = new RegExp("(^|[^\\w$])" + name + "([^\\w$]|$)");
  const hits: SymbolHit[] = [];
  for (const file of walk(base)) {
    let lines: string[] = [];
    try { lines = readFileSync(file, "utf8").split(/\r?\n/); } catch { continue; }
    for (let index = 0; index < lines.length && hits.length < limit; index += 1) {
      if (word.test(lines[index])) hits.push({ name, kind: "reference", file: relative(base, file), line: index + 1, preview: lines[index].trim().slice(0, 120) });
    }
    if (hits.length >= limit) break;
  }
  return { ok: true, root: base, hits: hits.slice(0, limit) };
}
