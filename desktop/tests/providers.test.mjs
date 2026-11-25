import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";
import {
  chatEndpoint,
  listProviderModels,
  messagesEndpoint,
  modelsEndpoint,
  normalizeKind,
  openClawModel,
  probeProvider,
  providerConfig,
  readableError,
  streamProvider,
  toAnthropicMessages,
} from "../src/main/providers.ts";

/** Small HTTP server that records the last request and replies with a scripted body. */
function recorder(reply) {
  const seen = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const record = { method: request.method, url: request.url, headers: request.headers, body: body ? JSON.parse(body) : null };
      seen.push(record);
      reply(record, response);
    });
  });
  return { server, seen };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve("http://127.0.0.1:" + server.address().port)));
}

function sse(response, events, extraHeaders = {}) {
  response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", ...extraHeaders });
  for (const event of events) response.write(event);
  response.end();
}

function collect() {
  const parts = [];
  return { parts, emit: (delta) => { const slot = delta.choices?.[0]?.delta ?? {}; if (slot.content) parts.push(["text", slot.content]); if (slot.reasoning_content) parts.push(["think", slot.reasoning_content]); } };
}

describe("url builders", () => {
  it("adds one version segment and no more", () => {
    assert.equal(chatEndpoint("https://api.openai.com"), "https://api.openai.com/v1/chat/completions");
    assert.equal(chatEndpoint("https://api.deepseek.com/v1"), "https://api.deepseek.com/v1/chat/completions");
    assert.equal(chatEndpoint("https://openrouter.ai/api/v1/"), "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(chatEndpoint("http://127.0.0.1:18789"), "http://127.0.0.1:18789/v1/chat/completions");
    // Gemini's OpenAI shim already carries a version path and must not get a second one.
    assert.equal(chatEndpoint("https://generativelanguage.googleapis.com/v1beta/openai"), "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    assert.equal(chatEndpoint("https://proxy.example.com/v1/chat/completions"), "https://proxy.example.com/v1/chat/completions");
  });

  it("targets the Messages API for Anthropic", () => {
    assert.equal(messagesEndpoint("https://api.anthropic.com"), "https://api.anthropic.com/v1/messages");
    assert.equal(messagesEndpoint("https://api.anthropic.com/v1"), "https://api.anthropic.com/v1/messages");
    assert.equal(messagesEndpoint("http://127.0.0.1:3456/"), "http://127.0.0.1:3456/v1/messages");
    assert.equal(messagesEndpoint("https://gw.example.com/v1/messages"), "https://gw.example.com/v1/messages");
    assert.equal(modelsEndpoint("https://api.anthropic.com/v1"), "https://api.anthropic.com/v1/models");
  });

  it("refuses an empty address instead of guessing one", () => {
    assert.throws(() => chatEndpoint("   "), /base_url_missing/);
  });
});

describe("provider selection", () => {
  it("accepts the spellings the three ecosystems use", () => {
    assert.equal(normalizeKind("Claude Code"), "anthropic");
    assert.equal(normalizeKind("claude_code"), "anthropic");
    assert.equal(normalizeKind("ANTHROPIC"), "anthropic");
    assert.equal(normalizeKind("Open Claw"), "openclaw");
    assert.equal(normalizeKind("openclaw"), "openclaw");
    assert.equal(normalizeKind("openai"), "openai");
    assert.equal(normalizeKind(undefined), "openai");
    assert.equal(normalizeKind("something-else"), "openai");
  });

  it("fills defaults per protocol and clamps max tokens", () => {
    const anthropic = providerConfig({ kind: "anthropic" });
    assert.equal(anthropic.baseUrl, "https://api.anthropic.com");
    assert.equal(anthropic.model, "claude-sonnet-4-5");
    assert.equal(providerConfig({ kind: "openclaw" }).baseUrl, "http://127.0.0.1:18789");
    assert.equal(providerConfig({ kind: "openai", maxTokens: 999999 }).maxTokens, 200000);
    assert.equal(providerConfig({ kind: "openai", maxTokens: -4 }).maxTokens, 0);
  });
});

describe("Anthropic message translation", () => {
  it("lifts system prompts out of the turn list", () => {
    const result = toAnthropicMessages([
      { role: "system", content: "You are terse." },
      { role: "system", content: "Answer in Chinese." },
      { role: "user", content: "hi" },
    ]);
    assert.equal(result.system, "You are terse.\n\nAnswer in Chinese.");
    assert.deepEqual(result.messages, [{ role: "user", content: "hi" }]);
  });

  it("merges consecutive turns because the API rejects same-role pairs", () => {
    const result = toAnthropicMessages([
      { role: "user", content: "a" },
      { role: "user", content: "b" },
      { role: "assistant", content: "c" },
      { role: "assistant", content: "d" },
      { role: "user", content: "e" },
    ]);
    assert.deepEqual(result.messages, [
      { role: "user", content: "a\n\nb" },
      { role: "assistant", content: "c\n\nd" },
      { role: "user", content: "e" },
    ]);
  });

  it("always opens with a user turn and never sends an empty list", () => {
    assert.equal(toAnthropicMessages([]).messages[0].role, "user");
    const odd = toAnthropicMessages([{ role: "assistant", content: "ready" }]);
    assert.equal(odd.messages[0].role, "user");
    assert.equal(odd.messages[1].role, "assistant");
  });

  it("flattens block content and drops empty turns", () => {
    const result = toAnthropicMessages([
      { role: "user", content: [{ type: "text", text: "first" }, { type: "image" }] },
      { role: "assistant", content: "" },
    ]);
    assert.deepEqual(result.messages, [{ role: "user", content: "first" }]);
  });
});

describe("OpenClaw agent routing", () => {
  it("turns a bare model name into an agent target", () => {
    assert.equal(openClawModel({ model: "", agentId: "" }), "openclaw/default");
    assert.equal(openClawModel({ model: "openclaw", agentId: "" }), "openclaw/default");
    assert.equal(openClawModel({ model: "research", agentId: "" }), "openclaw/research");
    assert.equal(openClawModel({ model: "", agentId: "main" }), "openclaw/main");
    assert.equal(openClawModel({ model: "openclaw/beta", agentId: "main" }), "openclaw/beta");
    assert.equal(openClawModel({ model: "agent:main", agentId: "" }), "agent:main");
  });
});

describe("streaming against each dialect", () => {
  const servers = [];
  const urls = {};

  before(async () => {
    const openai = recorder((_record, response) => sse(response, [
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    const anthropic = recorder((_record, response) => sse(response, [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":9}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: ping\ndata: {"type":"ping"}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"plan"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Bon"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"jour"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]));
    const openclaw = recorder((_record, response) => sse(response, [
      'data: {"choices":[{"delta":{"content":"claw"}}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    servers.push(openai.server, anthropic.server, openclaw.server);
    urls.openai = await listen(openai.server);
    urls.anthropic = await listen(anthropic.server);
    urls.openclaw = await listen(openclaw.server);
    servers.recorders = { openai, anthropic, openclaw };
  });

  after(() => { for (const server of servers) server.close(); });

  it("reads Chat Completions deltas, including reasoning traces", async () => {
    const sink = collect();
    await streamProvider(
      { kind: "openai", baseUrl: urls.openai, apiKey: "sk-test", model: "gpt-4o-mini", reasoningEffort: "low" },
      [{ role: "user", content: "hi" }],
      new AbortController().signal,
      sink.emit,
    );
    assert.deepEqual(sink.parts, [["think", "thinking"], ["text", "Hel"], ["text", "lo"]]);
    const request = servers.recorders.openai.seen.at(-1);
    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(request.headers.authorization, "Bearer sk-test");
    assert.equal(request.body.reasoning_effort, "low");
    assert.equal(request.body.stream, true);
  });

  it("reads Messages events and maps thinking to reasoning", async () => {
    const sink = collect();
    await streamProvider(
      { kind: "anthropic", baseUrl: urls.anthropic, apiKey: "sk-ant-test", model: "claude-sonnet-4-5", maxTokens: 64 },
      [{ role: "system", content: "be brief" }, { role: "user", content: "hi" }],
      new AbortController().signal,
      sink.emit,
    );
    assert.deepEqual(sink.parts, [["think", "plan"], ["text", "Bon"], ["text", "jour"]]);
    const request = servers.recorders.anthropic.seen.at(-1);
    assert.equal(request.url, "/v1/messages");
    assert.equal(request.headers["anthropic-version"], "2023-06-01");
    assert.equal(request.headers["x-api-key"], "sk-ant-test");
    assert.equal(request.body.max_tokens, 64);
    assert.equal(request.body.system, "be brief");
    assert.deepEqual(request.body.messages, [{ role: "user", content: "hi" }]);
  });

  it("routes OpenClaw through an agent target and sends the agent header", async () => {
    const sink = collect();
    await streamProvider(
      { kind: "openclaw", baseUrl: urls.openclaw, apiKey: "claw-token", model: "", agentId: "main" },
      [{ role: "user", content: "hi" }],
      new AbortController().signal,
      sink.emit,
    );
    assert.deepEqual(sink.parts, [["text", "claw"]]);
    const request = servers.recorders.openclaw.seen.at(-1);
    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(request.body.model, "openclaw/main");
    assert.equal(request.headers["x-openclaw-agent-id"], "main");
    assert.equal(request.headers.authorization, "Bearer claw-token");
  });
});

describe("failures stay explainable", () => {
  const servers = [];
  const urls = {};

  before(async () => {
    const denied = recorder((_record, response) => {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }));
    });
    const broken = recorder((_record, response) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "upstream exploded" } }));
    });
    const models = recorder((_record, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "claude-sonnet-4-5" }, { id: "claude-haiku-4-5" }] }));
    });
    const noModels = recorder((_record, response) => {
      if (request_url_ends_with_models(_record)) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "not found" } }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "msg_1", type: "message", content: [{ type: "text", text: "ok" }] }));
    });
    servers.push(denied.server, broken.server, models.server, noModels.server);
    urls.denied = await listen(denied.server);
    urls.broken = await listen(broken.server);
    urls.models = await listen(models.server);
    urls.noModels = await listen(noModels.server);
    servers.recorders = { denied, broken, models, noModels };
  });

  function request_url_ends_with_models(record) {
    return String(record.url || "").includes("/models");
  }

  after(() => { for (const server of servers) server.close(); });

  it("carries status and provider message through the error", async () => {
    await assert.rejects(
      () => streamProvider({ kind: "anthropic", baseUrl: urls.denied, apiKey: "bad", model: "claude-sonnet-4-5" }, [{ role: "user", content: "hi" }], new AbortController().signal, () => undefined),
      (error) => {
        const parsed = JSON.parse(error.message);
        assert.equal(parsed.status, 401);
        assert.equal(parsed.code, "authentication_error");
        assert.equal(parsed.message, "invalid x-api-key");
        assert.match(readableError(error), /认证失败/);
        return true;
      },
    );
  });

  it("keeps the plain upstream message for a 500", async () => {
    await assert.rejects(
      () => streamProvider({ kind: "openai", baseUrl: urls.broken, apiKey: "k", model: "m" }, [{ role: "user", content: "hi" }], new AbortController().signal, () => undefined),
      (error) => JSON.parse(error.message).message === "upstream exploded",
    );
  });

  it("lists models and probes latency", async () => {
    const models = await listProviderModels({ kind: "anthropic", baseUrl: urls.models, apiKey: "k", model: "x" }, new AbortController().signal);
    assert.deepEqual(models, ["claude-sonnet-4-5", "claude-haiku-4-5"]);
    const probe = await probeProvider({ kind: "anthropic", baseUrl: urls.models, apiKey: "k", model: "x" }, new AbortController().signal);
    assert.equal(probe.ok, true);
    assert.deepEqual(probe.models, ["claude-sonnet-4-5", "claude-haiku-4-5"]);
  });

  it("falls back to a one-token turn when a proxy hides /models", async () => {
    const probe = await probeProvider({ kind: "anthropic", baseUrl: urls.noModels, apiKey: "k", model: "claude-sonnet-4-5" }, new AbortController().signal);
    assert.equal(probe.ok, true);
    assert.deepEqual(probe.models, ["claude-sonnet-4-5"]);
  });

  it("turns a missing OpenClaw endpoint into an actionable sentence", async () => {
    const probe = await probeProvider({ kind: "openclaw", baseUrl: urls.noModels, apiKey: "", model: "openclaw/default" }, new AbortController().signal);
    assert.equal(probe.ok, false);
    assert.match(probe.message, /chatCompletions\.enabled/);
  });

  it("explains a closed port instead of leaking a stack trace", () => {
    assert.match(readableError(new Error("fetch failed")), /连不上这个地址/);
    assert.match(readableError(JSON.parse('{"status":404,"message":"nope"}') && JSON.stringify({ status: 404, message: "nope" })), /404/);
  });
});
