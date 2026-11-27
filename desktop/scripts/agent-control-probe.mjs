import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const cwd = resolve(process.cwd());
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-agentops", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.2"); localStorage.setItem("hymnix.lang","zh"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.setViewportSize({ width: 1440, height: 900 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
for (let i = 0; i < 60; i += 1) { const boot = await win.evaluate(() => window.hymnix.bootstrap()); if (boot.ready) break; await win.waitForTimeout(500); }

const names = await win.evaluate(() => window.__hymnixDev.toolNames());
const want = ["agent.wait","agent.interrupt","list_session","session_search","worktree.list","worktree.create","worktree.remove"];
console.log("TOOL_COUNT " + names.length);
console.log("TOOL_NEW " + String(want.every((n) => names.includes(n))) + " missing=" + (want.filter((n) => !names.includes(n)).join(",") || "-"));

// 会话工具：真实会话存储
const seeded = await win.evaluate(() => {
  const rows = [{ id: "seed-1", name: "Renderer work", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), count: 2, model: "qwen3:8b", draft: "", pinned: true,
    messages: [{ role: "user", content: "Where is the tool loop?" }, { role: "assistant", content: "In main.tsx, streamTurn." }] }];
  localStorage.setItem("hymnix.chat.sessions.v2", JSON.stringify(rows));
  return true;
});
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => window.__hymnixDev.dismissOverlays());
await win.waitForTimeout(800);
const listed = await win.evaluate(() => window.__hymnixDev.runTool("list_session", {}));
console.log("LIST_SESSION " + String(listed).slice(0, 220));
const searched = await win.evaluate(() => window.__hymnixDev.runTool("session_search", { query: "streamTurn" }));
console.log("SESSION_SEARCH " + String(searched).slice(0, 260));
const empty = await win.evaluate(() => window.__hymnixDev.runTool("session_search", { query: "  " }));
console.log("SESSION_SEARCH_EMPTY_REFUSED " + String(empty).includes("query_required"));

// worktree：没有工作区时必须诚实报错，不能假装成功
const wt = await win.evaluate(() => window.__hymnixDev.runTool("worktree.list", {}));
console.log("WORKTREE_LIST " + String(wt).slice(0, 200));
const wtBad = await win.evaluate(() => window.__hymnixDev.runTool("worktree.create", { name: "Bad Name!" }));
console.log("WORKTREE_BAD_NAME " + String(wtBad).includes("invalid_name"));

// agent.wait：没有运行中的代理时必须立即返回空，而不是挂住
const waited = await win.evaluate(() => window.__hymnixDev.runTool("agent.wait", { timeoutSeconds: 5 }));
console.log("AGENT_WAIT_EMPTY " + String(waited).slice(0, 160));
const interrupt = await win.evaluate(() => window.__hymnixDev.runTool("agent.interrupt", { name: "nobody" }));
console.log("AGENT_INTERRUPT_NOT_RUNNING " + String(interrupt).includes("not_running"));

// read_image：真实 PNG 读出 base64；非图片被拒
const png = resolve(cwd, "../docs/audit-1.4.0/ask-dialog.png");
const img = await win.evaluate((p) => window.hymnix.files.image(p), png);
console.log("IMAGE_OK " + String(img.ok) + " mime=" + (img.mime || "-") + " bytes=" + String(img.bytes) + " b64len=" + String((img.data || "").length));
const notImage = await win.evaluate((p) => window.hymnix.files.image(p), resolve(cwd, "package.json"));
console.log("IMAGE_NON_IMAGE_REFUSED " + String(notImage.ok === false && notImage.error === "not_an_image"));
const missingImage = await win.evaluate((p) => window.hymnix.files.image(p).catch((reason) => ({ ok: false, error: String(reason) })), resolve(cwd, "nope.png"));
console.log("IMAGE_MISSING_REFUSED " + String(missingImage.ok === false));
const viaTool = await win.evaluate((p) => window.__hymnixDev.runTool("read_image", { path: p }), png);
console.log("READ_IMAGE_TOOL " + String(viaTool).slice(0, 200));

// lsp：自带语言服务器，真查询
const symbols = await win.evaluate(() => window.__hymnixDev.runTool("lsp", { operation: "symbols", file: "src/main/web-search.ts" }));
const parsedSymbols = JSON.parse(symbols);
console.log("LSP_RAW " + symbols.slice(0, 300));
console.log("LSP_SYMBOL_NAMES " + JSON.stringify((parsedSymbols.results || []).slice(0, 4).map((r) => r.name + "@" + r.line)));
console.log("LSP_SYMBOLS ok=" + String(parsedSymbols.ok) + " count=" + String((parsedSymbols.results || []).length) + " server=" + String(parsedSymbols.server || "-").slice(-42));
const def = await win.evaluate(() => window.__hymnixDev.runTool("lsp", { operation: "definition", file: "src/main/main.ts", line: 674, character: 18 }));
const parsedDef = JSON.parse(def);
console.log("LSP_DEFINITION ok=" + String(parsedDef.ok) + " results=" + JSON.stringify((parsedDef.results || []).slice(0, 2)));

// run_code：子进程执行 + 工具桥接 + 审批门
const program = 'const raw = await tools.call("list_session", {}); const parsed = JSON.parse(raw); console.log("sessions", parsed.total); export default { total: parsed.total, ok: parsed.ok };';
const runPromise = win.evaluate((code) => window.__hymnixDev.runTool("run_code", { code }), program);
await win.waitForTimeout(900);
const runDrawer = await win.evaluate(() => ({
  open: Boolean(document.querySelector(".approvals-drawer")),
  tools: [...document.querySelectorAll(".approval-row strong")].map((el) => el.textContent && el.textContent.trim()),
  reasons: [...document.querySelectorAll(".approval-reasons")].map((el) => el.textContent && el.textContent.trim()),
}));
console.log("RUNCODE_APPROVAL_OPEN " + runDrawer.open + " tools=" + JSON.stringify(runDrawer.tools));
console.log("RUNCODE_REASONS " + JSON.stringify(runDrawer.reasons));
await win.evaluate(() => document.querySelector(".approval-row-actions .btn.primary").click());
const runResult = await runPromise;
console.log("RUNCODE_RESULT " + String(runResult).slice(0, 320));

// 拒绝路径：不得执行
const denyPromise = win.evaluate(() => window.__hymnixDev.runTool("run_code", { code: "export default 1;" }));
await win.waitForTimeout(800);
await win.evaluate(() => document.querySelector(".approval-row-actions .btn.danger").click());
console.log("RUNCODE_DENIED " + String(await denyPromise).slice(0, 160));

// 语法错误要报出来，不能假装成功
const badPromise = win.evaluate(() => window.__hymnixDev.runTool("run_code", { code: "export default (((;" }));
await win.waitForTimeout(800);
await win.evaluate(() => document.querySelector(".approval-row-actions .btn.primary").click());
console.log("RUNCODE_SYNTAX_ERROR " + String(await badPromise).slice(0, 220));

await app.close();
