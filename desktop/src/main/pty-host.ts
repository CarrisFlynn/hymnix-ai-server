/**
 * Real pseudo-terminals for the terminal page.
 *
 * The old terminal ran one command through cmd.exe with pipes: no cursor, no
 * alternate screen, no raw keys. That cannot host an interactive agent like
 * Claude Code, which is an Ink TUI and needs a PTY. node-pty 1.1 ships prebuilt
 * win32-x64 binaries (ConPTY), so nothing has to be compiled at install time.
 *
 * Everything here lives in the main process on purpose: the terminal must work
 * with the Python gateway stopped and with the network unplugged.
 */
import { spawn as spawnPty, type IPty } from "node-pty";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** One launchable program the terminal can host. */
export type TerminalProfile = {
  id: string;
  label: string;
  /** argv[0] and its arguments, already split. */
  argv: string[];
  /** True when the binary was found on this machine. */
  available: boolean;
  detail: string;
};

type LiveSession = {
  id: string;
  term: IPty;
  profile: string;
  cwd: string;
  startedAt: number;
};

const sessions = new Map<string, LiveSession>();

/** Path to the built-in agent CLI, set by the app at startup. */
let agentCliPath = "";

export function configureAgentCli(path: string): void {
  agentCliPath = path;
}

/** The Node binary the CLI needs; the app itself ships Electron, not Node. */
export function findNode(): string | null {
  return which("node");
}
const MAX_SESSIONS = 8;

/** Resolve a command name the way a shell would, without running one. */
function which(name: string): string | null {
  if (!name) return null;
  if (existsSync(name)) return name;
  try {
    const out = execFileSync(process.platform === "win32" ? "where.exe" : "which", [name], { encoding: "utf8", windowsHide: true, timeout: 4000 });
    const first = String(out).split(/\r?\n/).map((row) => row.trim()).filter(Boolean)[0];
    return first && existsSync(first) ? first : null;
  } catch {
    return null;
  }
}

/**
 * The programs the picker offers. Each one is discovered, never assumed: a
 * profile whose binary is missing is listed as unavailable with the install hint,
 * instead of failing when the user clicks it.
 */
export function detectProfiles(): TerminalProfile[] {
  const shellExe = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "/bin/sh";
  const pwsh = which("pwsh") || which("powershell");
  const claude = which("claude") || which("claude.cmd");
  const codex = which("codex");
  const gemini = which("gemini");
  const ollama = which("ollama");
  const gitBash = which("bash");
  const rows: TerminalProfile[] = [
    {
      id: "agent",
      label: "Hymnix Agent",
      argv: ["agent"],
      available: Boolean(findNode() && agentCliPath && existsSync(agentCliPath)),
      detail: findNode()
        ? "Our own agent: local, cloud or shared models, with the app\u2019s tools."
        : "Needs Node.js on PATH (install node, then reopen this profile).",
    },
    {
      id: "command",
      label: "Command",
      argv: [shellExe],
      available: true,
      detail: "The original line-by-line console.",
    },
    {
      id: "pwsh",
      label: "PowerShell",
      argv: pwsh ? [pwsh, "-NoLogo"] : [shellExe],
      available: Boolean(pwsh),
      detail: pwsh ? "Interactive PowerShell." : "PowerShell was not found; cmd.exe is used instead.",
    },
    {
      id: "claude",
      label: "Claude Code",
      argv: claude ? [claude] : ["claude"],
      available: Boolean(claude),
      detail: claude ? "Anthropic Claude Code." : "Install with: npm i -g @anthropic-ai/claude-code",
    },
    {
      id: "codex",
      label: "Codex CLI",
      argv: codex ? [codex] : ["codex"],
      available: Boolean(codex),
      detail: codex ? "OpenAI Codex CLI." : "Install with: npm i -g @openai/codex",
    },
    {
      id: "gemini",
      label: "Gemini CLI",
      argv: gemini ? [gemini] : ["gemini"],
      available: Boolean(gemini),
      detail: gemini ? "Google Gemini CLI." : "Install with: npm i -g @google/gemini-cli",
    },
    {
      id: "ollama",
      label: "Ollama shell",
      argv: ollama ? [ollama, "run", "qwen3:8b"] : ["ollama"],
      available: Boolean(ollama),
      detail: ollama ? "An Ollama model in a chat shell." : "Install Ollama first.",
    },
    {
      id: "bash",
      label: "Git Bash",
      argv: gitBash ? [gitBash, "-i", "-l"] : ["bash"],
      available: Boolean(gitBash),
      detail: gitBash ? "POSIX shell from Git for Windows." : "Not installed.",
    },
  ];
  return rows;
}

export type OpenResult = { ok: boolean; id?: string; pid?: number; error?: string };

/** Start one PTY. The caller supplies the id so the renderer can route data. */
export function openSession(input: {
  id: string;
  profile: string;
  cwd: string;
  cols: number;
  rows: number;
  env?: Record<string, string>;
  /** Replace the profile's argv (used by the built-in agent, which needs a script path). */
  argv?: string[];
}): OpenResult {
  if (sessions.size >= MAX_SESSIONS) return { ok: false, error: "too_many_sessions" };
  const profiles = detectProfiles();
  const profile = profiles.find((row) => row.id === input.profile);
  if (!profile) return { ok: false, error: "unknown_profile" };
  if (!profile.available) return { ok: false, error: "profile_unavailable", };
  const cols = Math.min(Math.max(Math.floor(input.cols) || 80, 20), 500);
  const rows = Math.min(Math.max(Math.floor(input.rows) || 24, 5), 200);
  const argv = input.argv && input.argv.length ? input.argv : profile.argv;
  try {
    const term = spawnPty(argv[0], argv.slice(1), {
      name: "xterm-256color",
      cols,
      rows,
      cwd: input.cwd,
      env: { ...process.env, ...(input.env || {}), TERM: "xterm-256color" } as Record<string, string>,
    });
    sessions.set(input.id, { id: input.id, term, profile: profile.id, cwd: input.cwd, startedAt: Date.now() });
    return { ok: true, id: input.id, pid: term.pid };
  } catch (error) {
    return { ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 300) + " argv=" + JSON.stringify(argv) };
  }
}

export function sessionOf(id: string): LiveSession | undefined {
  return sessions.get(id);
}

export function listSessions(): Array<{ id: string; profile: string; cwd: string; startedAt: number }> {
  return [...sessions.values()].map(({ id, profile, cwd, startedAt }) => ({ id, profile, cwd, startedAt }));
}

/**
 * Close one session. node-pty's console-list helper can throw after the shell is
 * already gone; that is noise from the helper, not a failure of the session.
 */
export function closeSession(id: string): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  sessions.delete(id);
  try { session.term.kill(); } catch { /* the shell already exited */ }
  return true;
}

export function closeAllSessions(): void {
  for (const id of [...sessions.keys()]) closeSession(id);
}

export function writeSession(id: string, data: string): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  try { session.term.write(String(data)); return true; } catch { return false; }
}

export function resizeSession(id: string, cols: number, rows: number): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  const c = Math.min(Math.max(Math.floor(cols) || 80, 20), 500);
  const r = Math.min(Math.max(Math.floor(rows) || 24, 5), 200);
  try { session.term.resize(c, r); return true; } catch { return false; }
}

/** Where a new session starts: the workspace, else the user's home. */
export function defaultCwd(workspace: string | null): string {
  if (workspace && existsSync(workspace)) return workspace;
  try { return homedir(); } catch { return process.cwd(); }
}

export const terminalSessionsPath = () => join(homedir());
