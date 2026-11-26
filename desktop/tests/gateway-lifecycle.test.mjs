import assert from "node:assert/strict";
import {once} from "node:events";
import {createServer} from "node:http";
import {fileURLToPath} from "node:url";
import {setTimeout as delay} from "node:timers/promises";
import test from "node:test";
import {GatewayLifecycle, compatibleVersion} from "../src/main/gateway-lifecycle.ts";

const fixturePath = fileURLToPath(new URL("./fixtures/gateway-child.cjs", import.meta.url));

async function loopbackServer(t, version) {
  const server = createServer((_, res) => res.end(JSON.stringify({ok: true, gateway: version})));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  return server.address().port;
}
function lifecycle(t, defaultPort, mode, options = {}) {
  const logs = [];
  const gateway = new GatewayLifecycle({command: process.execPath, args: [fixturePath, mode], requiredPath: fixturePath,
    cwd: fileURLToPath(new URL("..", import.meta.url)), log: (line) => logs.push(line), defaultPort,
    startupTimeoutMs: 2000, shutdownTimeoutMs: 1000, ...options});
  t.after(() => gateway.stop());
  return {gateway, logs};
}

test("the readiness gate accepts this release and its predecessor, nothing else", () => {
  // The 1.4.0 bump once broke startup: the gate matched only /^1\.3/.
  for (const version of ["1.4.0", "1.4.1", "1.3.3", "1.3.2"]) assert.equal(compatibleVersion(version), true, version + " must be accepted");
  // A minor-only report means the same server family; anything else is a stranger.
  assert.equal(compatibleVersion("1.4"), true);
  for (const version of ["2.0.0", "1.2.9", "1.5.0", "", "banana", null, undefined, 1.4]) assert.equal(compatibleVersion(version), false, String(version) + " must be rejected");
});

test("an owned 1.4.0 backend is adopted, not rejected", async (t) => {
  const {gateway} = lifecycle(t, 0, "ready");
  const started = await gateway.start();
  assert.equal(started.ready, true, started.error);
  assert.equal(started.external, false);
});

test("compatible external gateway remains running through restart and stop", async (t) => {
  const port = await loopbackServer(t, "1.3.2");
  const {gateway, logs} = lifecycle(t, port, "exit");
  const started = await gateway.start();
  assert.equal(started.ready, true);
  assert.equal(started.external, true);
  assert.equal(started.port, port);
  assert.equal((await gateway.restart()).external, true);
  await gateway.stop();
  assert.equal((await fetch(started.base + "/health")).status, 200);
  assert.equal(logs.some((line) => line.includes("backend:")), false);
});

test("occupied default port falls back to an owned process and restart waits for shutdown", async (t) => {
  const port = await loopbackServer(t, "1.30.0");
  const {gateway, logs} = lifecycle(t, port, "ready");
  const started = gateway.start();
  assert.strictEqual(started, gateway.start());
  assert.equal(gateway.snapshot().state, "starting");
  const bootstrap = await gateway.bootstrap();
  assert.equal(bootstrap.ready, true);
  assert.equal(bootstrap.external, false);
  assert.notEqual(bootstrap.port, port);
  assert.equal((await fetch(bootstrap.base + "/health")).status, 200);
  const restart = gateway.restart();
  assert.strictEqual(restart, gateway.restart());
  assert.equal((await restart).ok, true);
  const beforeSecondStart = logs.slice(0, logs.findLastIndex((line) => line.startsWith("gateway ready")));
  assert.equal(beforeSecondStart.some((line) => line.includes("clean shutdown")), true);
  assert.equal((await fetch("http://127.0.0.1:" + port)).status, 200);
  await gateway.stop();
  assert.equal(gateway.snapshot().state, "stopped");
  await assert.rejects(fetch(gateway.snapshot().base + "/health"));
});

test("failed startup is reported, and a stopped supervisor cannot relaunch", async (t) => {
  const port = await loopbackServer(t, "other");
  const {gateway} = lifecycle(t, port, "exit");
  const result = await gateway.start();
  assert.equal(result.ok, false);
  assert.equal(result.state, "failed");
  assert.match(result.error, /exited.*code 13/);
  await gateway.stop();
  assert.equal((await gateway.restart()).state, "stopped");
});

test("startup deadline and shutdown during startup both clean up the child", async (t) => {
  const port = await loopbackServer(t, "other");
  const {gateway, logs} = lifecycle(t, port, "hang", {startupTimeoutMs: 350});
  const result = await gateway.start();
  assert.equal(result.ok, false);
  assert.match(result.error, /startup deadline/);
  assert.equal(logs.some((line) => line.includes("clean shutdown")), true);
  const restart = gateway.restart();
  await delay(50);
  await gateway.stop();
  assert.equal((await restart).ok, false);
  assert.equal(gateway.snapshot().state, "stopped");
});
