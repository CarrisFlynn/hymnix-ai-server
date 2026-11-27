/**
 * The command, terminal and network tools, in the main process.
 *
 * Same contract as the Python versions they replace, including the parts that
 * are easy to forget: a timed-out command is killed as a whole process tree,
 * console output is decoded with the console code page rather than assumed to
 * be UTF-8, and web.fetch refuses private destinations by resolving the host and
 * checking the address it would actually connect to.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { fail, registerTool, relPath, safePath, toolRoot } from "./agent-tools.ts";

/* ------------------------------------------------------------------ decoding */

/** Decode bytes the way this machine's console writes them (CP936 on a Chinese Windows). */
function decodeConsole(bytes: Buffer): string {
  if (!bytes.length) return "";
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try { return new TextDecoder("gbk").decode(bytes); } catch { return bytes.toString("utf8"); }
  }
}

/* ------------------------------------------------------------------ shell.run */

const OUTPUT_LIMIT = 64 * 1024;

/** Kill the whole tree: a build that spawned children must not survive the timeout. */
function killTree(pid: number): void {
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true, timeout: 10_000 });
    else process.kill(-pid, "SIGKILL");
  } catch { /* already gone */ }
}

registerTool({
  name: "shell.run",
  description: "Run one shell command inside the workspace. A timeout kills the whole process tree so nothing keeps running in the background.",
  schema: {
    type: "object",
    properties: { command: { type: "string" }, cwd: { type: "string" }, timeout_s: { type: "number" } },
    required: ["command"],
  },
  danger: true,
  handler: (args) => new Promise((settle, reject) => {
    const command = String(args.command ?? "").trim();
    if (!command) fail("command_required");
    if (command.length > 4000) fail("command_too_long");
    const cwd = safePath(args.cwd ?? ".");
    if (!statSync(cwd).isDirectory()) fail("not_a_directory");
    const seconds = Math.min(Math.max(Number(args.timeout_s) || 30, 1), 120);
    const started = Date.now();
    const shellExe = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "/bin/sh";
    const shellArgs = process.platform === "win32" ? ["/d", "/s", "/c", '"' + command + '"'] : ["-c", command];
    const child = spawn(shellExe, shellArgs, { cwd, windowsHide: true, windowsVerbatimArguments: process.platform === "win32", env: { ...process.env } });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let bytes = 0;
    const keep = (bucket: Buffer[]) => (chunk: Buffer) => {
      if (bytes < OUTPUT_LIMIT * 2) { bucket.push(chunk); bytes += chunk.length; }
    };
    child.stdout?.on("data", keep(out));
    child.stderr?.on("data", keep(err));
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid ?? 0); }, seconds * 1000);
    let done = false;
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const stdout = decodeConsole(Buffer.concat(out));
      const stderr = decodeConsole(Buffer.concat(err));
      settle({
        exit_code: code,
        timed_out: timedOut,
        stdout: stdout.slice(0, OUTPUT_LIMIT),
        stderr: stderr.slice(0, OUTPUT_LIMIT),
        truncated: stdout.length > OUTPUT_LIMIT || stderr.length > OUTPUT_LIMIT,
        duration_ms: Date.now() - started,
      });
    };
    child.once("error", (error: Error) => { done = true; clearTimeout(timer); reject(error); });
    child.once("exit", (code: number | null) => finish(code));
  }),
});

/* ------------------------------------------------------------------ terminals */

type LiveTerm = { id: string; child: ReturnType<typeof spawn>; buffer: string; cursor: number; startedAt: number };

const TERMS = new Map<string, LiveTerm>();
const TERM_MAX = 4;
const TERM_BUFFER = 200_000;

function termOf(id: unknown): LiveTerm {
  const session = TERMS.get(String(id ?? ""));
  if (!session) fail("no_session");
  return session;
}

registerTool({
  name: "term.start",
  description: "Start a persistent shell session that survives across tool calls. At most four at a time.",
  schema: { type: "object", properties: { cwd: { type: "string" }, shell: { type: "string" } } },
  danger: true,
  handler: (args) => {
    if (TERMS.size >= TERM_MAX) fail("too_many_sessions");
    const cwd = safePath(args.cwd ?? ".");
    if (!statSync(cwd).isDirectory()) fail("not_a_directory");
    const shell = String(args.shell ?? "").trim() || (process.platform === "win32" ? "cmd.exe" : "/bin/sh");
    const child = spawn(shell, [], { cwd, windowsHide: true, env: { ...process.env } });
    const id = Math.random().toString(36).slice(2, 10);
    const session: LiveTerm = { id, child, buffer: "", cursor: 0, startedAt: Date.now() };
    const push = (chunk: Buffer) => {
      session.buffer = (session.buffer + decodeConsole(chunk)).slice(-TERM_BUFFER);
      if (session.cursor > session.buffer.length) session.cursor = session.buffer.length;
    };
    child.stdout?.on("data", push);
    child.stderr?.on("data", push);
    child.once("exit", () => { TERMS.delete(id); });
    TERMS.set(id, session);
    return { id, cwd: relPath(cwd), shell };
  },
});

registerTool({
  name: "term.write",
  description: "Send text to a terminal session; a newline is appended unless enter is false.",
  schema: { type: "object", properties: { id: { type: "string" }, input: { type: "string" }, enter: { type: "boolean" } }, required: ["id", "input"] },
  danger: true,
  handler: (args) => {
    const session = termOf(args.id);
    const text = String(args.input ?? "");
    session.child.stdin?.write(args.enter === false ? text : text + "\r\n");
    return { ok: true, id: session.id, bytes: text.length };
  },
});

registerTool({
  name: "term.read",
  description: "Read what a terminal session printed since the last read.",
  schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  danger: false,
  handler: (args) => {
    const session = termOf(args.id);
    const text = session.buffer.slice(session.cursor);
    session.cursor = session.buffer.length;
    return { id: session.id, text: text.slice(0, OUTPUT_LIMIT), truncated: text.length > OUTPUT_LIMIT };
  },
});

registerTool({
  name: "term.list",
  description: "List the live terminal sessions.",
  schema: { type: "object", properties: {} },
  danger: false,
  handler: () => [...TERMS.values()].map((session) => ({ id: session.id, startedAt: session.startedAt, buffered: session.buffer.length })),
});

registerTool({
  name: "term.stop",
  description: "Close a terminal session and kill its shell.",
  schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  danger: true,
  handler: (args) => {
    const session = termOf(args.id);
    TERMS.delete(session.id);
    killTree(session.child.pid ?? 0);
    return { ok: true, id: session.id };
  },
});

/* ------------------------------------------------------------------ web.fetch */

const FETCH_LIMIT = 256 * 1024;

/** True for addresses that must never be reached from a tool: loopback, LAN, link-local, IPv6 local. */
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    return false;
  }
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
  return false;
}

/** Resolve and refuse private destinations, so a URL cannot be a path into this machine. */
async function assertPublicHost(hostname: string, port: number): Promise<void> {
  let rows: Array<{ address: string }>;
  try { rows = await lookup(hostname, { all: true }); } catch { fail("resolve_failed"); }
  if (!rows.length) fail("resolve_failed");
  for (const row of rows) if (isPrivateAddress(row.address)) fail("private_destination");
  void port;
}

registerTool({
  name: "web.fetch",
  description: "Fetch one http(s) URL and return its text (max 256 KB). Private and loopback destinations are refused.",
  schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  danger: false,
  handler: async (args) => {
    let current = String(args.url ?? "");
    const allow = String(process.env.HX_HTTP_ALLOW || "").split(",").map((row) => row.trim().toLowerCase()).filter(Boolean);
    for (let hop = 0; hop < 11; hop += 1) {
      let parsed: URL;
      try { parsed = new URL(current); } catch { fail("invalid_url"); }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") fail("invalid_url");
      if (allow.length && !allow.includes(parsed.hostname.toLowerCase())) fail("host_not_allowed");
      await assertPublicHost(parsed.hostname, parsed.port ? Number(parsed.port) : (parsed.protocol === "https:" ? 443 : 80));
      const response = await fetch(parsed.toString(), { redirect: "manual", signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Hymnix-Tool/1.0" } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) fail("redirect_invalid");
        if (hop >= 10) fail("too_many_redirects");
        current = new URL(location, parsed).toString();
        continue;
      }
      const body = Buffer.from(await response.arrayBuffer());
      const text = decodeConsole(body.subarray(0, FETCH_LIMIT));
      return { status: response.status, url: parsed.toString(), text, truncated: body.length > FETCH_LIMIT };
    }
    fail("too_many_redirects");
  },
});

export const toolDirectories = () => ({ root: toolRoot(), exists: existsSync(toolRoot()) });
