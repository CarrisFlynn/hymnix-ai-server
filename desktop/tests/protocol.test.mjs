import fs from "node:fs"; import assert from "node:assert/strict";
const read = (file) => fs.readFileSync(new URL(file, import.meta.url), "utf8");
const main = read("../src/main/main.ts"), preload = read("../src/preload/preload.ts"), renderer = read("../src/renderer/main.tsx");
const readme = read("../README.md");
for (const token of ["contextIsolation:true", "sandbox:true", "nodeIntegration:false", "setWindowOpenHandler", "will-navigate", "Content-Security-Policy"]) assert.ok(main.includes(token), `main missing ${token}`);
for (const token of ["backend-gateway-headless.exe", "headless_gateway.py", "GatewayLifecycle"]) assert.ok(main.includes(token), `main supervisor missing ${token}`);
const lifecycle = read("../src/main/gateway-lifecycle.ts");
assert.ok(lifecycle.includes("compatibleVersion(payload.gateway)"), "external gateway version is checked");
for (const token of ["contextBridge.exposeInMainWorld", "AbortController"]) assert.ok(preload.includes(token) || main.includes(token), `IPC shell missing ${token}`);
for (const token of ["api/tags", "v1/chat/completions", "Authorization", "127.0.0.1:11435"]) assert.ok(main.includes(token), `main gateway contract missing ${token}`);
assert.ok(renderer.includes("127.0.0.1:11435"), "renderer gateway port mismatch");
assert.ok(readme.includes("127.0.0.1:11435"), "README gateway port mismatch");
assert.ok(!readme.includes("127.0.0.1:11434"), "README documents the upstream model port as the gateway port");
assert.ok(readme.includes("held in memory"), "README must document memory-only API key handling");
assert.ok(!readme.includes("HYMNIx_GATEWAY_TOKEN"), "README must not claim an environment token contract");
assert.ok(renderer.includes("__APP_VERSION__"), "renderer must show the app version in About");
assert.ok(renderer.includes('head("About"') && renderer.includes("{__APP_VERSION__} · Hymnix Studio"), "app version must be in About rather than the title bar");
assert.ok(!renderer.includes('"ORBIT · "'), "title bar must not carry the old version badge");
assert.ok(main.includes("minWidth: 800, minHeight: 560"), "window must support the planned minimum dimensions");
assert.ok(main.includes("Math.min(1294") && main.includes("Math.min(830"), "window must open at the reference size (1294x830 DIP)");
assert.ok(main.includes('"window:appearance"') && preload.includes('"window:appearance"'), "native window appearance must follow renderer theme selection");
for (const view of ["Chat","History","Gateway","Models","Terminal","Monitor","Changelog","Support","Settings"]) assert.ok(renderer.includes(view), `renderer missing view ${view}`);
for (const token of ['aria-label={t("Navigation")}', 't("Message")', 'className="chat-title"', 'className="side-brand"']) assert.ok(renderer.includes(token), `renderer accessibility/name missing ${token}`);
const chat = read("../src/renderer/chat-navigation.tsx");
for (const token of ['aria-live="polite"', 'aria-current', 'Conversation turns']) assert.ok(chat.includes(token), `chat navigation missing ${token}`);
assert.ok(chat.includes("messageDay") && read("../src/renderer/chat.tsx").includes("formatMessageTime"), "chat messages must group by date and display readable times");
for (const page of ["Files", "Tools", "Approvals", "Logs"]) assert.ok(!renderer.includes(`return render${page}()`), `${page} page must stay removed`);
assert.ok(renderer.includes('if (active === "Changelog") return renderChangelog()'), "changelog must be the only log page");
assert.ok(renderer.includes("navTrailRef") && renderer.includes("function goBack") && renderer.includes('key === "ArrowLeft"'), "every page needs a way back (Alt+Left and the nav trail)");
assert.ok(renderer.includes('items: ["Chat", "Models", "Gateway", "Plugins", "Changelog", "Support"]'), "changelog and sponsor belong in the main list");
assert.ok(renderer.includes('if (active === "Plugins") return renderPlugins()'), "Plugins navigation must reach the management workflow");
assert.ok(preload.includes('ipcRenderer.invoke("plugins:list")') && main.includes('ipcMain.handle("plugins:action"'), "plugin management must use validated preload IPC");
const gatewayCore = read("../../server/gateway_core.py");
assert.ok(gatewayCore.includes('if path == "/admin/plugins"') && gatewayCore.includes('plugins.unload(plugin_id)') && gatewayCore.includes('plugins.set_enabled(plugin_id, False)'), "plugin management must use the authenticated gateway and stop plugins when permissions are revoked");
for (const token of ['setting-row', 'switch', 'segmented', 'ICONS', 'THEMES.filter']) assert.ok(renderer.includes(token), `renderer design system missing ${token}`);
const themeManager = read("../src/theme/themeManager.ts");
for (const token of ['dataset.theme', 'dataset.mode', 'THEMES', 'readStoredTheme', 'applyTheme', 'deep-sea-blue', 'neon-black', 'ink-green', 'honey-crimson', 'graphite-gold']) assert.ok(themeManager.includes(token), `theme manager missing ${token}`);
const tokenEntry = read("../src/styles/index.css");
for (const token of ['./tokens/semantic.css', './tokens/primitives.css', './base.css', './themes.css']) assert.ok(tokenEntry.includes(token), `token entry missing ${token}`);
for (const name of ['light-camellia','light-deepsea','light-ink','light-honey','dark-orange','dark-cyan','dark-neon','dark-rog','dark-graphite']) {
  const theme = read(`../src/styles/themes/${name}.css`);
  for (const token of ['[data-theme=', '--bg:', '--accent:', '--accent-fill:', '--text:', '--border:']) assert.ok(theme.includes(token), `theme ${name} missing ${token}`);
}
const catalog = read("../src/renderer/ModelCatalog.tsx");
for (const token of ['catalog-row', 'catalog-scroll', 'catalog-filters', 'type="search"']) assert.ok(catalog.includes(token), `model catalog missing ${token}`);
const styles = read("../src/renderer/styles.css");
for (const token of ['--s4', '--fs-title', '.model-grid', '.setting-row', '.segmented', '--on-accent']) assert.ok(styles.includes(token), `stylesheet design system missing ${token}`);
// Colour tokens moved out of the component sheet in Phase 1; the selectors now
// live in the theme layer, so assert against that instead of the legacy file.
const themeLayer = ['light-camellia', 'light-deepsea', 'light-ink', 'light-honey', 'dark-orange', 'dark-cyan', 'dark-neon', 'dark-rog', 'dark-graphite']
  .map((name) => read(`../src/styles/themes/${name}.css`)).join("\n");
for (const token of ['[data-theme="camellia-white"]', '[data-theme="rog-red-black"]', '[data-theme="deep-sea-blue"]', '[data-theme="neon-black"]', '--on-accent']) assert.ok(themeLayer.includes(token) || styles.includes(token), `theme layer missing ${token}`);
assert.ok(!styles.includes('[data-theme="daylight"]') && !themeLayer.includes('[data-theme="daylight"]'), "the retired daylight theme must be gone");
assert.ok(themeManager.includes('"deep-sea-blue"') && themeManager.includes('"neon-black"'), "theme catalogue missing the shipped palettes");
assert.ok(!renderer.includes('"Product review"'), "no demo workspace fixtures");
const i18n = read("../src/renderer/i18n.ts");
assert.ok(renderer.includes('from "./i18n"'), "renderer must use the i18n module");
for (const key of ["Chat", "Models", "Settings", "Stop", "Send ↵", "WORKSPACES"]) assert.ok(i18n.includes(key), `i18n missing key ${key}`);
assert.ok(i18n.includes("工作区") && i18n.includes("对话") && i18n.includes("模型"), "i18n missing Chinese translations");
assert.ok(i18n.includes('export function setLang') && i18n.includes('localStorage'), "i18n must persist the language choice");
const pkg = JSON.parse(read("../package.json"));
assert.deepEqual(pkg.build.nsis.installerLanguages, ["en_US", "zh_CN"], "installer must offer exactly English and Chinese");
assert.equal(pkg.build.productName, "Hymnix Orbit", "product name must be Hymnix Orbit");
assert.equal(pkg.build.appId, "com.hymnix.orbit", "app id must match the Orbit identity");
assert.ok(/scheduler/i.test(pkg.description) && /gateway/i.test(pkg.description), "description must state scheduler + local gateway");
assert.equal(pkg.build.nsis.displayLanguageSelector, true, "installer must show the language selector");
// --- provider adapters: three dialects behind one chat contract -------------
const providers = read("../src/main/providers.ts");
const protocol = read("../src/shared/protocol.ts");
for (const token of ['export type ProviderKind = "openai" | "anthropic" | "openclaw"', "ProviderApi", "ProviderProbeResult"]) {
  assert.ok(protocol.includes(token), `protocol must declare ${token}`);
}
for (const token of ["streamAnthropic", "streamOpenClaw", "toAnthropicMessages", "openClawModel", "probeProvider", '"/v1/messages"']) {
  assert.ok(providers.includes(token) || providers.includes(token.replace(/"/g, "")), `adapter layer missing ${token}`);
}
assert.ok(providers.includes("anthropic-version"), "Anthropic requests must carry anthropic-version");
assert.ok(providers.includes("x-openclaw-agent-id"), "OpenClaw requests must carry the agent header");
assert.ok(!providers.includes('from "./'), "the adapter layer must stay self-contained so the test can import it directly");
assert.ok(main.includes("normalizeKind(value.kind)") && main.includes("streamProvider"), "the main process must dispatch on the provider kind");
assert.ok(main.includes('"provider:probe"') && main.includes('"provider:models"'), "provider probes must be exposed over IPC");
assert.ok(preload.includes("kind: input.kind") && preload.includes("provider: {"), "preload must forward the provider kind");
for (const token of ["PROVIDER_PRESETS", "switchProviderKind", "providerDraft", 'kind: cloudMode ? providerKind : "openai"']) {
  assert.ok(renderer.includes(token), `renderer must wire ${token}`);
}
assert.ok(!renderer.includes('gatewayTab === "Cloud API"'), "the cloud tab is now the API providers tab");
console.log("PASS: secure shell protocol/static contract");
