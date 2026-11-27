import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

/**
 * Production-bundle smoke test: does a shipped build boot without the dev hook
 * and render its shell? It asserts and exits non-zero, so it can gate a release.
 *
 * Needs an Electron GUI (Windows/macOS desktop); it is not part of pnpm check.
 */
const cwd = resolve(process.cwd());
const profile = process.env.HYMNIX_SMOKE_PROFILE || mkdtempSync(resolve(tmpdir(), "hymnix-smoke-"));
const failures = [];
const check = (name, ok, detail = "") => {
  if (!ok) failures.push(name + (detail ? ": " + detail : ""));
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  " + detail : ""));
};

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let app = null;
try {
  // Point HYMNIX_SMOKE_EXE at a built exe to smoke test the real artifact instead
  // of the working tree; that is the check a release actually needs.
  const executable = process.env.HYMNIX_SMOKE_EXE || "";
  app = executable
    ? await electron.launch({ executablePath: executable, args: ["--user-data-dir=" + profile], env })
    : await electron.launch({ args: ["--user-data-dir=" + profile, "."], cwd, env });
  const win = await app.firstWindow();
  await win.waitForFunction(() => Boolean(window.hymnix && window.hymnix.bootstrap), null, { timeout: 60000 });
  await win.evaluate(() => {
    localStorage.setItem("hymnix.welcome", "1");
    localStorage.setItem("hymnix.whatsNew", "1.4.2");
  });
  await win.reload();
  await win.waitForFunction(() => Boolean(window.hymnix && window.hymnix.bootstrap), null, { timeout: 60000 });

  let boot = null;
  for (let i = 0; i < 60; i += 1) {
    boot = await win.evaluate(() => window.hymnix.bootstrap());
    if (boot && boot.ready) break;
    await win.waitForTimeout(500);
  }
  check("app boots", Boolean(boot && boot.ready));
  check("dev hook absent from the shipped bundle", await win.evaluate(() => typeof window.__hymnixDev === "undefined"));
  check("shell renders", await win.evaluate(() => Boolean(document.querySelector(".composer") || document.querySelector("nav"))));
} catch (error) {
  check("electron launched and reached the window", false, String(error && error.message ? error.message : error));
} finally {
  if (app) { try { await app.close(); } catch { /* already closed */ } }
  if (!process.env.HYMNIX_SMOKE_PROFILE) { try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ } }
}

if (failures.length) {
  console.error("SMOKE FAILED: " + failures.join(" | "));
  process.exit(1);
}
console.log("SMOKE OK");
