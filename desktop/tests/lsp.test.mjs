import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFrames, encodeFrame, findServer, pathToUri, resolveInside, serverCandidates, uriToPath } from "../src/main/lsp.ts";

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
  assert.equal(parsed.rest.toString("utf8"), partial, "an incomplete frame stays buffered");
  const second = decodeFrames(Buffer.concat([parsed.rest, Buffer.from(two.slice(10), "utf8")]));
  assert.equal(second.messages.length, 1);
  assert.equal(second.messages[0].id, 2);
  assert.equal(second.rest.length, 0);
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

test("decodeFrames reads a frame whose body has multi-byte characters", () => {
  // The header counts BYTES while a JS string counts code units, so a string
  // based decoder sliced this in half and dropped it: every request with a
  // Chinese symbol name timed out. This is the regression guard for that.
  const frame = encodeFrame({ id: 7, result: "中文符号" });
  assert.ok(frame.length < Buffer.byteLength(frame, "utf8"), "the string is shorter than its bytes");
  const parsed = decodeFrames(frame);
  assert.equal(parsed.messages.length, 1);
  assert.equal(parsed.messages[0].id, 7);
  assert.equal(parsed.messages[0].result, "中文符号");
});

test("decodeFrames survives a multi-byte character split across chunks", () => {
  const frame = Buffer.from(encodeFrame({ id: 8, result: "分块" }), "utf8");
  // Cut inside the body, then feed the halves as they would arrive on a socket.
  const cut = frame.length - 3;
  const first = decodeFrames(frame.subarray(0, cut));
  assert.equal(first.messages.length, 0);
  const second = decodeFrames(Buffer.concat([first.rest, frame.subarray(cut)]));
  assert.equal(second.messages.length, 1);
  assert.equal(second.messages[0].result, "分块");
});

test("resolveInside refuses absolute paths and escapes", () => {
  const root = process.cwd();
  const inside = resolveInside(root, "package.json");
  assert.ok(inside, "a workspace-relative file resolves");
  assert.ok(inside.toLowerCase().endsWith("package.json"), inside);
  assert.ok(inside.toLowerCase().startsWith(root.toLowerCase().slice(0, 12)), "and stays under the root");
  assert.equal(resolveInside(root, "C:\\Windows\\win.ini"), null, "an absolute path is out of scope");
  assert.equal(resolveInside(root, "/etc/passwd"), null);
  assert.equal(resolveInside(root, "../../README.md"), null, "an escape is out of scope");
  assert.equal(resolveInside(root, ""), null);
});
