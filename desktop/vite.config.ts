import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
// The packaged app loads the renderer from file://: assets must be relative and
// the bundle must be a classic script, because Chromium blocks ES modules on file://.
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [react()],
  // The renderer is an IIFE (file:// blocks ES modules), so import.meta.env is
  // not available at runtime; development-only hooks key off this constant.
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __DEV_BUILD__: JSON.stringify(mode !== "production") },
  root: "src/renderer",
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    rollupOptions: { output: { format: "iife", inlineDynamicImports: true } }
  }
}));
