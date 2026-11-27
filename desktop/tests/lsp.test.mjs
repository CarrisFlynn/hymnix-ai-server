import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFrames, encodeFrame, findServer, pathToUri, serverCandidates, uriToPath } from "../src/main/lsp.ts";

test("encodeFrame writes a Content-Length header with a UTF-8 body length", () => {
  const frame = encodeFrame({ jsonrpc: "2.0", id: 1 });
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1 });
  assert.ok(frame.startsWith("Content-Length: " + Buffer.byteLength(body, "utf8") + "\r\n\r\n"));
  assert.ok(frame.endsWith(body));
  // A multi-byte payload must count bytes, not characters.
  const wide = encodeFrame({ text: "中文" });
  assert.ok(wide.startsWith("Content-Length: " + Buffer.byteLength(JSON.stringify({ text: "中文" }), "utf8")));
});

test("decodeFrames reads whole frames and keeps the remainder", () => {
  const one = encodeFrame({ id: 1, result: "a" });
  const two = encodeFrame({ id: 2, result: "b" });
  const partial = two.slice(0, 10);
  const parsed = decodeFrames(one + partial);
  assert.equal(parsed.messages.length, 1);
  assert.equal(parsed.messages[0].id, 1);
  assert.equal(parsed.rest, partial, "an incomplete frame stays buffered");
  const second = decodeFrames(parsed.rest + two.slice(10));
  assert.equal(second.messages.length, 1);
  assert.equal(second.messages[0].id, 2);
  assert.equal(second.rest, "");
});

test("decodeFrames survives a header it cannot parse", () => {
  const junk = "X-Nonsense: 1\r\n\r\n" + encodeFrame({ id: 9 });
  const parsed = decodeFrames(junk);
  assert.equal(parsed.messages.length, 1);
  assert.equal(parsed.messages[0].id, 9);
});

test("file URIs round-trip a Windows path", () => {
  const uri = pathToUri("C:/work/app/src/main.ts");
  assert.ok(uri.startsWith("file:///C:/work"));
  const back = uriToPath(uri);
  assert.ok(back.toLowerCase().endsWith("app/src/main.ts"), back);
  assert.ok(!back.startsWith("/"), "the leading slash is dropped on Windows");
});

test("findServer returns null instead of inventing a binary", () => {
  const candidates = serverCandidates("C:/definitely/not/here");
  assert.ok(candidates.length >= 1);
  assert.equal(findServer("C:/definitely/not/here"), null);
});
