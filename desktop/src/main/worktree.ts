/**
 * Git worktrees, so an experiment can run beside the checkout instead of on it.
 *
 * Everything here shells out to git with an argument vector (never a shell
 * string), refuses anything that is not inside the repository, and reports the
 * real git message when a command fails rather than a generic error.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type WorktreeRow = { path: string; branch: string; head: string; bare: boolean; current: boolean };

const NAME = /^[a-z0-9][a-z0-9-]{1,40}$/;

function git(cwd: string, args: string[], timeoutMs = 20_000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((settle) => {
    execFile("git", args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      settle({ ok: !error, out: String(stdout || ""), err: String(stderr || (error ? error.message : "")) });
    });
  });
}

/** True when the folder is the top of a git work tree. */
export async function isRepo(root: string): Promise<boolean> {
  if (!root || !existsSync(root)) return false;
  const result = await git(root, ["rev-parse", "--is-inside-work-tree"]);
  return result.ok && result.out.trim() === "true";
}

/** Parse `git worktree list --porcelain` into rows. */
export function parseWorktrees(text: string): WorktreeRow[] {
  const rows: WorktreeRow[] = [];
  let current: WorktreeRow | null = null;
  for (const line of String(text || "").split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (current) rows.push(current);
      current = { path: line.slice(9).trim(), branch: "", head: "", bare: false, current: rows.length === 0 };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("HEAD ")) current.head = line.slice(5).trim().slice(0, 12);
    else if (line.startsWith("branch ")) current.branch = line.slice(7).trim().replace(/^refs\/heads\//, "");
    else if (line.trim() === "bare") current.bare = true;
    else if (line.trim() === "detached") current.branch = "(detached)";
  }
  if (current) rows.push(current);
  return rows;
}

export async function listWorktrees(root: string): Promise<{ ok: boolean; worktrees?: WorktreeRow[]; error?: string }> {
  if (!(await isRepo(root))) return { ok: false, error: "not_a_repository" };
  const result = await git(root, ["worktree", "list", "--porcelain"]);
  if (!result.ok) return { ok: false, error: (result.err || "git_failed").slice(0, 300) };
  return { ok: true, worktrees: parseWorktrees(result.out) };
}

/**
 * Create a sibling worktree on a new branch. The name becomes both the branch
 * and the folder, and is validated before it reaches git.
 */
export async function createWorktree(root: string, input: { name?: unknown; from?: unknown }): Promise<{ ok: boolean; path?: string; branch?: string; base?: string; error?: string }> {
  if (!(await isRepo(root))) return { ok: false, error: "not_a_repository" };
  const name = String(input.name || "").trim();
  if (!NAME.test(name)) return { ok: false, error: "invalid_name" };
  const from = String(input.from || "HEAD").trim() || "HEAD";
  if (!/^[A-Za-z0-9._\-/]{1,120}$/.test(from)) return { ok: false, error: "invalid_ref" };
  const target = join(dirname(resolve(root)), name);
  if (existsSync(target)) return { ok: false, error: "path_exists" };
  const base = await git(root, ["rev-parse", "--short", from]);
  if (!base.ok) return { ok: false, error: "unknown_ref" };
  const created = await git(root, ["worktree", "add", target, "-b", name, from], 60_000);
  if (!created.ok) return { ok: false, error: (created.err || "git_failed").slice(0, 300) };
  return { ok: true, path: target, branch: name, base: base.out.trim() };
}

export async function removeWorktree(root: string, input: { path?: unknown }): Promise<{ ok: boolean; error?: string }> {
  if (!(await isRepo(root))) return { ok: false, error: "not_a_repository" };
  const target = String(input.path || "").trim();
  if (!target || target.length > 400) return { ok: false, error: "invalid_path" };
  const listed = await listWorktrees(root);
  if (!listed.ok) return { ok: false, error: listed.error };
  const known = (listed.worktrees || []).find((row) => resolve(row.path) === resolve(target));
  if (!known) return { ok: false, error: "not_a_worktree" };
  if (known.current) return { ok: false, error: "refuses_main_checkout" };
  const removed = await git(root, ["worktree", "remove", known.path], 60_000);
  if (!removed.ok) return { ok: false, error: (removed.err || "git_failed").slice(0, 300) };
  return { ok: true };
}
