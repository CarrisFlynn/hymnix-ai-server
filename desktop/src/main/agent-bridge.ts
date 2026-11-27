/**
 * The bridge between the terminal agent and this process.
 *
 * The agent CLI runs in the user's terminal and could have been a second copy of
 * the whole app. It is not: it holds no tools and no provider logic, it just talks
 * to this loopback server, which owns both. That keeps one implementation of the
 * tools, one sandbox root and one place where a dangerous call is decided.
 *
 * Security: bound to 127.0.0.1, a fresh random token per app run, compared in
 * constant time, and the token only ever reaches the child through its env.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { callLocalTool, isDangerousTool, listToolDefs } from "./agent-tools.ts";
import { listProviderModels, streamProvider, type ProviderKind } from "./providers.ts";
import type { GatewayMessage } from "../shared/protocol.ts";

export type AgentModel = {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  agentId?: string;
};

type Deps = {
  /** Local Ollama address, so the CLI can use models without the gateway. */
  ollamaBase: () => string;
  /** Configured cloud providers, when the gateway is reachable. */
  cloudProviders: () => Promise<AgentModel[]>;
  /** Tools the CLI may call, with the flag that decides whether it must ask first. */
  tools: () => Array<{ name: string; description: string; schema: unknown; danger: boolean }>;
};

let server: ReturnType<typeof createServer> | null = null;
let token = "";
let port = 0;

export function agentBridgeAddress(): { port: number; token: string } {
  return { port, token };
}

function sameToken(got: string): boolean {
  const a = Buffer.from(got || "");
  const b = Buffer.from(token || "x");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 2 * 1024 * 1024) throw new Error("body_too_large");
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>; } catch { return {}; }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

/** All models the terminal can choose from: local first, then configured cloud providers. */
async function collectModels(deps: Deps): Promise<AgentModel[]> {
  const models: AgentModel[] = [];
  try {
    const base = deps.ollamaBase();
    const tags = await fetch(base.replace(/\/$/, "") + "/api/tags", { signal: AbortSignal.timeout(2500) }).then((r) => r.json()) as { models?: Array<{ name?: string }> };
    for (const row of tags.models || []) {
      const name = String(row.name || "").trim();
      if (!name) continue;
      models.push({ id: "local:" + name, label: name + " (local)", kind: "ollama", baseUrl: base, apiKey: "", model: name });
    }
  } catch { /* Ollama may be off; the cloud entries still work */ }
  try {
    for (const row of await deps.cloudProviders()) models.push(row);
  } catch { /* the gateway is optional */ }
  return models;
}

export function startAgentBridge(deps: Deps): Promise<{ port: number; token: string }> {
  if (server) return Promise.resolve(agentBridgeAddress());
  token = randomBytes(24).toString("hex");
  server = createServer((req, res) => { void handle(req, res, deps); });
  return new Promise((settle, reject) => {
    server!.once("error", reject);
    server!.listen(0, "127.0.0.1", () => {
      port = (server!.address() as { port: number }).port;
      settle(agentBridgeAddress());
    });
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, deps: Deps): Promise<void> {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (!sameToken(String(req.headers["x-agent-token"] || ""))) { json(res, 401, { ok: false, error: "bad_token" }); return; }

  if (url.pathname === "/state" && req.method === "GET") {
    const models = await collectModels(deps);
    json(res, 200, { ok: true, cwd: process.cwd(), models, tools: deps.tools() });
    return;
  }

  if (url.pathname === "/tool" && req.method === "POST") {
    const body = await readBody(req);
    const name = String(body.name || "");
    const args = body.args && typeof body.args === "object" ? body.args as Record<string, unknown> : {};
    json(res, 200, await callLocalTool(name, args));
    return;
  }

  if (url.pathname === "/models" && req.method === "POST") {
    const body = await readBody(req);
    const model = String(body.id || "");
    const picked = (await collectModels(deps)).find((row) => row.id === model);
    if (!picked) { json(res, 404, { ok: false, error: "unknown_model" }); return; }
    try {
      const names = await listProviderModels({ kind: picked.kind, baseUrl: picked.baseUrl, apiKey: picked.apiKey, model: picked.model, agentId: picked.agentId || "", reasoningEffort: "", maxTokens: 0 }, AbortSignal.timeout(6000));
      json(res, 200, { ok: true, models: names });
    } catch (error) {
      json(res, 200, { ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 200) });
    }
    return;
  }

  if (url.pathname === "/chat" && req.method === "POST") {
    const body = await readBody(req);
    const modelId = String(body.modelId || "");
    const picked = (await collectModels(deps)).find((row) => row.id === modelId);
    if (!picked) { json(res, 404, { ok: false, error: "unknown_model" }); return; }
    const messages = Array.isArray(body.messages) ? body.messages as GatewayMessage[] : [];
    const tools = Array.isArray(body.tools) ? body.tools : undefined;
    res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" });
    const controller = new AbortController();
    req.once("close", () => controller.abort());
    try {
      await streamProvider(
        { kind: picked.kind, baseUrl: picked.baseUrl, apiKey: picked.apiKey, model: picked.model, agentId: picked.agentId || "", reasoningEffort: "", maxTokens: 0, tools },
        messages,
        controller.signal,
        (delta) => {
          const row = delta as { choices?: Array<{ delta?: { content?: string; reasoning_content?: string; tool_calls?: unknown } }> };
          const choice = row.choices?.[0]?.delta;
          if (!choice) return;
          res.write(JSON.stringify({ type: "delta", content: choice.content || "", reasoning: choice.reasoning_content || "", tool_calls: choice.tool_calls || null }) + "\n");
        },
      );
      res.write(JSON.stringify({ type: "done" }) + "\n");
    } catch (error) {
      res.write(JSON.stringify({ type: "error", error: String(error instanceof Error ? error.message : error).slice(0, 400) }) + "\n");
    }
    res.end();
    return;
  }

  json(res, 404, { ok: false, error: "not_found" });
}

export function stopAgentBridge(): void {
  try { server?.close(); } catch { /* already closed */ }
  server = null;
  token = "";
  port = 0;
}
