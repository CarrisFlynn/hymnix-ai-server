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

/** IPv4 in the ranges that must never be reached from a tool. */
function ipv4IsPrivate(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

/** Expand an IPv6 address into its eight 16-bit groups. */
function groupsOf(address: string): number[] | null {
  let bare = address.split("%")[0];
  // An embedded IPv4 tail (::ffff:93.184.216.34) is written in decimal, so it is
  // folded into the two hex groups it stands for before parsing.
  const dotted = bare.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const octets = dotted[2].split(".").map(Number);
    if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    bare = dotted[1] + (((octets[0] << 8) | octets[1]).toString(16)) + ":" + (((octets[2] << 8) | octets[3]).toString(16));
  }
  if (!bare.includes(":")) return null;
  const halves = bare.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part ? part.split(":").filter((p) => p.length) : []);
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const rows = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (rows.length !== 8) return null;
  const out: number[] = [];
  for (const row of rows) {
    const value = parseInt(row, 16);
    if (!Number.isFinite(value) || value < 0 || value > 0xffff) return null;
    out.push(value);
  }
  return out;
}

/**
 * True for addresses that must never be reached from a tool.
 *
 * An IPv4-mapped address such as ::ffff:127.0.0.1 is still loopback: the earlier
 * version only looked at a few IPv6 prefixes and let it through, which is how a
 * tool call could reach a local service. Mapped and NAT64 forms are unwrapped and
 * judged as the IPv4 address they actually are.
 */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return ipv4IsPrivate(address);
  if (family !== 6) return true;
  const groups = groupsOf(address);
  if (!groups) return true;
  const allZero = groups.slice(0, 7).every((g) => g === 0);
  if (allZero && groups[7] <= 1) return true;
  if ((groups[0] & 0xfe00) === 0xfc00) return true;
  if ((groups[0] & 0xffc0) === 0xfe80) return true;
  if ((groups[0] & 0xff00) === 0xff00) return true;
  // ::ffff:a.b.c.d and ::ffff:0:a.b.c.d, the IPv4-mapped forms.
  const mapped = groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff;
  if (mapped) return ipv4IsPrivate([(groups[6] >> 8) & 0xff, groups[6] & 0xff, (groups[7] >> 8) & 0xff, groups[7] & 0xff].join("."));
  // 64:ff9b::/96, the NAT64 prefix, carries an IPv4 address too.
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0) {
    return ipv4IsPrivate([(groups[6] >> 8) & 0xff, groups[6] & 0xff, (groups[7] >> 8) & 0xff, groups[7] & 0xff].join("."));
  }
  return false;
}

/** One request, connected to an address that was already checked. */
function requestPinned(url: URL, address: string): Promise<{ status: number; location: string; body: Buffer }> {
  const secure = url.protocol === "https:";
  const port = url.port ? Number(url.port) : (secure ? 443 : 80);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(address) === 6 ? 6 : 4;
  const module = secure ? require("node:https") : require("node:http");
  return new Promise((settle, reject) => {
    const request = module.request({
      // The connection goes to the checked address, never through a second lookup,
      // so a hostile DNS answer cannot turn a public name into a private target.
      host: address,
      family,
      port,
      path: url.pathname + url.search,
      method: "GET",
      servername: secure ? hostname : undefined,
      headers: { Host: url.host, "User-Agent": "Hymnix-Tool/1.0", Accept: "*/*" },
      timeout: 8000,
    }, (response: { statusCode?: number; headers: Record<string, string | undefined>; on: Function; resume: Function }) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        if (size >= FETCH_LIMIT) return;
        size += chunk.length;
        chunks.push(chunk);
      });
      response.on("end", () => settle({ status: Number(response.statusCode || 0), location: String(response.headers.location || ""), body: Buffer.concat(chunks) }));
    });
    request.on("timeout", () => { request.destroy(new Error("timeout")); });
    request.on("error", reject);
    request.end();
  });
}

/** Resolve, refuse private destinations, then connect to the address that was checked. */
async function checkedRequest(url: URL): Promise<{ status: number; location: string; body: Buffer }> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) fail("private_destination");
    return await requestPinned(url, hostname);
  }
  let rows: Array<{ address: string }>;
  try { rows = await lookup(hostname, { all: true }); } catch { fail("resolve_failed"); }
  if (!rows.length) fail("resolve_failed");
  for (const row of rows) if (isPrivateAddress(row.address)) fail("private_destination");
  return await requestPinned(url, rows[0].address);
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
      const response = await checkedRequest(parsed);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (!response.location) fail("redirect_invalid");
        if (hop >= 10) fail("too_many_redirects");
        current = new URL(response.location, parsed).toString();
        continue;
      }
      const text = decodeConsole(response.body.subarray(0, FETCH_LIMIT));
      return { status: response.status, url: parsed.toString(), text, truncated: response.body.length > FETCH_LIMIT };
    }
    fail("too_many_redirects");
  },
});

export const toolDirectories = () => ({ root: toolRoot(), exists: existsSync(toolRoot()) });
