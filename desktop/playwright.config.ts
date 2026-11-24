import { defineConfig } from "playwright/test";

/**
 * Visual-regression baseline: every page in every one of the nine themes.
 *
 * The Electron app is launched from the built `dist/` output, so run `pnpm build`
 * first. Themes and pages are driven through the dev hook exposed by the renderer
 * (`window.__hymnixDev`), which only exists in the renderer bundle.
 *
 *   pnpm exec playwright test --project=electron
 *
 * Baseline files land in docs/2.0-plan/phase1/screenshots/<theme>/<page>.png.
 */
export default defineConfig({
  testDir: "./tests/visual",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
  projects: [{ name: "electron" }],
});
