import assert from "node:assert/strict";
import { request } from "node:http";
import { test } from "node:test";
import { TerminalBridge } from "../src/main/terminal-bridge.ts";

function post(endpoint, token, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    const req = request(endpoint, { method: "POST", headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": body.length,
      ...headers,
    } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.setTimeout(6000, () => req.destroy(new Error("Test request timed out")));
    req.once("error", reject);
    req.end(body);
  });
}

const reply = { provider: "gemini", text: "你好\r\n\u001b外部回复 <b>保持原样</b>" };

test("bridge requires opt-in and drains authenticated local replies as plain text", async (t) => {
  const bridge = new TerminalBridge();
  t.after(() => bridge.stop());
  assert.deepEqual(await bridge.run("status"), { enabled: false });
  const [connection, sameConnection] = await Promise.all([bridge.run("on"), bridge.run("on")]);
  const { endpoint, token } = connection;
  assert.match(endpoint, /^http:\/\/127\.0\.0\.1:\d+\/reply$/);
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.deepEqual(sameConnection, connection);
  assert.equal(await post(endpoint, token, reply), 202);
  assert.deepEqual(await bridge.run("status"), { enabled: true, endpoint, pending: 1 });
  const inbox = await bridge.run("inbox");
  assert.equal(inbox.pending, 0);
  assert.equal(inbox.replies[0].provider, "gemini");
  assert.equal(inbox.replies[0].text, "你好\n外部回复 <b>保持原样</b>");
  assert.deepEqual((await bridge.run("inbox")).replies, []);
});

test("bridge rejects invalid senders and bounds its inbox", async (t) => {
  const bridge = new TerminalBridge();
  t.after(() => bridge.stop());
  const { endpoint, token } = await bridge.run("on");
  assert.equal(await post(endpoint, "wrong", reply), 401);
  assert.equal(await post(endpoint, token, reply, { Origin: "http://localhost" }), 403);
  assert.equal(await post(endpoint, token, reply, { Host: "localhost" }), 403);
  assert.equal(await post(endpoint, token, { ...reply, command: "unexpected" }), 400);
  assert.equal(await post(endpoint, token, { ...reply, text: " " }), 400);
  assert.equal(await post(endpoint, token, { ...reply, text: "a".repeat(64 * 1024) }), 413);
  assert.equal(await post(endpoint, token, reply, { Expect: "100-continue" }), 202);
  for (let i = 0; i < 7; i++) assert.equal(await post(endpoint, token, reply), 202);
  assert.equal(await post(endpoint, token, reply), 429);
  assert.equal((await bridge.run("inbox")).replies.length, 8);
});

test("stopping revokes the endpoint and queued replies; restart rotates the token", async (t) => {
  const bridge = new TerminalBridge();
  t.after(() => bridge.stop());
  const start = bridge.run("on");
  bridge.stop();
  assert.deepEqual(await start, { enabled: false });
  const previous = await bridge.run("on");
  assert.equal(await post(previous.endpoint, previous.token, reply), 202);
  assert.deepEqual(await bridge.run("off"), { enabled: false });
  await assert.rejects(post(previous.endpoint, previous.token, reply), { code: "ECONNREFUSED" });
  const next = await bridge.run("on");
  assert.notEqual(next.token, previous.token);
  assert.equal(await post(next.endpoint, previous.token, reply), 401);
  assert.deepEqual((await bridge.run("inbox")).replies, []);
});
