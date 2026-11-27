import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compatibleVersion } from "../src/main/gateway-lifecycle.ts";

test("the gateway version this repository ships is accepted", () => {
  const version = readFileSync(join(process.cwd(), "..", "VERSION"), "utf8").trim();
  assert.ok(version, "VERSION must not be empty");
  assert.equal(compatibleVersion(version), true,
    "the app would refuse its own backend at " + version + "; add its minor to SUPPORTED_GATEWAY_MINORS");
});

test("a wrong server is still refused", () => {
  assert.equal(compatibleVersion("2.0.0"), false);
  assert.equal(compatibleVersion("1.2.9"), false);
  assert.equal(compatibleVersion(""), false);
  assert.equal(compatibleVersion(15), false);
});
