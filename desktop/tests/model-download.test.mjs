import assert from "node:assert/strict";
import { test } from "node:test";
import { pullErrorMessage, trackDownloadProgress } from "../src/renderer/model-download.ts";

const layer = (digest, completed, total = 5000) => ({ status: "pulling " + digest, digest, completed, total });

test("uses streamed bytes and elapsed time to estimate transfer speed", () => {
  const track = trackDownloadProgress();
  assert.equal(track(layer("a", 1000), 0).bytesPerSecond, undefined);
  assert.equal(track(layer("a", 1250), 100).bytesPerSecond, undefined);
  assert.deepEqual(track(layer("a", 1500), 500), { status: "pulling a", completed: 1500, total: 5000, bytesPerSecond: 1000 });
  assert.equal(track(layer("a", 2500), 1000).bytesPerSecond, 1500);
  assert.equal(track(layer("a", 2500), 1500).bytesPerSecond, 0);
});

test("resets speed across layers, byte resets and verification", () => {
  const track = trackDownloadProgress();
  track(layer("a", 0), 0);
  assert.equal(track(layer("a", 2000), 1000).bytesPerSecond, 2000);
  assert.equal(track(layer("b", 3000), 2000).bytesPerSecond, undefined);
  assert.equal(track(layer("b", 4000), 3000).bytesPerSecond, 1000);
  assert.equal(track(layer("b", 1000), 3500).bytesPerSecond, undefined);
  assert.deepEqual(track({ status: "verifying sha256 digest" }, 4000), {
    status: "verifying sha256 digest", completed: undefined, total: undefined, bytesPerSecond: undefined,
  });
  assert.equal(track(layer("b", 5000), 4500).bytesPerSecond, undefined);
});

test("bounds progress and keeps unknown totals indeterminate", () => {
  const track = trackDownloadProgress();
  assert.equal(track(layer("a", -10), 0).completed, 0);
  assert.equal(track(layer("a", 6000), 250).completed, 5000);
  assert.equal(track(layer("a", 1000, 0), 500).total, undefined);
  assert.equal(track(layer("a", Number.NaN), 1000).completed, undefined);
});

test("keeps the underlying Electron download error visible", () => {
  const message = "manifest does not exist";
  assert.equal(pullErrorMessage(new Error("Error invoking remote method 'models:pull-stream': Error: " + message)), message);
  assert.equal(pullErrorMessage(new Error(message)), message);
});
