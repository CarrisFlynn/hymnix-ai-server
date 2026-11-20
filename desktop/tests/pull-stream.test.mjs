import assert from "node:assert/strict";
import { test } from "node:test";
import { readPullStream } from "../src/main/pull-stream.ts";

test("parses split chunks and an unterminated success record", async () => {
  const chunks = ['{"status":"pull', 'ing","digest":"sha256:1","completed":42,"total":100}\r\n', '{"status":"success"}'];
  const stream = new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
    controller.close();
  } });
  const events = [];
  await readPullStream(new Response(stream), (event) => events.push(event));
  assert.deepEqual(events, [{ status: "pulling", digest: "sha256:1", completed: 42, total: 100 }, { status: "success" }]);
});

test("reports Ollama errors and rejects interrupted downloads", async () => {
  await assert.rejects(readPullStream(new Response('{"error":"manifest missing"}\n'), () => {}), /manifest missing/);
  await assert.rejects(readPullStream(new Response('{"status":"pulling"}\n'), () => {}), /before the download completed/);
});
