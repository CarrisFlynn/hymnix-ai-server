/**
 * A real language server, when one is installed.
 *
 * code.* scans text with regular expressions, which is why it cannot follow an
 * import or tell two same-named symbols apart. This module speaks LSP over stdio
 * to typescript-language-server instead, and returns a structured
 * LSP_UNAVAILABLE when nothing is installed rather than pretending a text scan
 * is a definition lookup.
 *
 * Nothing here ships a server: the binary is discovered, never bundled.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type LspQuery = {
  root: string;
  operation: "definition" | "references" | "symbols";
  file: string;
  line?: number;
  character?: number;
};

export type LspAnswer = {
  ok: boolean;
  operation?: string;
  server?: string;
  results?: Array<{ file: string; line: number; character: number }>;
  error?: string;
  hint?: string;
};

const DEFAULT_TIMEOUT = 12_000;

/** Where a TypeScript language server could live, most specific first. */
export function serverCandidates(root: string): string[] {
  const bin = process.platform === "win32" ? ".cmd" : "";
  return [
    process.env.HYMNIX_LSP_TYPESCRIPT || "",
    join(root, "node_modules", ".bin", "typescript-language-server" + bin),
    join(process.cwd(), "node_modules", ".bin", "typescript-language-server" + bin),
    join(root, "node_modules", "typescript-language-server", "lib", "cli.mjs"),
  ].filter(Boolean);
}

export function findServer(root: string): string | null {
  for (const candidate of serverCandidates(root)) {
    try { if (existsSync(candidate)) return candidate; } catch { /* unreadable path */ }
  }
  return null;
}

/** One JSON-RPC frame: a Content-Length header, a blank line, then the body. */
export function encodeFrame(payload: unknown): string {
  const body = JSON.stringify(payload);
  return "Content-Length: " + Buffer.byteLength(body, "utf8") + "\r\n\r\n" + body;
}

/** Pull complete messages out of a buffer, returning the rest for the next read. */
export function decodeFrames(buffer: string): { messages: unknown[]; rest: string } {
  const messages: unknown[] = [];
  let rest = buffer;
  for (;;) {
    const headerEnd = rest.indexOf("\r\n\r\n");
    if (headerEnd < 0) break;
    const header = rest.slice(0, headerEnd);
    const match = /content-length:\s*(\d+)/i.exec(header);
    if (!match) { rest = rest.slice(headerEnd + 4); continue; }
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (rest.length < start + length) break;
    const body = rest.slice(start, start + length);
    rest = rest.slice(start + length);
    try { messages.push(JSON.parse(body)); } catch { /* a frame we cannot read */ }
  }
  return { messages, rest };
}

const URI_SPLIT = /^file:\/\/([A-Za-z]:)?(.*)$/;

/** file:///C:/x/y.ts -> C:\x\y.ts (the escaping LSP uses is a plain decode). */
export function uriToPath(uri: string): string {
  const raw = String(uri || "");
  if (!raw.startsWith("file://")) return raw;
  const rest = decodeURIComponent(raw.slice(7));
  return process.platform === "win32" ? rest.replace(/^\//, "") : rest;
}

export function pathToUri(file: string): string {
  const normalized = resolve(file).replace(/\\/g, "/");
  return "file:///" + encodeURI(normalized).replace(/#/g, "%23").replace(/\?/g, "%3F");
}

/** Position from either an LSP Location or a LocationLink. */
function toResult(uri: string, position: { line?: number; character?: number } | undefined, root: string) {
  const file = uriToPath(uri);
  const relative = file.startsWith(root) ? file.slice(root.length).replace(/^[\\/]+/, "") : file;
  return { file: relative, line: (position?.line ?? 0) + 1, character: (position?.character ?? 0) + 1 };
}

/** Run one LSP request end to end; the process is always killed. */
export function runLspQuery(query: LspQuery, timeoutMs = DEFAULT_TIMEOUT): Promise<LspAnswer> {
  return new Promise((settle) => {
    const binary = findServer(query.root);
    if (!binary) {
      settle({ ok: false, error: "LSP_UNAVAILABLE", hint: "No typescript-language-server found. Install it with npm i -g typescript-language-server typescript, or set HYMNIX_LSP_TYPESCRIPT to the binary." });
      return;
    }
    const file = resolve(query.root, query.file);
    if (!existsSync(file)) { settle({ ok: false, error: "file_not_found" }); return; }
    // A bare .mjs is not executable on any platform; run it through node.
    const script = /\.(?:mjs|cjs|js)$/i.test(binary);
    const child = script
      ? spawn(process.execPath, [binary, "--stdio"], { cwd: query.root, windowsHide: true })
      : spawn(binary, ["--stdio"], { cwd: query.root, windowsHide: true, shell: process.platform === "win32" });
    let buffer = "";
    let settled = false;
    const finish = (answer: LspAnswer) => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* already gone */ }
      settle(answer);
    };
    const timer = setTimeout(() => finish({ ok: false, error: "lsp_timeout" }), timeoutMs);
    const send = (payload: unknown) => { try { child.stdin?.write(encodeFrame(payload)); } catch { /* stream closed */ } };
    child.once("error", () => { clearTimeout(timer); finish({ ok: false, error: "lsp_spawn_failed" }); });
    child.once("exit", () => { clearTimeout(timer); finish({ ok: false, error: "lsp_exited" }); });

    const requestedId = 2;
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const parsed = decodeFrames(buffer);
      buffer = parsed.rest;
      for (const message of parsed.messages) {
        const row = message as { id?: number; method?: string; result?: unknown };
        if (row.method === "window/workDoneProgress/create" || row.method === "client/registerCapability") {
          if (row.id !== undefined) send({ jsonrpc: "2.0", id: row.id, result: null });
          continue;
        }
        if (row.id === 1) { beginWork(); continue; }
        if (row.id !== requestedId) continue;
        clearTimeout(timer);
        const result = row.result;
        if (query.operation === "symbols") {
          const symbols = Array.isArray(result) ? result as Array<{ name?: string; selectionRange?: { start?: { line?: number; character?: number } } }> : [];
          finish({ ok: true, operation: "symbols", server: binary, results: symbols.slice(0, 200).map((item) => ({ file: query.file, line: (item.selectionRange?.start?.line ?? 0) + 1, character: (item.selectionRange?.start?.character ?? 0) + 1 })) });
          continue;
        }
        const raw = Array.isArray(result) ? result : (result ? [result] : []);
        const results = raw.flatMap((item: Record<string, unknown>) => {
          const target = (item.targetUri ? { uri: item.targetUri, range: item.targetSelectionRange } : { uri: item.uri, range: item.range }) as { uri?: string; range?: { start?: { line?: number; character?: number } } };
          return target.uri ? [toResult(target.uri, target.range?.start, query.root)] : [];
        });
        finish({ ok: true, operation: query.operation, server: binary, results: results.slice(0, 200) });
      }
    });

    // initialize first; everything else waits for its response.
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
      processId: process.pid,
      rootUri: pathToUri(query.root),
      capabilities: { textDocument: { definition: { linkSupport: true }, references: {}, documentSymbol: {} } },
      rootPath: query.root,
    } });

    const beginWork = () => {
      send({ jsonrpc: "2.0", method: "initialized", params: {} });
      send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: {
        uri: pathToUri(file),
        languageId: file.endsWith(".tsx") ? "typescriptreact" : file.endsWith(".ts") ? "typescript" : "javascript",
        version: 1,
        text: readFileSync(file, "utf8").slice(0, 400_000),
      } } });
      const position = { line: Math.max(0, (query.line ?? 1) - 1), character: Math.max(0, (query.character ?? 1) - 1) };
      if (query.operation === "symbols") {
        send({ jsonrpc: "2.0", id: requestedId, method: "textDocument/documentSymbol", params: { textDocument: { uri: pathToUri(file) } } });
      } else {
        send({ jsonrpc: "2.0", id: requestedId, method: "textDocument/" + query.operation, params: { textDocument: { uri: pathToUri(file) }, position, context: { includeDeclaration: true } } });
      }
    };
  });
}
