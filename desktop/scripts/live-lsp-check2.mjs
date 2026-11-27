process.env.HYMNIX_LSP_TYPESCRIPT = "C:\\Users\\xiaoy\\AppData\\Local\\Temp\\lsp-probe\\node_modules\\typescript-language-server\\lib\\cli.mjs";
const { runLspQuery } = await import("../src/main/lsp.ts");
const root = "C:\\Users\\xiaoy\\AppData\\Local\\Temp\\lsp-probe";
const s1 = await runLspQuery({ root, operation: "symbols", file: "sample.ts" });
console.log("TMP_SYMBOLS ok=" + s1.ok + " err=" + (s1.error || "-") + " count=" + (s1.results || []).length + " first=" + JSON.stringify((s1.results || [])[0] || null));
const d1 = await runLspQuery({ root, operation: "definition", file: "sample.ts", line: 2, character: 10 });
console.log("TMP_DEF ok=" + d1.ok + " results=" + JSON.stringify(d1.results));