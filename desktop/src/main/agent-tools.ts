/**
 * The agent's file-side tools, in the main process.
 *
 * They used to live in the Python gateway, which meant the agent lost fs.read,
 * fs.write, fs.edit, patch.apply and repo.* the moment the gateway was stopped —
 * and in a packaged build those same tools were rooted at resources/ anyway.
 * Here they work with no gateway, no network and no Python, and they are rooted
 * at the folder the user picked.
 *
 * Safety carried over from the Python versions on purpose: paths are resolved
 * inside the sandbox root, writes go through an atomic rename, and edits read
 * the whole file with exact bytes so a large file cannot be truncated and its
 * line endings cannot be rewritten.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type ToolDef = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  /** Mutates this machine, so the caller must ask the user first. */
  danger: boolean;
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>;
};

const REGISTRY = new Map<string, ToolDef>();
let sandboxRoot = "";

/** Point every file tool at one folder. Called when the app starts and when the user picks another. */
export function configureTools(root: string): void {
  sandboxRoot = root && existsSync(root) ? root : "";
}

export function toolRoot(): string {
  return sandboxRoot || process.cwd();
}

export function listToolDefs(): Array<{ name: string; description: string; schema: Record<string, unknown> }> {
  return [...REGISTRY.values()].map(({ name, description, schema }) => ({ name, description, schema }));
}

export function isDangerousTool(name: string): boolean {
  return Boolean(REGISTRY.get(name)?.danger);
}

export function hasLocalTool(name: string): boolean {
  return REGISTRY.has(name);
}

export class ToolFailure extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export function fail(code: string): never { throw new ToolFailure(code); }

/**
 * Resolve the real location of a path, following links even when the last part
 * does not exist yet: walk up to the nearest existing ancestor, resolve that,
 * then append what is missing.
 */
function realLocation(target: string): string {
  const missing: string[] = [];
  let current = target;
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      const real = realpathSync(current);
      return missing.length ? join(real, ...missing.reverse()) : real;
    } catch {
      const parent = dirname(current);
      if (parent === current) return target;
      missing.push(basename(current));
      current = parent;
    }
  }
  return target;
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Resolve a path inside the sandbox.
 *
 * A string check alone is not enough: a junction inside the workspace can point
 * anywhere while the path still reads "work/escape/secret.txt". Both sides are
 * therefore resolved to their real location first, and the containment test runs
 * on those — the same rule the gateway has enforced since its eighth audit.
 */
export function safePath(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) fail("path_required");
  const root = realLocation(resolve(toolRoot()));
  const target = isAbsolute(value) ? resolve(value) : resolve(root, value);
  const real = realLocation(target);
  if (!inside(root, real)) fail("out_of_scope");
  return real;
}

export function relPath(absolute: string): string {
  return relative(resolve(toolRoot()), absolute).replaceAll(sep, "/") || ".";
}

const MAX_EDIT_BYTES = 4 * 1024 * 1024;
const READ_LIMIT = 200 * 1024;

function readExact(path: string): string {
  if (statSync(path).size > MAX_EDIT_BYTES) fail("file_too_large");
  const bytes = readFileSync(path);
  const text = bytes.toString("utf8");
  if (text.includes("\u0000")) fail("not_utf8");
  return text;
}

/** Atomic, byte-exact write: no newline translation, temp name per call. */
function writeExact(path: string, text: string): void {
  const data = Buffer.from(text, "utf8");
  const tmp = path + ".hx-" + process.pid + "-" + Math.random().toString(36).slice(2, 8);
  writeFileSync(tmp, data);
  try {
    renameSync(tmp, path);
  } catch (error) {
    // Never leave a temp copy of the file behind: it holds the whole content.
    try { unlinkSync(tmp); } catch { /* already gone */ }
    throw error;
  }
}

export function registerTool(def: ToolDef): void { REGISTRY.set(def.name, def); }

registerTool({
  name: "time.now",
  description: "Current local time as an ISO 8601 string.",
  schema: { type: "object", properties: {} },
  danger: false,
  handler: () => new Date().toISOString(),
});

registerTool({
  name: "calc",
  description: "Evaluate a plain arithmetic expression (+ - * / % ** and parentheses).",
  schema: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] },
  danger: false,
  handler: (args) => {
    const expression = String(args.expression || "");
    if (!/^[-+*/%(). 0-9eE]+$/.test(expression) || !expression.trim()) fail("invalid_expression");
    // eslint-disable-next-line no-new-func
    const value = Function('"use strict";return (' + expression + ")")();
    if (typeof value !== "number" || !Number.isFinite(value)) fail("invalid_expression");
    return value;
  },
});

registerTool({
  name: "sysinfo",
  description: "Platform, CPU count, memory and uptime for this machine.",
  schema: { type: "object", properties: {} },
  danger: false,
  handler: () => ({
    platform: process.platform,
    arch: process.arch,
    cpus: require("node:os").cpus().length,
    totalMemGb: Math.round((require("node:os").totalmem() / 1073741824) * 10) / 10,
    freeMemGb: Math.round((require("node:os").freemem() / 1073741824) * 10) / 10,
    uptimeHours: Math.round(require("node:os").uptime() / 3600),
    node: process.versions.node,
  }),
});

registerTool({
  name: "fs.list",
  description: "List one folder inside the workspace.",
  schema: { type: "object", properties: { path: { type: "string" } } },
  danger: false,
  handler: (args) => {
    const target = safePath(args.path ?? ".");
    if (!statSync(target).isDirectory()) fail("not_a_directory");
    return readdirSync(target).sort().slice(0, 1000);
  },
});

registerTool({
  name: "fs.stat",
  description: "Size, type and modification time of one path.",
  schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  danger: false,
  handler: (args) => {
    const target = safePath(args.path);
    const info = statSync(target);
    return { path: relPath(target), isDir: info.isDirectory(), bytes: info.size, mtime: Math.round(info.mtimeMs) };
  },
});

registerTool({
  name: "fs.read",
  description: "Read a UTF-8 text file. Reports truncated and the real byte size instead of trimming silently.",
  schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  danger: false,
  handler: (args) => {
    const target = safePath(args.path);
    if (!statSync(target).isFile()) fail("not_a_file");
    const size = statSync(target).size;
    const text = readFileSync(target).subarray(0, READ_LIMIT).toString("utf8");
    return { path: relPath(target), text, truncated: size > READ_LIMIT, bytes: size };
  },
});

registerTool({
  name: "fs.write",
  description: "Write one UTF-8 file inside the workspace (max 256 KB), atomically. Replaces the whole file.",
  schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
  danger: true,
  handler: (args) => {
    const target = safePath(args.path);
    const content = args.content ?? args.data ?? args.text;
    if (typeof content !== "string") fail("content_required");
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > 256 * 1024) fail("content_too_large");
    mkdirSync(resolve(target, ".."), { recursive: true });
    writeExact(target, content);
    return { path: relPath(target), bytes };
  },
});

registerTool({
  name: "fs.edit",
  description: "Replace one exact occurrence in a file, or every occurrence with all=true. Reads and writes exact bytes, so nothing else in the file changes.",
  schema: {
    type: "object",
    properties: { path: { type: "string" }, find: { type: "string" }, replace: { type: "string" }, all: { type: "boolean" } },
    required: ["path", "find", "replace"],
  },
  danger: true,
  handler: (args) => {
    const target = safePath(args.path);
    if (!statSync(target).isFile()) fail("not_a_file");
    const find = String(args.find ?? "");
    const replace = String(args.replace ?? "");
    if (!find) fail("find_required");
    const original = readExact(target);
    const count = original.split(find).length - 1;
    if (count === 0) fail("find_not_present");
    if (count > 1 && !args.all) fail("find_not_unique");
    const updated = args.all ? original.split(find).join(replace) : original.replace(find, replace);
    writeExact(target, updated);
    return { path: relPath(target), replaced: args.all ? count : 1, before: Buffer.byteLength(original), after: Buffer.byteLength(updated) };
  },
});

registerTool({
  name: "patch.apply",
  description: "Apply several exact-string edits as one transaction. Every edit is checked first; one mismatch and no file is written.",
  schema: {
    type: "object",
    properties: {
      edits: {
        type: "array",
        items: { type: "object", properties: { path: { type: "string" }, find: { type: "string" }, replace: { type: "string" }, all: { type: "boolean" } }, required: ["path", "find", "replace"] },
      },
    },
    required: ["edits"],
  },
  danger: true,
  handler: (args) => {
    const edits = Array.isArray(args.edits) ? args.edits : [];
    if (!edits.length) fail("edits_required");
    if (edits.length > 20) fail("too_many_edits");
    const seen = new Set<string>();
    const prepared: Array<{ target: string; updated: string; before: number; after: number }> = [];
    for (const raw of edits) {
      if (!raw || typeof raw !== "object") fail("invalid_edit");
      const edit = raw as Record<string, unknown>;
      const target = safePath(edit.path);
      if (seen.has(target)) fail("duplicate_path");
      seen.add(target);
      if (!statSync(target).isFile()) fail("not_a_file");
      const find = String(edit.find ?? "");
      if (!find) fail("find_required");
      const original = readExact(target);
      const count = original.split(find).length - 1;
      if (count === 0) fail("find_not_present");
      if (count > 1 && !edit.all) fail("find_not_unique");
      const updated = edit.all ? original.split(find).join(String(edit.replace ?? "")) : original.replace(find, String(edit.replace ?? ""));
      prepared.push({ target, updated, before: Buffer.byteLength(original), after: Buffer.byteLength(updated) });
    }
    for (const row of prepared) writeExact(row.target, row.updated);
    return { applied: prepared.map((row) => ({ path: relPath(row.target), before: row.before, after: row.after })) };
  },
});

registerTool({
  name: "fs.mkdir",
  description: "Create a folder inside the workspace, including parents.",
  schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  danger: true,
  handler: (args) => { const target = safePath(args.path); mkdirSync(target, { recursive: true }); return { path: relPath(target) }; },
});

registerTool({
  name: "fs.remove",
  description: "Delete one file or folder inside the workspace.",
  schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  danger: true,
  handler: (args) => { const target = safePath(args.path); rmSync(target, { recursive: true, force: true }); return { path: relPath(target) }; },
});

registerTool({
  name: "fs.move",
  description: "Move or rename a file inside the workspace.",
  schema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] },
  danger: true,
  handler: (args) => {
    const from = safePath(args.from);
    const to = safePath(args.to);
    mkdirSync(resolve(to, ".."), { recursive: true });
    renameSync(from, to);
    return { from: relPath(from), to: relPath(to) };
  },
});

/** Walk the workspace once, skipping heavy folders. */
function walk(root: string, depth: number, out: string[], limit = 2000): void {
  if (out.length >= limit || depth < 0) return;
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (out.length >= limit) return;
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "release") continue;
    const full = join(root, entry.name);
    out.push(relPath(full) + (entry.isDirectory() ? "/" : ""));
    if (entry.isDirectory()) walk(full, depth - 1, out, limit);
  }
}

registerTool({
  name: "repo.tree",
  description: "List the workspace as indented paths, skipping node_modules, .git, dist and release.",
  schema: { type: "object", properties: { depth: { type: "number" } } },
  danger: false,
  handler: (args) => {
    const depth = Math.min(Math.max(Number(args.depth) || 3, 1), 8);
    const out: string[] = [];
    walk(resolve(toolRoot()), depth, out);
    return { entries: out, truncated: out.length >= 2000 };
  },
});

registerTool({
  name: "repo.search",
  description: "Find a literal string in the workspace and return file, line and the matching text.",
  schema: { type: "object", properties: { q: { type: "string" }, limit: { type: "number" } }, required: ["q"] },
  danger: false,
  handler: (args) => {
    const needle = String(args.q || "");
    if (!needle) fail("query_required");
    const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 500);
    const results: Array<{ rel: string; line: number; text: string }> = [];
    const files: string[] = [];
    walk(resolve(toolRoot()), 8, files, 4000);
    for (const rel of files) {
      if (rel.endsWith("/")) continue;
      if (results.length >= limit) break;
      const full = join(resolve(toolRoot()), rel);
      let text: string;
      try { if (statSync(full).size > 1_000_000) continue; text = readFileSync(full, "utf8"); } catch { continue; }
      if (!text.includes(needle)) continue;
      text.split(/\r?\n/).forEach((row, index) => {
        if (results.length < limit && row.includes(needle)) results.push({ rel, line: index + 1, text: row.trim().slice(0, 300) });
      });
    }
    return { results, count: results.length };
  },
});

registerTool({
  name: "repo.read",
  description: "Read a file by workspace-relative path (alias of fs.read, kept for compatibility).",
  schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  danger: false,
  handler: (args) => {
    const target = safePath(args.path);
    if (!statSync(target).isFile()) fail("not_a_file");
    const size = statSync(target).size;
    return { path: relPath(target), text: readFileSync(target).subarray(0, READ_LIMIT).toString("utf8"), truncated: size > READ_LIMIT, bytes: size };
  },
});

/** Run one tool; failures come back as a code instead of an exception. */
export async function callLocalTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const def = REGISTRY.get(name);
  if (!def) return { ok: false, error: "tool_not_found" };
  try {
    return { ok: true, result: await def.handler(args || {}) };
  } catch (error) {
    if (error instanceof ToolFailure) return { ok: false, error: error.code };
    return { ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 300) };
  }
}
