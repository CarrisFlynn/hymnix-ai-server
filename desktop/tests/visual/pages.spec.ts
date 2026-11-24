import { test, _electron as electron } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Captures one baseline image per page per theme (11 pages x 9 themes = 99).
 *
 * Run `pnpm build` first, then `pnpm visual`. Each image lands in
 * docs/2.0-plan/phase1/screenshots/<theme>/<page>.png and is committed so a
 * later diff shows exactly which control moved. Overlays (first-run card,
 * "what's new", QR) are dismissed through the dev hook so the baseline shows
 * the page itself.
 */
// The package is CommonJS, so `import.meta` is unavailable; Playwright runs the
// suite from the desktop package root (where playwright.config.ts lives).
const desktopRoot = resolve(process.cwd());
const outputRoot = resolve(desktopRoot, "../docs/2.0-plan/phase1/screenshots");

const THEMES = [
  "camellia-white",
  "deep-sea-blue",
  "ink-green",
  "honey-crimson",
  "cyan-dark",
  "orange-dark",
  "rog-red-black",
  "neon-black",
  "graphite-gold",
];

const PAGES = [
  "Chat",
  "Models",
  "Gateway",
  "Plugins",
  "Monitor",
  "Terminal",
  "History",
  "Settings",
  "Changelog",
  "Support",
  "DesignLab",
];

type DevHook = {
  navigate: (page: string) => void;
  applyTheme: (id: string) => void;
  dismissOverlays: () => void;
};

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

test("capture every page in every theme", async () => {
  // Some shells (IDE hosts, CI wrappers) export ELECTRON_RUN_AS_NODE=1, which makes
  // electron.exe behave like plain Node and reject Playwright's debugging flags.
  const env = { ...process.env, HYMNIX_VISUAL_TEST: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: ["."],
    cwd: desktopRoot,
    env: env as Record<string, string>,
  });
  const window = await app.firstWindow();
  await window.waitForFunction(() => Boolean((window as unknown as { __hymnixDev?: unknown }).__hymnixDev), null, { timeout: 60_000 });
  // A baseline is only useful when the starting state is fixed. Earlier runs left
  // the sidebar collapsed and a demo conversation behind, which showed up in the
  // captures; reset the stored preferences before taking any picture.
  await window.evaluate(() => {
    localStorage.setItem("hymnix.welcome", "1");
    localStorage.setItem("hymnix.whatsNew", "1.3.3");
    localStorage.setItem("hymnix.sidebar.collapsed", "0");
    localStorage.removeItem("hymnix.chat.sessions.v2");
    localStorage.removeItem("hymnix.chat.saved");
  });
  await window.reload();
  await window.waitForFunction(() => Boolean((window as unknown as { __hymnixDev?: unknown }).__hymnixDev), null, { timeout: 60_000 });
  await window.setViewportSize({ width: 1440, height: 900 });
  await window.evaluate(() => (window as unknown as { __hymnixDev: DevHook }).__hymnixDev.dismissOverlays());
  // Give the model list and health probe one chance to settle before capturing.
  await window.waitForTimeout(800);

  for (const theme of THEMES) {
    const dir = join(outputRoot, theme);
    mkdirSync(dir, { recursive: true });
    await window.evaluate((id) => (window as unknown as { __hymnixDev: DevHook }).__hymnixDev.applyTheme(id), theme);
    for (const page of PAGES) {
      await window.evaluate((name) => (window as unknown as { __hymnixDev: DevHook }).__hymnixDev.navigate(name), page);
      await window.waitForTimeout(220);
      await window.screenshot({ path: join(dir, `${page.toLowerCase()}.png`), animations: "disabled" });
    }
  }

  await app.close();
});
