import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
// The packaged app loads the renderer from file://: assets must be relative and
// the bundle must be a classic script, because Chromium blocks ES modules on file://.
export default defineConfig({
  base: "./",
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  root: "src/renderer",
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    rollupOptions: { output: { format: "iife", inlineDynamicImports: true } }
  }
});
