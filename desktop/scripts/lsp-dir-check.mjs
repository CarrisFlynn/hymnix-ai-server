process.env.HYMNIX_LSP_TYPESCRIPT = "C:\\Users\\xiaoy\\AppData\\Local\\Temp\\lsp-probe\\node_modules\\typescript-language-server\\lib\\cli.mjs";
const { runLspQuery } = await import("../src/main/lsp.ts");
process.on("uncaughtException", (e) => { console.log("UNCAUGHT " + e.message); process.exit(3); });
const root = process.cwd();
for (const file of ["src", "src/main", "nope.ts", "package.json"]) {
  const r = await runLspQuery({ root, operation: "symbols", file });
  console.log(`  ${file.padEnd(18)} ok=${r.ok} error=${r.error || "-"}`);
}
const ok = await runLspQuery({ root, operation: "symbols", file: "src/main/lsp.ts" });
console.log("  real file          ok=" + ok.ok + " count=" + (ok.results || []).length);