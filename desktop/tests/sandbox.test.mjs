import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureTools, safePath, ToolFailure } from "../src/main/agent-tools.ts";
import { isPrivateAddress } from "../src/main/agent-shell.ts";

function outside(root) {
  const dir = mkdtempSync(join(tmpdir(), "hx-out-"));
  writeFileSync(join(dir, "secret.txt"), "TOPSECRET_OUTSIDE");
  return dir;
}

test("a link inside the workspace cannot reach outside it", () => {
  const root = mkdtempSync(join(tmpdir(), "hx-root-"));
  const work = join(root, "work");
  mkdirSync(work);
  const out = outside(root);
  const link = join(work, "escape");
  symlinkSync(out, link, "junction");
  configureTools(work);
  assert.throws(() => safePath("escape/secret.txt"), (error) => error instanceof ToolFailure && error.code === "out_of_scope");
  assert.throws(() => safePath("escape/new.txt"), (error) => error instanceof ToolFailure && error.code === "out_of_scope");
});

test("a plain path inside the workspace still resolves", () => {
  const work = mkdtempSync(join(tmpdir(), "hx-root-"));
  configureTools(work);
  const resolved = safePath("a/b.txt");
  assert.ok(resolved.startsWith(work));
});

test("dot-dot escapes are refused", () => {
  const work = mkdtempSync(join(tmpdir(), "hx-root-"));
  configureTools(work);
  assert.throws(() => safePath("../../etc/passwd"), (error) => error instanceof ToolFailure && error.code === "out_of_scope");
});

test("IPv4-mapped IPv6 addresses are judged as the IPv4 they carry", () => {
  for (const address of ["::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:192.168.1.1", "::ffff:169.254.169.254"]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress("::ffff:93.184.216.34"), false, "a public mapped address stays allowed");
  assert.equal(isPrivateAddress("::ffff:7f00:1"), true, "the hex form of the same loopback address");
});

test("loopback, link-local and multicast are refused", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.0.1", "169.254.1.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fd00::1", "ff02::1"]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress("93.184.216.34"), false);
  assert.equal(isPrivateAddress("2606:4700:4700::1111"), false);
});
