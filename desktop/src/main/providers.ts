/**
 * providers.ts — one chat contract, three wire formats.
 *
 * Hymnix used to speak a single upstream dialect: OpenAI Chat Completions. That
 * covers DeepSeek, Moonshot, OpenRouter and any compatible proxy, but it leaves
 * out two ecosystems people actually point at:
 *
 *   anthropic  the Messages API (`POST /v1/messages`) that Claude Code and the
 *              Anthropic SDKs speak: `x-api-key`, `anthropic-version`, content
 *              blocks laid out as an array, and a different SSE event grammar.
 *   openclaw   an OpenClaw gateway, which looks OpenAI-shaped on the surface but
 *              treats the `model` field as an *agent target* (`openclaw/<agent>`)
 *              rather than a provider model id.
 *
 * Everything below normalises to the same internal delta the renderer already
 * understands (`choices[0].delta.content` / `reasoning_content`), so the UI and
 * the chat pipeline need no protocol awareness. Keep this module free of relative
 * imports: `tests/providers.test.mjs` loads it directly through Node's type
 * stripping.
 */
import type { ChatDelta, ChatToolCallDelta, GatewayMessage } from "../shared/protocol";

export type ProviderKind = "ollama" | "openai" | "anthropic" | "openclaw";

export type ProviderConfig = {
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** OpenClaw only: the gateway agent to route to (`main`, `research`, ...). */
  agentId: string;
  /** OpenAI-compatible only: passed through as `reasoning_effort`. */
  reasoningEffort: string;
  /** Anthropic requires max_tokens; 0 means "use the built-in default". */
  maxTokens: number;
  /** OpenAI-compatible dialects: function definitions the model may call. */
  tools?: unknown[];
};

export type ProviderProbe = {
  ok: boolean;
  kind: ProviderKind;
  latencyMs: number;
  models: string[];
  /** Empty when ok; a human sentence when not. */
  message: string;
};

export const PROVIDER_KINDS: ProviderKind[] = ["ollama", "openai", "anthropic", "openclaw"];

/** Anthropic's docs default; also what Claude Code asks for on short turns. */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 8192;

export const PROVIDER_DEFAULTS: Record<ProviderKind, { label: string; baseUrl: string; model: string; hint: string }> = {
  ollama: {
    label: "Ollama (native)",
    baseUrl: "http://127.0.0.1:11434",
    model: "qwen3:8b",
    hint: "The daemon's own POST /api/chat: tool calls arrive structured, and no API key is needed.",
  },
  openai: {
    label: "OpenAI compatible",
    baseUrl: "https://api.openai.com",
    model: "gpt-4o-mini",
    hint: "Any endpoint that serves POST /v1/chat/completions: OpenAI, DeepSeek, Moonshot, OpenRouter, Ollama's OpenAI shim.",
  },
  anthropic: {
    label: "Anthropic (Claude Code)",
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-5",
    hint: "Speaks POST /v1/messages with anthropic-version, the same protocol Claude Code uses. A local claude-code-router works too.",
  },
  openclaw: {
    label: "OpenClaw",
    baseUrl: "http://127.0.0.1:18789",
    model: "openclaw/default",
    hint: "OpenClaw gateway. The model field is an agent target (openclaw/<agent>); enable gateway.http.endpoints.chatCompletions first.",
  },
};

export function normalizeKind(value: unknown): ProviderKind {
  const text = String(value ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (text === "anthropic" || text === "claude" || text === "claude-code" || text === "claudeai") return "anthropic";
  if (text === "openclaw" || text === "open-claw" || text === "claw") return "openclaw";
  if (text === "ollama" || text === "local" || text === "ollama-local" || text === "daemon") return "ollama";
  return "openai";
}

/**
 * Guess the dialect from an address, so a pasted local or vendor URL works
 * without the user understanding the difference first.
 */
export function detectKind(baseUrl: string, fallback: ProviderKind = "openai"): ProviderKind {
  const value = String(baseUrl ?? "").toLowerCase();
  if (/:11434\b/.test(value) || /\/api\/(chat|tags|generate|ps)\b/.test(value)) return "ollama";
  if (/anthropic\.com|claude/.test(value)) return "anthropic";
  if (/openclaw|:18789\b/.test(value)) return "openclaw";
  return fallback;
}

export function providerConfig(input: Partial<ProviderConfig> | null | undefined): ProviderConfig {
  const raw = input ?? {};
  const kind = normalizeKind(raw.kind);
  const preset = PROVIDER_DEFAULTS[kind];
  const baseUrl = String(raw.baseUrl ?? "").trim() || preset.baseUrl;
  const agentId = String(raw.agentId ?? "").trim();
  const typedModel = String(raw.model ?? "").trim();
  // OpenClaw addresses an agent, not a model, so an empty field still has to
  // resolve to something sendable — and the agent id outranks the default.
  const model = kind === "openclaw"
    ? openClawModel({ model: typedModel, agentId })
    : typedModel || preset.model;
  const maxTokens = Number(raw.maxTokens);
  return {
    kind,
    baseUrl,
    apiKey: String(raw.apiKey ?? "").trim(),
    model,
    agentId,
    reasoningEffort: String(raw.reasoningEffort ?? "").trim(),
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? Math.min(200000, Math.round(maxTokens)) : 0,
    ...(Array.isArray(raw.tools) && raw.tools.length ? { tools: raw.tools } : {}),
  };
}

// ---------------------------------------------------------------- endpoints

function stripBase(base: string): string {
  return String(base ?? "").trim().replace(/\/+$/, "");
}

/**
 * Join a base URL and a path without duplicating an API version segment.
 * `/v1`, `/v1beta/openai`, `/api/v1` and a full endpoint all have to survive.
 */
function withVersionSuffix(base: string, suffix: string, forceVersion: boolean): string {
  const root = stripBase(base);
  if (!root) throw new Error(JSON.stringify({ code: "base_url_missing", message: "Enter a provider address first" }));
  if (root.endsWith(suffix)) return root;
  if (/\/v\d+(?:[a-z]+)?(?:\/[^/]+)*$/.test(root)) return root + suffix;
  return root + (forceVersion ? "/v1" : "") + suffix;
}

export function chatEndpoint(base: string): string {
  return withVersionSuffix(base, "/chat/completions", true);
}

export function modelsEndpoint(base: string): string {
  return withVersionSuffix(base, "/models", true);
}

export function messagesEndpoint(base: string): string {
  return withVersionSuffix(base, "/messages", true);
}

/** Native Ollama endpoint: the address is its own root, not an OpenAI /v1. */
export function ollamaEndpoint(base: string, path: string): string {
  const root = stripBase(base).replace(/\/v1$/, "");
  if (!root) throw new Error(JSON.stringify({ code: "base_url_missing", message: "Enter a provider address first" }));
  return root + path;
}

// ------------------------------------------------------------------- errors

async function readFailure(response: Response, fallback: string): Promise<Error> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    try {
      const text = (await response.text()).trim();
      payload = text ? { error: { message: text.slice(0, 300) } } : null;
    } catch {
      payload = null;
    }
  }
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const nested = root.error && typeof root.error === "object" ? (root.error as Record<string, unknown>) : root;
  const message = typeof nested.message === "string" && nested.message ? nested.message : fallback;
  const code = typeof nested.code === "string" ? nested.code : typeof nested.type === "string" ? nested.type : undefined;
  return new Error(JSON.stringify({ status: response.status, code, message }));
}

function authHeaders(config: ProviderConfig, mode: "bearer" | "anthropic"): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
    "Content-Type": "application/json",
  };
  if (!config.apiKey) return headers;
  if (mode === "anthropic") {
    // Anthropic accepts either header; gateways that only understand one of them
    // still get a usable request. The SDK sends both when both are configured.
    headers["x-api-key"] = config.apiKey;
    headers.Authorization = "Bearer " + config.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers.Authorization = "Bearer " + config.apiKey;
  }
  return headers;
}

// ---------------------------------------------------------------------- SSE

type JsonSink = (payload: Record<string, unknown>) => void;

function parseEventJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "[DONE]") return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    throw new Error(JSON.stringify({ code: "invalid_sse_json", message: "The provider returned malformed event JSON" }));
  }
}

/**
 * Read an SSE body (or a plain JSON body when the provider ignored `stream`).
 * Every `data:` payload is handed over parsed, so callers only deal with objects.
 */
export async function consumeStream(response: Response, sink: JsonSink): Promise<void> {
  const type = (response.headers.get("content-type") || "").toLowerCase();
  if (!type.includes("text/event-stream")) {
    const payload = await response.json().catch(() => null);
    if (payload && typeof payload === "object") sink(payload as Record<string, unknown>);
    return;
  }
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];
  const dispatch = () => {
    if (!dataLines.length) return;
    const payload = parseEventJson(dataLines.join("\n"));
    dataLines = [];
    if (payload) sink(payload);
  };
  const feed = (line: string) => {
    if (line === "") {
      dispatch();
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    // `event:` is documentation for us — Anthropic repeats the name inside the
    // payload as `type`, and the OpenAI shape has no event name at all.
    if (field === "data") dataLines.push(value);
  };
  try {
    for (;;) {
      const part = await reader.read();
      buffer += decoder.decode(part.value || new Uint8Array(), { stream: !part.done });
      const lines = buffer.split(/\r\n|\n|\r/);
      buffer = lines.pop() ?? "";
      for (const line of lines) feed(line);
      if (part.done) {
        if (buffer) feed(buffer);
        dispatch();
        break;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal): Promise<Response> {
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
  if (!response.ok) throw await readFailure(response, "Provider returned HTTP " + response.status);
  return response;
}

async function getJson(url: string, headers: Record<string, string>, signal: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(url, { method: "GET", headers: { Accept: "application/json", ...headers }, signal });
  if (!response.ok) throw await readFailure(response, "Provider returned HTTP " + response.status);
  const payload = await response.json().catch(() => null);
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
}

// ------------------------------------------------------------------ OpenAI

function safeParseArgs(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return {};
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}

/** Ollama wants tool-call arguments as objects and tool results as plain messages. */
export function toOllamaMessages(messages: GatewayMessage[]): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (const message of messages ?? []) {
    if (!message) continue;
    if (message.role === "assistant" && message.tool_calls?.length) {
      rows.push({
        role: "assistant",
        content: message.content || "",
        tool_calls: message.tool_calls.map((call) => ({ function: { name: call.function.name, arguments: safeParseArgs(call.function.arguments) } })),
      });
      continue;
    }
    if (message.role === "tool") {
      const row: Record<string, unknown> = { role: "tool", content: message.content ?? "" };
      if (message.name) row.tool_name = message.name;
      rows.push(row);
      continue;
    }
    const row: Record<string, unknown> = { role: message.role, content: message.content ?? "" };
    if (message.images?.length) row.images = message.images.map((image) => image.data);
    rows.push(row);
  }
  return rows;
}

/** OpenAI / OpenClaw tool schema is passed through untouched. */
export function toOpenAiTools(tools: unknown): unknown[] | undefined {
  return Array.isArray(tools) && tools.length ? tools : undefined;
}

/** Anthropic declares the schema under input_schema. */
export function toAnthropicTools(tools: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(tools) || !tools.length) return undefined;
  return tools.map((tool) => {
    const fn = (tool as { function?: { name?: unknown; description?: unknown; parameters?: unknown } }).function ?? {};
    return {
      name: String(fn.name ?? ""),
      description: String(fn.description ?? ""),
      input_schema: (fn.parameters as Record<string, unknown>) ?? { type: "object", properties: {} },
    };
  }).filter((tool) => tool.name);
}

/**
 * OpenAI-shaped history → Anthropic turns, including tool_use and tool_result
 * blocks so the Messages API can actually run a tool loop.
 */
export function toAnthropicChat(messages: GatewayMessage[]): { system: string; messages: Array<{ role: "user" | "assistant"; content: unknown }> } {
  const system: string[] = [];
  const turns: Array<{ role: "user" | "assistant"; content: unknown }> = [];
  const push = (role: "user" | "assistant", block: unknown) => {
    const last = turns[turns.length - 1];
    if (last && last.role === role) {
      if (Array.isArray(last.content)) last.content.push(block);
      else last.content = [{ type: "text", text: last.content }, block];
      return;
    }
    turns.push({ role, content: Array.isArray(block) ? block : [block] });
  };
  for (const message of messages ?? []) {
    if (!message) continue;
    if (message.role === "system") { if (message.content) system.push(message.content); continue; }
    if (message.role === "tool") {
      push("user", { type: "tool_result", tool_use_id: message.tool_call_id ?? "", content: message.content ?? "" });
      continue;
    }
    if (message.role === "assistant") {
      if (message.tool_calls?.length) {
        for (const call of message.tool_calls) {
          push("assistant", { type: "tool_use", id: call.id, name: call.function.name, input: safeParseArgs(call.function.arguments) });
        }
      }
      if (message.content) push("assistant", { type: "text", text: message.content });
      continue;
    }
    if (message.content) push("user", { type: "text", text: message.content });
    for (const image of message.images ?? []) {
      push("user", { type: "image", source: { type: "base64", media_type: image.mime, data: image.data } });
    }
  }
  // The API requires alternating turns and a user first.
  const flattened = turns.map((turn) => ({
    role: turn.role,
    content: Array.isArray(turn.content) && turn.content.length === 1 && (turn.content[0] as { type?: string }).type === "text"
      ? String((turn.content[0] as { text?: string }).text ?? "")
      : turn.content,
  }));
  if (!flattened.length) flattened.push({ role: "user", content: "(continue)" });
  if (flattened[0].role === "assistant") flattened.unshift({ role: "user", content: "(continue)" });
  return { system: system.join("\n\n"), messages: flattened };
}

/** Native Ollama chat: NDJSON frames, tool calls delivered whole. */
async function streamOllama(config: ProviderConfig, messages: GatewayMessage[], tools: unknown, signal: AbortSignal, emit: (delta: ChatDelta) => void): Promise<void> {
  const body: Record<string, unknown> = { model: config.model, messages: toOllamaMessages(messages), stream: true };
  const specs = toOpenAiTools(tools);
  if (specs) body.tools = specs;
  const response = await postJson(ollamaEndpoint(config.baseUrl, "/api/chat"), { "Content-Type": "application/json", Accept: "application/x-ndjson" }, body, signal);
  if (!response.body) throw new Error(JSON.stringify({ status: response.status, message: "Ollama response has no body" }));
  // Frames arrive one JSON object per line. Handle each as it lands: a thinking
  // model can spend half a minute before the first token, and buffering the whole
  // reply made the app look frozen.
  let sawCall = false;
  const handle = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let frame: Record<string, unknown>;
    try { frame = JSON.parse(trimmed) as Record<string, unknown>; } catch { return; }
    if (typeof frame.error === "string") throw new Error(JSON.stringify({ status: 502, code: "ollama_error", message: frame.error }));
    const message = (frame.message ?? {}) as Record<string, unknown>;
    const content = typeof message.content === "string" ? message.content : "";
    const thinking = typeof message.thinking === "string" ? message.thinking : "";
    if (content || thinking) {
      emit({ choices: [{ delta: { ...(content ? { content } : {}), ...(thinking ? { reasoning_content: thinking } : {}) } }] });
    }
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (calls.length) {
      sawCall = true;
      emit({ choices: [{ delta: { tool_calls: calls.map((call, index) => ({
        index,
        id: "ollama_" + index + "_" + Math.random().toString(36).slice(2, 8),
        type: "function",
        function: {
          name: String((call as { function?: { name?: unknown } }).function?.name ?? ""),
          arguments: JSON.stringify((call as { function?: { arguments?: unknown } }).function?.arguments ?? {}),
        },
      })) } }] });
    }
    if (frame.done === true) {
      emit({ choices: [{ finish_reason: sawCall ? "tool_calls" : "stop", delta: {} }] });
    }
  };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      buffer += decoder.decode(part.value ?? new Uint8Array(), { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) handle(line);
    }
    buffer += decoder.decode();
    if (buffer.trim()) handle(buffer);
  } finally {
    try { await reader.cancel(); } catch { /* already released */ }
    reader.releaseLock();
  }
}

/**
 * OpenAI-safe history. Text-only turns stay strings; a turn that carries
 * images becomes the content-part array the Chat Completions API expects.
 */
export function toOpenAiMessages(messages: GatewayMessage[]): Array<Record<string, unknown>> {
  return (messages ?? []).flatMap((message) => {
    if (!message) return [];
    const images = message.images ?? [];
    const row: Record<string, unknown> = { role: message.role };
    if (images.length) {
      row.content = [
        { type: "text", text: message.content ?? "" },
        ...images.map((image) => ({ type: "image_url", image_url: { url: "data:" + image.mime + ";base64," + image.data } })),
      ];
    } else {
      row.content = message.content ?? "";
    }
    if (message.tool_calls?.length) row.tool_calls = message.tool_calls;
    if (message.tool_call_id) row.tool_call_id = message.tool_call_id;
    if (message.name) row.name = message.name;
    return [row];
  });
}

async function streamOpenai(config: ProviderConfig, messages: GatewayMessage[], tools: unknown, signal: AbortSignal, emit: (delta: ChatDelta) => void): Promise<void> {
  const body: Record<string, unknown> = { model: config.model, messages: toOpenAiMessages(messages), stream: true };
  if (config.reasoningEffort) body.reasoning_effort = config.reasoningEffort;
  if (config.maxTokens > 0) body.max_tokens = config.maxTokens;
  // Tools go out verbatim; the model answers with tool_calls deltas, which the
  // renderer assembles into one call per index.
  const specs = toOpenAiTools(tools);
  if (specs) body.tools = specs;
  const response = await postJson(chatEndpoint(config.baseUrl), authHeaders(config, "bearer"), body, signal);
  await consumeStream(response, (payload) => {
    const choices = Array.isArray(payload.choices) ? (payload.choices as Array<Record<string, unknown>>) : [];
    const first = choices[0] ?? {};
    const rawDelta = (first.delta ?? first.message ?? {}) as Record<string, unknown>;
    const content = typeof rawDelta.content === "string" ? rawDelta.content : "";
    const reasoning = typeof rawDelta.reasoning_content === "string"
      ? rawDelta.reasoning_content
      : typeof rawDelta.reasoning === "string" ? rawDelta.reasoning : "";
    const toolCalls = Array.isArray(rawDelta.tool_calls) ? rawDelta.tool_calls as ChatToolCallDelta[] : undefined;
    const finishReason = typeof first.finish_reason === "string" ? first.finish_reason : undefined;
    if (!content && !reasoning && !toolCalls && !finishReason) return;
    emit({ choices: [{
      ...(finishReason ? { finish_reason: finishReason } : {}),
      delta: {
        ...(content ? { content } : {}),
        ...(reasoning ? { reasoning_content: reasoning } : {}),
        ...(toolCalls ? { tool_calls: toolCalls } : {}),
      },
    }] });
  });
}

// --------------------------------------------------------------- Anthropic

type AnthropicBlock = { type: "text"; text: string };
export type AnthropicRequest = {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
};

function flattenContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const block = item as Record<string, unknown>;
          if (typeof block.text === "string") return block.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/**
 * OpenAI-shaped history → Anthropic messages. Two rules the API enforces:
 * system prompts travel in a top-level field, and the turns must alternate,
 * so consecutive same-role messages get merged instead of rejected.
 */
export function toAnthropicMessages(messages: GatewayMessage[] | Array<{ role: string; content: unknown }>): AnthropicRequest {
  const system: string[] = [];
  const turns: AnthropicRequest["messages"] = [];
  for (const raw of messages ?? []) {
    const role = String((raw as { role?: unknown }).role ?? "user");
    const text = flattenContent((raw as { content?: unknown }).content);
    if (role === "system" || role === "developer") {
      if (text) system.push(text);
      continue;
    }
    if (!text) continue;
    const next: "user" | "assistant" = role === "assistant" ? "assistant" : "user";
    const last = turns[turns.length - 1];
    if (last && last.role === next) last.content = last.content ? last.content + "\n\n" + text : text;
    else turns.push({ role: next, content: text });
  }
  if (!turns.length) turns.push({ role: "user", content: "(continue)" });
  if (turns[0].role === "assistant") turns.unshift({ role: "user", content: "(continue)" });
  return { system: system.join("\n\n"), messages: turns };
}

async function streamAnthropic(config: ProviderConfig, messages: GatewayMessage[], tools: unknown, signal: AbortSignal, emit: (delta: ChatDelta) => void): Promise<void> {
  const request = toAnthropicChat(messages);
  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: config.maxTokens > 0 ? config.maxTokens : ANTHROPIC_DEFAULT_MAX_TOKENS,
    messages: request.messages,
    stream: true,
  };
  if (request.system) body.system = request.system;
  const specs = toAnthropicTools(tools);
  if (specs) body.tools = specs;
  const response = await postJson(messagesEndpoint(config.baseUrl), authHeaders(config, "anthropic"), body, signal);
  await consumeStream(response, (payload) => {
    const type = typeof payload.type === "string" ? payload.type : "";
    if (type === "error") {
      const detail = (payload.error ?? {}) as Record<string, unknown>;
      throw new Error(JSON.stringify({
        status: 502,
        code: typeof detail.type === "string" ? detail.type : "provider_error",
        message: typeof detail.message === "string" ? detail.message : "The Anthropic endpoint reported an error",
      }));
    }
    if (type === "content_block_start") {
      const block = (payload.content_block ?? {}) as Record<string, unknown>;
      if (block.type === "tool_use") {
        emit({ choices: [{ delta: { tool_calls: [{
          index: typeof payload.index === "number" ? payload.index : 0,
          id: typeof block.id === "string" ? block.id : "tool_" + Math.random().toString(36).slice(2, 8),
          type: "function",
          function: { name: typeof block.name === "string" ? block.name : "", arguments: "" },
        }] } }] });
      }
      return;
    }
    if (type === "content_block_delta") {
      const delta = (payload.delta ?? {}) as Record<string, unknown>;
      const kind = typeof delta.type === "string" ? delta.type : "";
      if (kind === "input_json_delta" && typeof delta.partial_json === "string") {
        emit({ choices: [{ delta: { tool_calls: [{
          index: typeof payload.index === "number" ? payload.index : 0,
          function: { arguments: delta.partial_json },
        }] } }] });
        return;
      }
      if (kind === "text_delta" && typeof delta.text === "string" && delta.text) {
        emit({ choices: [{ delta: { content: delta.text } }] });
      } else if (kind === "thinking_delta" && typeof delta.thinking === "string" && delta.thinking) {
        emit({ choices: [{ delta: { reasoning_content: delta.thinking } }] });
      }
      return;
    }
    // A provider that ignored `stream: true` answers with a whole message object.
    if ((type === "message" || !type) && Array.isArray(payload.content)) {
      const text = (payload.content as unknown[])
        .map((block) => (block && typeof block === "object" ? flattenContent([block]) : ""))
        .filter(Boolean)
        .join("");
      if (text) emit({ choices: [{ delta: { content: text } }] });
    }
  });
}

// ---------------------------------------------------------------- OpenClaw

/** OpenClaw treats `model` as an agent target, so a bare name becomes `openclaw/<name>`. */
export function openClawModel(config: Pick<ProviderConfig, "model" | "agentId">): string {
  const model = String(config.model ?? "").trim();
  const agent = String(config.agentId ?? "").trim();
  if (/^agent:/.test(model) || /^openclaw(:|\/)/.test(model)) return model;
  if (agent && (!model || model === "openclaw")) return "openclaw/" + agent;
  if (!model || model === "openclaw") return "openclaw/default";
  if (agent) return "openclaw/" + agent;
  return "openclaw/" + model.replace(/^\/+/, "");
}

function openClawHeaders(config: ProviderConfig): Record<string, string> {
  const headers = authHeaders(config, "bearer");
  if (config.agentId) headers["x-openclaw-agent-id"] = config.agentId;
  return headers;
}

async function streamOpenClaw(config: ProviderConfig, messages: GatewayMessage[], tools: unknown, signal: AbortSignal, emit: (delta: ChatDelta) => void): Promise<void> {
  const body: Record<string, unknown> = { model: openClawModel(config), messages, stream: true };
  const specs = toOpenAiTools(tools);
  if (specs) body.tools = specs;
  const response = await postJson(chatEndpoint(config.baseUrl), openClawHeaders(config), body, signal);
  await consumeStream(response, (payload) => {
    const choices = Array.isArray(payload.choices) ? (payload.choices as Array<Record<string, unknown>>) : [];
    const first = choices[0] ?? {};
    const rawDelta = (first.delta ?? first.message ?? {}) as Record<string, unknown>;
    const content = typeof rawDelta.content === "string" ? rawDelta.content : "";
    const reasoning = typeof rawDelta.reasoning_content === "string" ? rawDelta.reasoning_content : "";
    const toolCalls = Array.isArray(rawDelta.tool_calls) ? rawDelta.tool_calls as ChatToolCallDelta[] : undefined;
    const finishReason = typeof first.finish_reason === "string" ? first.finish_reason : undefined;
    if (!content && !reasoning && !toolCalls && !finishReason) return;
    emit({ choices: [{
      ...(finishReason ? { finish_reason: finishReason } : {}),
      delta: {
        ...(content ? { content } : {}),
        ...(reasoning ? { reasoning_content: reasoning } : {}),
        ...(toolCalls ? { tool_calls: toolCalls } : {}),
      },
    }] });
  });
}

// -------------------------------------------------------------- entry points

export async function streamProvider(
  input: Partial<ProviderConfig>,
  messages: GatewayMessage[],
  signal: AbortSignal,
  emit: (delta: ChatDelta) => void,
  tools?: unknown,
): Promise<void> {
  const config = providerConfig(input);
  if (config.kind === "ollama") return streamOllama(config, messages, tools, signal, emit);
  if (config.kind === "anthropic") return streamAnthropic(config, messages, tools, signal, emit);
  if (config.kind === "openclaw") return streamOpenClaw(config, messages, tools, signal, emit);
  return streamOpenai(config, messages, tools, signal, emit);
}

/** Model ids the provider advertises. Throws when the endpoint denies or lacks one. */
export async function listProviderModels(input: Partial<ProviderConfig>, signal: AbortSignal): Promise<string[]> {
  const config = providerConfig(input);
  if (config.kind === "ollama") {
    const payload = await getJson(ollamaEndpoint(config.baseUrl, "/api/tags"), { Accept: "application/json" }, signal);
    const rows = Array.isArray(payload.models) ? (payload.models as Array<Record<string, unknown>>) : [];
    return rows.map((row) => (typeof row.name === "string" ? row.name : typeof row.model === "string" ? row.model : "")).filter(Boolean);
  }
  const url = config.kind === "anthropic" ? modelsEndpoint(config.baseUrl) + "?limit=100" : modelsEndpoint(config.baseUrl);
  const payload = await getJson(url, authHeaders(config, config.kind === "anthropic" ? "anthropic" : "bearer"), signal);
  const rows = Array.isArray(payload.data) ? (payload.data as Array<Record<string, unknown>>) : [];
  const ids = rows.map((row) => (typeof row.id === "string" ? row.id : typeof row.name === "string" ? row.name : "")).filter(Boolean);
  return ids;
}

/**
 * Prove the address, key and model are usable before a chat turn fails halfway.
 * Model listing is the cheap check; when a proxy hides it we fall back to a
 * one-token turn, which is what the Claude Code docs recommend as a smoke test.
 */
export async function probeProvider(input: Partial<ProviderConfig>, signal: AbortSignal): Promise<ProviderProbe> {
  const config = providerConfig(input);
  const started = Date.now();
  const elapsed = () => Math.round(Date.now() - started);
  try {
    const models = await listProviderModels(config, signal);
    return { ok: true, kind: config.kind, latencyMs: elapsed(), models, message: "" };
  } catch (first) {
    if (config.kind === "openclaw") {
      const message = readableError(first);
      return {
        ok: false,
        kind: config.kind,
        latencyMs: elapsed(),
        models: [],
        message: /404|not\s*found|disabled/i.test(message)
          ? "OpenClaw 的 OpenAI 兼容端点没有开启：在 config 里设置 gateway.http.endpoints.chatCompletions.enabled = true 后重启网关。"
          : message,
      };
    }
    try {
      const token = config.maxTokens > 0 ? Math.min(config.maxTokens, 16) : 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const relay = () => controller.abort();
      signal.addEventListener("abort", relay, { once: true });
      try {
        if (config.kind === "anthropic") {
          await postJson(messagesEndpoint(config.baseUrl), authHeaders(config, "anthropic"), {
            model: config.model,
            max_tokens: token,
            messages: [{ role: "user", content: "." }],
          }, controller.signal);
        } else {
          await postJson(chatEndpoint(config.baseUrl), authHeaders(config, "bearer"), {
            model: config.model,
            messages: [{ role: "user", content: "." }],
            max_tokens: token,
          }, controller.signal);
        }
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", relay);
      }
      return { ok: true, kind: config.kind, latencyMs: elapsed(), models: [config.model], message: "" };
    } catch {
      return { ok: false, kind: config.kind, latencyMs: elapsed(), models: [], message: readableError(first) };
    }
  }
}

/** Turn an error thrown above back into a sentence for the settings page. */
export function readableError(reason: unknown): string {
  const raw = reason instanceof Error ? reason.message : String(reason);
  try {
    const parsed = JSON.parse(raw) as { status?: number; code?: string; message?: string };
    if (parsed && typeof parsed === "object") {
      const status = typeof parsed.status === "number" ? parsed.status : undefined;
      if (status === 401 || status === 403) return "认证失败（HTTP " + status + "）：密钥无效或没有这个模型的权限。";
      if (status === 404) return "地址或模型不存在（HTTP 404）：检查 base URL 是否带 /v1，以及模型名是否拼错。";
      if (status === 429) return "请求过于频繁（HTTP 429）：稍后重试或检查配额。";
      if (typeof parsed.message === "string" && parsed.message) return parsed.message;
    }
  } catch {
    /* not our JSON shape */
  }
  if (/abort/i.test(raw)) return "请求超时或被取消。";
  if (/fetch failed|ENOTFOUND|ECONNREFUSED/i.test(raw)) return "连不上这个地址：确认服务已启动、端口正确，且没有被防火墙拦截。";
  return raw.slice(0, 300);
}