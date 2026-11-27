/**
 * run_code: a program that can call the app's tools.
 *
 * The program never runs inside the renderer. A separate Node process executes it
 * with no DOM and no app objects; the only thing it can reach is a `tools.call`
 * bridge that hands each call back to the renderer, so an inner fs.write still
 * goes through the normal approval queue instead of slipping past it.
 *
 * The program text itself is approved before anything spawns, exactly like
 * shell.run: it is Node, so it could read files on its own.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type RunCall = { name: string; args: unknown };

export type RunOutcome = {
  ok: boolean;
  value?: unknown;
  logs?: string[];
  calls?: string[];
  error?: string;
  durationMs?: number;
};

/** The bootstrap. Kept as a string so no build step has to ship a second entry. */
const RUNNER = [
  "import { createInterface } from \"node:readline\";",
  "const pending = new Map();",
  "let seq = 0;",
  "const rl = createInterface({ input: process.stdin });",
  "rl.on(\"line\", (line) => { try { const msg = JSON.parse(line); const settle = pending.get(msg.id); if (settle) { pending.delete(msg.id); settle(msg); } } catch { } });",
  "globalThis.tools = {",
  "  call(name, args) {",
  "    const id = ++seq;",
  "    process.stdout.write(JSON.stringify({ type: \"call\", id, name, args }) + \"\\n\");",
  "    return new Promise((resolve, reject) => pending.set(id, (msg) => msg.error ? reject(new Error(String(msg.error))) : resolve(msg.result)));",
  "  },",
  "};"
  ,"const say = (line) => process.stdout.write(JSON.stringify(line) + \"\\n\");",
  "for (const level of [\"log\", \"info\", \"warn\", \"error\"]) { console[level] = (...parts) => { say({ type: \"log\", level, text: parts.map((p) => typeof p === \"string\" ? p : JSON.stringify(p)).join(\" \") }); }; }",
  "try { const mod = await import(\"./program.mjs\"); say({ type: \"done\", value: mod.default === undefined ? null : mod.default }); }",
  "catch (error) { say({ type: \"error\", error: String((error && error.message) || error) }); }",
] as const;

const MAX_CODE = 20_000;

/**
 * Run one program. `onCall` must resolve with the tool result or throw; the
 * returned `calls` records what the program asked for, in order.
 */
export function runProgram(input: {
  code: string;
  cwd: string;
  timeoutMs?: number;
  onCall: (call: RunCall) => Promise<unknown>;
}): Promise<RunOutcome> {
  const code = String(input.code || "");
  if (!code.trim()) return Promise.resolve({ ok: false, error: "code_required" });
  if (code.length > MAX_CODE) return Promise.resolve({ ok: false, error: "code_too_large" });
  const timeoutMs = Math.min(Math.max(Number(input.timeoutMs) || 20_000, 1_000), 120_000);
  const started = Date.now();
  const dir = mkdtempSync(join(tmpdir(), "hymnix-runcode-"));
  const cleanup = () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* already gone */ } };
  writeFileSync(join(dir, "runner.mjs"), RUNNER.join("\n"), "utf8");
  writeFileSync(join(dir, "program.mjs"), code, "utf8");

  return new Promise<RunOutcome>((settle) => {
    const logs: string[] = [];
    const calls: string[] = [];
    let buffer = "";
    let settled = false;
    const child = spawn(process.execPath, [join(dir, "runner.mjs")], {
      cwd: input.cwd,
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    const finish = (outcome: RunOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* already gone */ }
      cleanup();
      settle({ ...outcome, logs: logs.slice(-200), calls: calls.slice(-200), durationMs: Date.now() - started });
    };
    const timer = setTimeout(() => finish({ ok: false, error: "run_timeout" }), timeoutMs);
    child.once("error", (error: Error) => finish({ ok: false, error: String(error.message || error) }));
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        const cut = buffer.indexOf("\n");
        if (cut < 0) break;
        const line = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 1);
        if (!line.trim()) continue;
        let message: { type?: string; id?: number; name?: string; args?: unknown; text?: string; value?: unknown; error?: string };
        try { message = JSON.parse(line); } catch { logs.push(line.slice(0, 2000)); continue; }
        if (message.type === "log") { logs.push(String(message.text || "").slice(0, 2000)); continue; }
        if (message.type === "call" && message.name) {
          const name = String(message.name);
          const id = Number(message.id) || 0;
          calls.push(name);
          void input.onCall({ name, args: message.args }).then(
            (result) => { try { child.stdin?.write(JSON.stringify({ id, result }) + "\n"); } catch { /* closed */ } },
            (error: unknown) => { try { child.stdin?.write(JSON.stringify({ id, error: String(error instanceof Error ? error.message : error) }) + "\n"); } catch { /* closed */ } },
          );
          continue;
        }
        if (message.type === "done") { finish({ ok: true, value: message.value ?? null }); continue; }
        if (message.type === "error") { finish({ ok: false, error: String(message.error || "run_failed") }); continue; }
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => { const text = chunk.toString("utf8").trim(); if (text) logs.push(text.slice(0, 2000)); });
    child.once("exit", (code: number | null) => { if (!settled) finish({ ok: false, error: code === 0 ? "run_no_result" : "run_exited_" + String(code) }); });
  });
}
