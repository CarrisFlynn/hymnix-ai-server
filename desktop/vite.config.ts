import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// The packaged app loads the renderer from file://: assets must be relative and
// the bundle must be a classic script, because Chromium blocks ES modules on file://.
export default defineConfig({
  base: "./",
  plugins: [react()],
  root: "src/renderer",
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    rollupOptions: { output: { format: "iife", inlineDynamicImports: true } }
  }
});
