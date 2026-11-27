import { test } from "node:test";
import assert from "node:assert/strict";
import { toAnthropicChat, toOllamaMessages, toOpenAiMessages } from "../src/main/providers.ts";

const IMAGE = { mime: "image/png", data: "QUJD" };

test("OpenAI turns an image turn into content parts, text turns stay strings", () => {
  const rows = toOpenAiMessages([
    { role: "user", content: "look" },
    { role: "user", content: "here it is", images: [IMAGE] },
  ]);
  assert.equal(rows[0].content, "look", "a plain turn is still a string");
  const parts = rows[1].content;
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[0], { type: "text", text: "here it is" });
  assert.deepEqual(parts[1], { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } });
});

test("OpenAI keeps tool calls and results intact", () => {
  const rows = toOpenAiMessages([
    { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "fs.read", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c1", content: "done", name: "fs.read" },
  ]);
  assert.equal(rows[0].tool_calls.length, 1);
  assert.equal(rows[1].tool_call_id, "c1");
  assert.equal(rows[1].name, "fs.read");
});

test("Ollama carries the base64 in its own images field", () => {
  const rows = toOllamaMessages([{ role: "user", content: "look", images: [IMAGE] }]);
  assert.deepEqual(rows[0].images, ["QUJD"]);
  const plain = toOllamaMessages([{ role: "user", content: "look" }]);
  assert.equal("images" in plain[0], false, "no empty arrays for text-only turns");
});

test("Anthropic pushes an image block next to the text", () => {
  const request = toAnthropicChat([{ role: "user", content: "look", images: [IMAGE] }]);
  const blocks = request.messages[0].content;
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], { type: "text", text: "look" });
  assert.deepEqual(blocks[1], { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } });
});
