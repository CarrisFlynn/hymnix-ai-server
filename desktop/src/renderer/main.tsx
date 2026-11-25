import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ApprovalRecord, DesktopApi, GatewayHealth, PluginDescriptor, ProviderKind, ProviderProfile, TerminalBridgeReply, ToolDescriptor } from "../shared/protocol";
import "../styles/index.css";
import "./styles.css";
import "./orbit-v2.css";
import brandIcon from "./assets/hymnix-red-white-star.png";
import { THEMES, readStoredTheme, readStoredMode, applyTheme, persistTheme, persistAppearanceMode, activeMode, selectedTheme, systemMode, type AppearanceMode } from "../theme/themeManager";
import { t, tf, getLang, setLang, translateDom, installAutoTranslate, type Lang } from "./i18n";
import type { ChatMessage } from "./chat";
import { ChatViewport } from "./chat-navigation";
import { pullErrorMessage, trackDownloadProgress } from "./model-download";
import { ModelCatalog } from "./ModelCatalog";
import { DEFAULT_CATALOG_FILTERS, type CatalogFilters } from "./model-catalog";
import { MODEL_CATALOG } from "./model-catalog-data";
import { ModelCombobox, PasswordMeter, QrCode, SkeletonList, ErrorPanel, TooltipLayer, passwordStrength } from "./components";
import { estimateTokens, parseSlashCommand, classifyConnectError, downloadBytes } from "./lib/pure.js";

declare global { interface Window { hymnix: DesktopApi } }

type Message = ChatMessage;
type Entry = { time: string; tag: "sys" | "out" | "err" | "warn"; text: string };
type LocalChatSession = { id: string; name: string; createdAt: string; updatedAt: string; count: number; model: string; draft: string; messages: Message[]; pinned: boolean };
type ModelInfo = { name: string; loaded?: boolean };
type ToolInfo = ToolDescriptor;
type ToolArgs = Record<string, unknown>;
type ToolResult = { status: "idle" | "running" | "approval" | "success" | "error"; message: string; value?: unknown };

const SAFE_TOOL_PRESETS: Record<string, ToolArgs> = {
  "time.now": {},
  sysinfo: {},
  "fs.list": { path: "." },
};

function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(args).map((key) => [key, "[redacted]"]));
}

const ICONS: Record<string, string> = {
  Chat: "M4 5h16v10H9l-4 4V5z",
  Projects: "M3 6h6l2 2h10v10H3z",
  Files: "M6 3h7l4 4v14H6zM13 3v4h4",
  History: "M12 8v5l3 2M4 12a8 8 0 1 0 3-6M4 4v4h4",
  Models: "M4 7h16v10H4zM9 7v10M15 7v10",
  Tools: "M14 4l6 6-9 9H5v-6z",
  Approvals: "M5 12l4 4 9-9",
  Plugins: "M9 4v3M15 4v3M6 7h12v6a6 6 0 0 1-12 0z",
  Terminal: "M5 7l5 4-5 4M12 15h6",
  Monitor: "M4 5h16v10H4zM9 19h6M12 15v4",
  Settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4 12h2M18 12h2M12 4v2M12 18v2",
  Logs: "M6 4h9l3 3v13H6zM9 11h6M9 15h6",
  Support: "M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.2l5.9-.9z",
  Gateway: "M4 12h16M12 4v16M7 7l10 10M17 7L7 17",
  Changelog: "M6 4h12v16H6zM9 8h6M9 12h6M9 16h4",
  Sparkle: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z",
  Plus: "M12 5v14M5 12h14",
  Search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16.5 16.5L21 21",
  Chevron: "M8 10l4 4 4-4",
  Cloud: "M7 18h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 2A3 3 0 0 0 7 18z",
  Link: "M9 15l6-6M8 7l2-2a4 4 0 0 1 6 6l-2 2M16 17l-2 2a4 4 0 0 1-6-6l2-2",
  Chip: "M8 8h8v8H8zM4 9v6M20 9v6M9 4h6M9 20h6"
};
function Icon({ name }: { name: string }) { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[name] || ICONS.Chat} /></svg> }

const navGroups = [
  { title: "WORKSPACE", items: ["Chat", "Models", "Gateway", "Plugins", "Changelog", "Support"] },
  { title: "DEVELOPER", items: ["Monitor", "Terminal"] }
];

/** The two product surfaces, mirroring ChatGPT / Codex: same history, different agent. */
const SURFACES = [
  { id: "ai" as const, label: "Hymnix AI", hint: "General assistant" },
  { id: "orbit" as const, label: "Hymnix Orbit", hint: "Coding agent" }
];

/** Four reasoning stops; the slider moves through this list. */
const EFFORT_LEVELS = [
  { key: "low", label: "Low" },
  { key: "medium", label: "Medium" },
  { key: "high", label: "High" },
  { key: "max", label: "Max" }
] as const;

/** The three tool policies: what the assistant may do without asking. */
const TOOL_POLICIES = [
  { id: "read", label: "Read only", detail: "Read files and look things up. Nothing is changed or executed." },
  { id: "workspace", label: "Workspace writes", detail: "Read and write inside the workspace. No commands, no network." },
  { id: "full", label: "Full access", detail: "Run commands, reach the network and call plugins." }
] as const;

/** Vendor presets for the add-provider form. Only defaults; everything is editable. */
const PROVIDER_CATALOG = [
  { id: "deepseek", label: "DeepSeek", kind: "openai", base: "https://api.deepseek.com/v1", models: ["deepseek-chat", "deepseek-reasoner"] },
  { id: "openai", label: "OpenAI", kind: "openai", base: "https://api.openai.com/v1", models: ["gpt-4.1", "gpt-4.1-mini", "o4-mini"] },
  { id: "anthropic", label: "Anthropic Claude", kind: "anthropic", base: "https://api.anthropic.com", models: ["claude-sonnet-4-5", "claude-haiku-4-5"] },
  { id: "moonshot", label: "Moonshot Kimi", kind: "openai", base: "https://api.moonshot.cn/v1", models: ["kimi-k2-0905-preview", "moonshot-v1-128k"] },
  { id: "zhipu", label: "智谱 GLM", kind: "openai", base: "https://open.bigmodel.cn/api/paas/v4", models: ["glm-4.6", "glm-4.5-air"] },
  { id: "qwen", label: "通义千问", kind: "openai", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", models: ["qwen3-max", "qwen-plus"] },
  { id: "openrouter", label: "OpenRouter", kind: "openai", base: "https://openrouter.ai/api/v1", models: [] },
  { id: "groq", label: "Groq", kind: "openai", base: "https://api.groq.com/openai/v1", models: [] },
  { id: "openclaw", label: "OpenClaw local gateway", kind: "openclaw", base: "http://127.0.0.1:18789", models: ["openclaw/default"] },
  { id: "custom", label: "Custom", kind: "openai", base: "", models: [] }
] as const;

const SLASH_COMMANDS = [
  { name: "/model", detail: "Switch the active model", insert: "/model " },
  { name: "/clear", detail: "Clear this conversation" },
  { name: "/export", detail: "Export the conversation as text" },
  { name: "/system", detail: "Set a system prompt", insert: "/system " },
];

const DEFAULT_UI_SETTINGS = { betaChannel: false, runAtStartup: false, dpiScaling: false, startFullscreen: false, autoUpdate: true, smoothScroll: true, gpuAcceleration: true, cacheDir: "", previewMode: "inapp" as "inapp" | "browser" };

/**
 * The three upstream dialects, in the order the settings page lists them. `note`
 * is an i18n key so the explanation stays bilingual; `base` and `model` are the
 * defaults written the first time someone picks the protocol.
 */
const PROVIDER_PRESETS: Array<{ kind: ProviderKind; label: string; base: string; model: string; note: string; keyHint: string }> = [
  { kind: "openai", label: "OpenAI compatible", base: "https://api.openai.com", model: "gpt-4o-mini", keyHint: "API key", note: "Any endpoint that serves chat completions: OpenAI, DeepSeek, Moonshot, OpenRouter." },
  { kind: "anthropic", label: "Anthropic (Claude Code)", base: "https://api.anthropic.com", model: "claude-sonnet-4-5", keyHint: "API key", note: "The Messages API Claude Code speaks: x-api-key, anthropic-version, content blocks." },
  { kind: "openclaw", label: "OpenClaw", base: "http://127.0.0.1:18789", model: "openclaw/default", keyHint: "Gateway token", note: "OpenClaw gateway on your machine; the model field addresses an agent, not a model id." },
];

function normalizeProviderKind(value: unknown): ProviderKind {
  const text = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (text === "anthropic" || text === "claude" || text === "claudecode") return "anthropic";
  if (text === "openclaw" || text === "claw") return "openclaw";
  return "openai";
}
function providerPreset(kind: ProviderKind) { return PROVIDER_PRESETS.find((item) => item.kind === kind) || PROVIDER_PRESETS[0]; }

function relativeTime(iso?: string): string {
  if (!iso) return "";
  const value = new Date(iso).getTime();
  if (Number.isNaN(value)) return "";
  const minutes = Math.round((Date.now() - value) / 60000);
  if (minutes < 1) return t("just now");
  if (minutes < 60) return tf("{n} min", { n: String(minutes) });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return tf("{n} h", { n: String(hours) });
  return tf("{n} d", { n: String(Math.round(hours / 24)) });
}
function stamp(): string { return new Date().toISOString(); }
function formatDuration(seconds: number | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m ${r}s`;
  if (m) return `${m}m ${r}s`;
  return `${r}s`;
}

type Attachment = { id: string; name: string; size: number; kind: "text" | "image" | "file"; text?: string };

function optionalBool(key: string, fallback = false): boolean {
  try { const value = localStorage.getItem(key); return value == null ? fallback : value === "1"; } catch { return fallback; }
}

type SavedHost = { url: string; name: string; at: string };

function readSavedHosts(): SavedHost[] {
  try {
    const parsed = JSON.parse(localStorage.getItem("hymnix.hosts") || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.url === "string").slice(0, 12) : [];
  } catch { return []; }
}

function catalogSizeGb(name: string): number | null {
  const entry = MODEL_CATALOG.find((item) => item.name === name || item.name === name.replace(/:latest$/, "")) || MODEL_CATALOG.find((item) => item.name + ":latest" === name);
  return entry ? entry.downloadGb : null;
}

type ModelDownload = {
  requestId: string;
  model: string;
  phase: "downloading" | "pausing" | "paused" | "cancelling" | "complete" | "cancelled" | "failed";
  status?: string;
  completed?: number;
  total?: number;
  bytesPerSecond?: number;
  error?: string;
};

function downloadStage(status?: string): string {
  if (status?.startsWith("verifying")) return t("Verifying download");
  if (status?.startsWith("writing") || status?.startsWith("removing") || status === "success") return t("Finalizing download");
  if (status?.startsWith("pulling") && status !== "pulling manifest") return t("Downloading model layers");
  return t("Preparing download");
}

function ModelDownloadFooter({ download, lang, remote, onPause, onResume, onCancel, onDismiss }: {
  download: ModelDownload; lang: Lang; remote: boolean;
  onPause: () => void; onResume: () => void; onCancel: () => void; onDismiss: () => void;
}) {
  const paused = download.phase === "paused";
  const active = download.phase === "downloading" || download.phase === "pausing" || download.phase === "cancelling";
  const title = tf({
    downloading: "Downloading {model}", cancelling: "Cancelling download: {model}",
    pausing: "Pausing download: {model}", paused: "Download paused: {model}",
    complete: "Download complete: {model}", cancelled: "Download cancelled: {model}", failed: "Download failed: {model}",
  }[download.phase], { model: download.model });
  const total = download.total;
  const completed = download.completed;
  const percent = completed != null && total != null && total > 0 ? Math.floor(100 * completed / total) : undefined;
  const rate = download.bytesPerSecond;
  return <footer className="model-download" data-phase={download.phase}>
    <div className="model-download-heading">
      <strong role="status">{title}</strong>
      {download.phase === "downloading" && <button type="button" className="btn" onClick={onPause}>{t("Pause download")}</button>}
      {paused && <button type="button" className="btn primary" onClick={onResume} disabled={remote}>{t("Resume download")}</button>}
      {active || paused
        ? <button type="button" className="btn" onClick={onCancel} disabled={active && download.phase !== "downloading"}>{t("Cancel download")}</button>
        : <button type="button" className="btn" onClick={onDismiss} aria-label={t("Dismiss download notice")}>{t("Close")}</button>}
    </div>
    {(active || paused) && <>
      <progress className="model-download-meter" aria-label={t("Model layer download progress")} max={100} value={percent} />
      <div className="model-download-details">
        <span>{paused ? t(remote ? "Switch to local mode to download models." : "Resume uses available cached layers.") : downloadStage(download.status)}</span>
        <span className="model-download-metrics">
          {percent != null && total != null && completed != null && <>{percent}% · {downloadBytes(completed, lang)} / {downloadBytes(total, lang)}</>}
          {download.phase === "downloading" && rate != null && <>{percent != null && " · "}{tf("{size}/s", { size: downloadBytes(rate, lang) })}</>}
        </span>
      </div>
    </>}
    {download.error && <p className="model-download-error" role="alert">{download.error}</p>}
  </footer>;
}

function readTheme(): string {
  return readStoredTheme();
}

function newSessionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `chat-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function readChatSessions(): LocalChatSession[] {
  try {
    const current = localStorage.getItem("hymnix.chat.sessions.v2");
    if (current) {
      const parsed = JSON.parse(current);
      if (Array.isArray(parsed)) return parsed.filter((item) => item && typeof item.id === "string" && Array.isArray(item.messages)).slice(0, 200);
    }
    const legacy = JSON.parse(localStorage.getItem("hymnix.chat.saved") || "null");
    if (legacy && Array.isArray(legacy.messages)) {
      const at = typeof legacy.at === "string" ? legacy.at : new Date().toISOString();
      return [{ id: String(legacy.id || newSessionId()), name: String(legacy.name || "Untitled session"), createdAt: at, updatedAt: at, count: legacy.messages.length, model: String(legacy.model || ""), draft: "", messages: legacy.messages, pinned: false }];
    }
  } catch { /* ignore unreadable legacy data */ }
  return [];
}

function conversationTitle(messages: Message[], fallback: string): string {
  const first = messages.find((message) => message.role === "user")?.content?.trim();
  return first ? first.replace(/\s+/g, " ").slice(0, 48) : fallback;
}

function writeChatSessions(sessions: LocalChatSession[]): void {
  try {
    const ordered = [...sessions].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 200);
    localStorage.setItem("hymnix.chat.sessions.v2", JSON.stringify(ordered));
    localStorage.setItem("hymnix.chat.history", JSON.stringify(ordered.map(({ id, name, updatedAt, count, model }) => ({ id, name, at: updatedAt, count, model }))));
    const latest = ordered[0];
    if (latest) localStorage.setItem("hymnix.chat.saved", JSON.stringify({ id: latest.id, name: latest.name, at: latest.updatedAt, model: latest.model, messages: latest.messages }));
    else localStorage.removeItem("hymnix.chat.saved");
  } catch { /* Keep in-memory sessions available if storage is full. */ }
}

function App() {
  const initialSessionsRef = useRef<LocalChatSession[] | null>(null);
  if (initialSessionsRef.current === null) initialSessionsRef.current = readChatSessions();
  const [state, setState] = useState("connecting");
  const [active, setActive] = useState("Chat");
  // Any page opened from another page needs a way back. Keep the trail in a ref
  // so going back never pushes itself onto the stack again.
  const navTrailRef = useRef<string[]>([]);
  const activeRef = useRef("Chat");
  const goingBackRef = useRef(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [lang, setLangState] = useState<Lang>(getLang());
  const [theme, setThemeState] = useState<string>(readTheme);
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>(readStoredMode);
  const [workspace, setWorkspace] = useState("Default workspace");
  const [savedSessions, setSavedSessions] = useState<LocalChatSession[]>(() => initialSessionsRef.current || []);
  const [currentSessionId, setCurrentSessionId] = useState(() => initialSessionsRef.current?.[0]?.id || newSessionId());
  const [sessionName, setSessionName] = useState(() => initialSessionsRef.current?.[0]?.name || "New chat");
  // Claude-style layout: the conversation owns the width, settings are a toggle.
  // The right-hand inspector is gone: model and reasoning live in the composer,
  // telemetry in the status bar and the Context tab.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => { try { return localStorage.getItem("hymnix.sidebar.collapsed") === "1"; } catch { return false; } });
  const [historyQuery, setHistoryQuery] = useState("");
  const [modelsTab, setModelsTab] = useState<"Installed" | "Discover" | "Downloads">("Installed");

  const [settingsSection, setSettingsSection] = useState("General");
  const [terminalFilter, setTerminalFilter] = useState("All");
  const [terminalSearch, setTerminalSearch] = useState("");
  const [monitorAutoRefresh, setMonitorAutoRefresh] = useState(false);
  const [toast, setToast] = useState<{ message: string; action?: string; undo?: () => void } | null>(null);
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false);
  const [renamingSession, setRenamingSession] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [clearAllConfirm, setClearAllConfirm] = useState(false);
  const [modelDeleteTarget, setModelDeleteTarget] = useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = useState<boolean>(() => { try { return localStorage.getItem("hymnix.reduceMotion") === "1"; } catch { return false; } });
  const [density, setDensity] = useState<"comfortable" | "compact">(() => { try { return localStorage.getItem("hymnix.density") === "compact" ? "compact" : "comfortable"; } catch { return "comfortable"; } });
  const [textScale, setTextScale] = useState<number>(() => { try { return Math.min(150, Math.max(90, Number(localStorage.getItem("hymnix.textScale") || 100))); } catch { return 100; } });
  const [softenAccent, setSoftenAccent] = useState<boolean>(() => { try { return localStorage.getItem("hymnix.softenAccent") === "1"; } catch { return false; } });
  const [enterSwaps, setEnterSwaps] = useState<boolean>(() => optionalBool("hymnix.enterSwaps"));
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [slashIndex, setSlashIndex] = useState(0);
  const [systemPrompt, setSystemPrompt] = useState<string>(() => { try { return localStorage.getItem("hymnix.systemPrompt") || ""; } catch { return ""; } });
  const [restartKeys, setRestartKeys] = useState<string[]>([]);
  // Never stack the "what's new" card on top of first-run setup: a new user has
  // nothing to compare against, and the setup card is the thing to finish first.
  const [whatsNewOpen, setWhatsNewOpen] = useState<boolean>(() => {
    try {
      if (localStorage.getItem("hymnix.welcome") !== "1") return false;
      return localStorage.getItem("hymnix.whatsNew") !== __APP_VERSION__;
    } catch { return false; }
  });
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const [stopShareConfirm, setStopShareConfirm] = useState(false);
  const [rememberClose, setRememberClose] = useState(true);
  const [hostClients, setHostClients] = useState<any[]>([]);
  const [unloadTarget, setUnloadTarget] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [savedHosts, setSavedHosts] = useState<SavedHost[]>(readSavedHosts);
  const [shareTest, setShareTest] = useState<{ state: "idle" | "testing" | "ok" | "fail"; message: string; category?: string }>({ state: "idle", message: "" });
  const [updateState, setUpdateState] = useState<{ status: "idle" | "checking" | "current" | "available" | "error"; detail: string; url: string }>({ status: "idle", detail: "", url: "" });
  // ---- Codex-style shell state -------------------------------------------
  const [surface, setSurface] = useState<"ai" | "orbit">(() => { try { return localStorage.getItem("hymnix.surface") === "orbit" ? "orbit" : "ai"; } catch { return "ai"; } });
  const [productMenuOpen, setProductMenuOpen] = useState(false);
  const [chatTab, setChatTab] = useState<"chat" | "context" | "trace">("chat");
  const [modelsSection, setModelsSection] = useState<"local" | "api" | "remote">("local");
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [activeProviderId, setActiveProviderId] = useState("");
  const [providersBusy, setProvidersBusy] = useState(false);
  const [providerError, setProviderError] = useState("");
  const [toolPolicy, setToolPolicy] = useState<"read" | "workspace" | "full">("workspace");
  const [policyMenu, setPolicyMenu] = useState(false);
  const [effortDrag, setEffortDrag] = useState<number | null>(null);
  const [modelPopover, setModelPopover] = useState<"closed" | "root" | "models">("closed");
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
  const [changelog, setChangelog] = useState<Array<{ version: string; date: string; groups: Array<{ title: string; items: string[] }> }>>([]);
  const [todayUsage, setTodayUsage] = useState<{ messages: number; tokens: number }>({ messages: 0, tokens: 0 });
  const [modelQuery, setModelQuery] = useState("");
  const [providerForm, setProviderForm] = useState<null | {
    id: string; label: string; kind: string; base_url: string; api_key: string; models: string[];
    max_effort: boolean; agent_id: string; max_tokens: number;
    tab: "catalog" | "custom"; catalogId: string; modelDraft: string;
  }>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const transport = useRef<{ startedAt: number; chars: number; reasoningStartedAt: number | null; reasoningMs: number }>({ startedAt: 0, chars: 0, reasoningStartedAt: null, reasoningMs: 0 });
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dropActive, setDropActive] = useState(false);
  const terminalSearchRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"local" | "remote">("local");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [remoteKey, setRemoteKey] = useState("");
  const [startupNote, setStartupNote] = useState("");
  const [role, setRole] = useState<"host" | "guest">("host");
  const [serverBase, setServerBase] = useState("http://127.0.0.1:11435");
  const [gatewayBase, setGatewayBase] = useState("http://127.0.0.1:11435");
  const [hostName, setHostName] = useState("");
  const [hostPassword, setHostPassword] = useState("");
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [tunnelState, setTunnelState] = useState("off");
  const [tunnelLog, setTunnelLog] = useState<string[]>([]);
  const tunnelLogRef = useRef<string[]>([]);
  const [guestName, setGuestName] = useState("");
  const [guestPassword, setGuestPassword] = useState("");
  const [netBusy, setNetBusy] = useState(false);
  const [effort, setEffort] = useState("medium");
  // One page, two jobs: a plain conversation, or a coding session that leans on
  // the workspace. The mode only changes the system prompt, so every existing
  // control (attachments, slash commands, stop, terminal) keeps working.
  const [composerMode, setComposerMode] = useState<"chat" | "code">("chat");
  const [uiSettings, setUiSettings] = useState(DEFAULT_UI_SETTINGS);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [stars, setStars] = useState<number | null>(null);
  const [source, setSource] = useState<"local" | "cloud">("local");
  const [cloudBase, setCloudBase] = useState("");
  const [cloudModel, setCloudModel] = useState("");
  const [cloudKey, setCloudKey] = useState("");
  const [cloudMasked, setCloudMasked] = useState("");
  const [cloudStatus, setCloudStatus] = useState("");
  // Which wire protocol the remote provider speaks. The chat pipeline stays the
  // same; only the adapter in the main process changes.
  const [providerKind, setProviderKind] = useState<ProviderKind>("openai");
  const [agentId, setAgentId] = useState("");
  const [providerMaxTokens, setProviderMaxTokens] = useState(0);
  const [providerModels, setProviderModels] = useState<string[]>([]);
  const [providerBusy, setProviderBusy] = useState(false);
  const sessions = savedSessions.map(({ id, name, updatedAt, count, model, pinned }) => ({ id, name, at: updatedAt, count, model, pinned }));
  const todayKey = new Date().toDateString();
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toDateString();
  const pinnedSessions = sessions.filter((item) => item.pinned);
  const todaySessions = sessions.filter((item) => !item.pinned && new Date(item.at).toDateString() === todayKey);
  const yesterdaySessions = sessions.filter((item) => !item.pinned && new Date(item.at).toDateString() === yesterdayKey);
  const olderSessions = sessions.filter((item) => !item.pinned && new Date(item.at).toDateString() !== todayKey && new Date(item.at).toDateString() !== yesterdayKey);
  const [stats, setStats] = useState<{ gpu: number | null; vramUsed: number | null; vramTotal: number | null; ramUsed: number; ramTotal: number; ai: number | null } | null>(null);
  const [netError, setNetError] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [diskFree, setDiskFree] = useState<number | null>(null);
  const [paths, setPaths] = useState<{ cache: string; cacheDefault: string; appData: string; workspace: string } | null>(null);

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState("");
  const selectedLocalModel = models.find((item) => item.name === model);
  const [modelBusy, setModelBusy] = useState("");
  const [download, setDownload] = useState<ModelDownload | null>(null);
  const downloadRequest = useRef<string | null>(null);
  const downloadStop = useRef<"pause" | "cancel" | null>(null);
  const pausedModel = useRef<string | null>(null);
  const downloadOccupied = download != null && ["downloading", "pausing", "paused", "cancelling"].includes(download.phase);
  const [pullName, setPullName] = useState("");
  const [modelNote, setModelNote] = useState("");
  const [catalogFilters, setCatalogFilters] = useState<CatalogFilters>(DEFAULT_CATALOG_FILTERS);

  const [draft, setDraft] = useState(() => initialSessionsRef.current?.[0]?.draft || "");
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      if (localStorage.getItem("hymnix.demo") === "1") {
        localStorage.removeItem("hymnix.demo");
        const tick = String.fromCharCode(96);
        const fence = tick + tick + tick;
        return [
          { role: "user", content: "Give me a short Python example.", at: "12:02" },
          { role: "assistant", content: "**Working with paths**\n- Uses " + tick + "pathlib" + tick + "\n- Runs as-is\n\n" + fence + "python\nfrom pathlib import Path\nprint(Path.cwd())\n" + fence + "\nDocs: https://python.org", at: "12:02" },
          { role: "user", content: "How does long text wrap inside a bubble?", at: "12:03" },
          { role: "assistant", content: "This is a longer demo paragraph used to check left alignment, the maximum bubble width and multi-line wrapping inside the assistant card.", at: "12:03" }
        ] as Message[];
      }
    } catch { /* ignore */ }
    return initialSessionsRef.current?.[0]?.messages || [];
  });
  const [error, setError] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const requestRef = useRef<string | null>(null);
  const [followSignal, setFollowSignal] = useState(0);

  const [health, setHealth] = useState<GatewayHealth | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [ollamaBusy, setOllamaBusy] = useState(false);
  const [ollamaError, setOllamaError] = useState("");
  const healthRequest = useRef(0);
  const modelRequest = useRef(0);
  const lastHealth = useRef<GatewayHealth | null>(null);
  const [filesRoot, setFilesRoot] = useState("");
  const [fileEntries, setFileEntries] = useState<any[]>([]);
  const [fileQuery, setFileQuery] = useState("");
  const [fileHits, setFileHits] = useState<any[]>([]);
  const [fileText, setFileText] = useState("");
  const [filesBusy, setFilesBusy] = useState(false);
  const [filesError, setFilesError] = useState("");
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [toolsBusy, setToolsBusy] = useState(false);
  const [toolsError, setToolsError] = useState("");
  const [plugins, setPlugins] = useState<PluginDescriptor[]>([]);
  const [pluginsBusy, setPluginsBusy] = useState(false);
  const [pluginsError, setPluginsError] = useState("");
  const [pluginActionBusy, setPluginActionBusy] = useState("");
  const [pluginDeleteTarget, setPluginDeleteTarget] = useState<PluginDescriptor | null>(null);
  const [selectedTool, setSelectedTool] = useState("");
  const [toolCall, setToolCall] = useState<ToolResult>({ status: "idle", message: "" });
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [approvalsBusy, setApprovalsBusy] = useState(false);
  const [approvalsError, setApprovalsError] = useState("");

  const [history, setHistory] = useState<any[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [statusData, setStatusData] = useState<any>(null);
  const [statusError, setStatusError] = useState("");
  const [logItems, setLogItems] = useState<any[]>([]);
  const [logError, setLogError] = useState("");

  const [termCmd, setTermCmd] = useState("");
  const [termEntries, setTermEntries] = useState<Entry[]>([]);
  const [bridgeConnection, setBridgeConnection] = useState<{ endpoint: string; token: string } | null>(null);
  const [bridgeReplies, setBridgeReplies] = useState<TerminalBridgeReply[]>([]);
  const bridgeBusy = useRef(false);
  const [termBusy, setTermBusy] = useState(false);
  const termId = useRef("");
  const termHistory = useRef<string[]>([]);
  const termCursor = useRef(0);

  async function loadTools() {
    setToolsBusy(true); setToolsError("");
    try {
      const result = await window.hymnix.tools.list();
      setTools(result.tools);
    } catch (reason) {
      setTools([]);
      setToolsError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setToolsBusy(false);
    }
  }
  async function loadPlugins(): Promise<void> {
    setPluginsBusy(true); setPluginsError("");
    try {
      const result = await window.hymnix.plugins.list();
      if (!result.ok || !Array.isArray(result.plugins)) throw new Error(t("Plugin response was invalid"));
      const valid = result.plugins.every((item) => item && typeof item.id === "string" && typeof item.name === "string" &&
        typeof item.version === "string" && typeof item.apiVersion === "string" && typeof item.author === "string" && typeof item.description === "string" &&
        Array.isArray(item.permissions) && item.permissions.every((value) => typeof value === "string") &&
        Array.isArray(item.granted) && item.granted.every((value) => typeof value === "string") &&
        Array.isArray(item.capabilities) && item.capabilities.every((value) => typeof value === "string") &&
        typeof item.enabled === "boolean" && typeof item.loaded === "boolean" && typeof item.source === "string" && typeof item.error === "string");
      if (!valid) throw new Error(t("Plugin response was invalid"));
      setPlugins(result.plugins);
    } catch (reason) {
      setPlugins([]);
      setPluginsError(reason instanceof Error ? reason.message : String(reason));
    } finally { setPluginsBusy(false); }
  }
  async function installPlugin(): Promise<void> {
    setPluginsError(""); setPluginActionBusy("install");
    try {
      const result = await window.hymnix.plugins.install();
      if (result.canceled) return;
      if (!result.ok) throw new Error(result.error || t("Plugin installation failed"));
      await loadPlugins();
      setToast({ message: t("Plugin installed disabled; review its permissions before enabling." ) });
    } catch (reason) { setPluginsError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPluginActionBusy(""); }
  }
  async function changePlugin(action: "grant" | "revoke" | "enable" | "disable" | "load" | "unload" | "reload", id: string, permission?: string): Promise<void> {
    setPluginsError(""); setPluginActionBusy(id);
    try {
      const result = await window.hymnix.plugins.action({ action, id, ...(permission ? { permission } : {}) });
      if (!result.ok) throw new Error(result.detail || result.error || t("Plugin action failed"));
      await loadPlugins();
      setToast({ message: t(action === "enable" ? "Plugin enabled" : action === "disable" ? "Plugin disabled" : action === "grant" ? "Permission granted" : action === "revoke" ? "Permission revoked; plugin stopped." : "Plugin updated") });
    } catch (reason) { setPluginsError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPluginActionBusy(""); }
  }
  async function uninstallPlugin(): Promise<void> {
    const target = pluginDeleteTarget;
    if (!target) return;
    setPluginDeleteTarget(null); setPluginsError(""); setPluginActionBusy(target.id);
    try {
      const result = await window.hymnix.plugins.action({ action: "uninstall", id: target.id });
      if (!result.ok) throw new Error(result.error || t("Plugin uninstall failed"));
      await loadPlugins();
      setToast({ message: t("Plugin uninstalled") });
    } catch (reason) { setPluginsError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPluginActionBusy(""); }
  }
  function remoteActive(): boolean { return mode === "remote" && !!serverBase.trim(); }
  async function invokeSelectedTool(): Promise<void> {
    const args = selectedTool ? SAFE_TOOL_PRESETS[selectedTool] : undefined;
    if (!selectedTool || !args) { setToolCall({ status: "error", message: t("Select a safe tool first") }); return; }
    setToolCall({ status: "running", message: t("Running safe tool...") });
    try {
      const result = await window.hymnix.tools.call({ requestId: crypto.randomUUID(), tool: selectedTool, args });
      if (result.approval_required) {
        setToolCall({ status: "approval", message: t("Approval required"), value: result.approval_required });
        await refreshApprovals();
      } else if (result.ok) {
        setToolCall({ status: "success", message: t("Tool completed"), value: result.result });
      } else {
        setToolCall({ status: "error", message: result.error?.message || t("Tool failed") });
      }
    } catch (reason) { setToolCall({ status: "error", message: reason instanceof Error ? reason.message : String(reason) }); }
  }
  async function refreshApprovals(): Promise<void> {
    setApprovalsBusy(true); setApprovalsError("");
    try { const result = await window.hymnix.tools.pending(); setApprovals(result.approvals || []); }
    catch (reason) { setApprovalsError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setApprovalsBusy(false); }
  }
  async function decideApproval(id: string, decision: "approve" | "deny"): Promise<void> {
    setApprovalsBusy(true); setApprovalsError("");
    try {
      const result = decision === "approve" ? await window.hymnix.tools.approve(id) : await window.hymnix.tools.deny(id);
      if (!result.ok) throw new Error(result.error?.message || t("Approval decision failed"));
      setApprovals((current) => current.filter((item) => item.id !== id));
      setToolCall({ status: decision === "approve" ? "success" : "error", message: decision === "approve" ? t("Approved") : t("Denied") });
      await refreshApprovals();
    } catch (reason) { setApprovalsError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setApprovalsBusy(false); }
  }
  async function loadHealth(forceModels = false) {
    const id = ++healthRequest.current;
    const remote = remoteActive();
    try {
      const h = remote
        ? await window.hymnix.network.get(serverBase.trim(), "/health", apiKey) as GatewayHealth
        : await window.hymnix.gateway.health();
      const info = remote ? null : await window.hymnix.bootstrap();
      if (id !== healthRequest.current) return;
      if (info) setGatewayBase(info.base);
      const previous = lastHealth.current;
      lastHealth.current = h;
      setHealth(h);
      setState(h.ok && h.ollama !== false ? "ready" : "degraded");
      setConnectionError("");
      if (h.ollama === true && previous?.ollama !== true) {
        setOllamaError("");
        if (previous?.ollama === false && !remote) setError("");
      }
      if (h.ok && h.ollama !== false && (forceModels || !previous?.ok || previous.ollama !== h.ollama || previous.models !== h.models)) {
        await loadModels();
      } else if (h.ollama === false && previous?.ollama !== false) {
        ++modelRequest.current;
        setModels([]);
      }
    } catch (reason) {
      if (id !== healthRequest.current) return;
      lastHealth.current = null;
      setHealth(null);
      setState("error");
      setConnectionError(reason instanceof Error ? reason.message : String(reason));
    }
  }
  async function loadModels() {
    const id = ++modelRequest.current;
    const remote = remoteActive();
    try {
      const result = remote
        ? await window.hymnix.network.get(serverBase.trim(), "/api/tags", apiKey) as { models?: Array<{ name?: string; model?: string; loaded?: boolean }> }
        : await window.hymnix.models.list();
      if (id !== modelRequest.current) return;
      const list: ModelInfo[] = (result?.models ?? []).map((item) => ({
        name: item.name || ("model" in item ? String(item.model || "") : ""), loaded: !!item.loaded,
      })).filter((item) => item.name);
      setModels(list);
      setModel((current) => list.some((item) => item.name === current) ? current : list[0]?.name || "");
    } catch (reason) {
      if (id === modelRequest.current) setModelNote(reason instanceof Error ? reason.message : String(reason));
    }
  }
  async function startOllama() {
    if (ollamaBusy) return;
    setOllamaBusy(true);
    setOllamaError("");
    try {
      const result = await window.hymnix.ollama.control("start");
      if (result.ok !== true || (result.ready !== true && result.online !== true)) {
        const messages: Record<string, string> = {
          ollama_not_installed: t("Ollama was not found. Install Ollama and retry."),
          ollama_not_local: t("The configured Ollama endpoint is remote."),
          ollama_start_timeout: t("Ollama did not become ready before the startup deadline."),
          gateway_stopping: t("Gateway is stopping."),
        };
        throw new Error(messages[result.code ?? result.error ?? ""] || result.detail || result.error || t("Ollama did not become ready."));
      }
      await loadHealth(true);
    } catch (reason) {
      setOllamaError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOllamaBusy(false);
    }
  }
  const remoteBase = mode === "remote" ? serverBase.trim() : "";
  const remoteToken = mode === "remote" ? apiKey : "";
  useEffect(() => {
    lastHealth.current = null;
    setHealth(null);
    setModels([]);
    setConnectionError("");
    setState("starting");
    let stopped = false;
    let timer: number;
    const tick = async () => {
      await loadHealth();
      if (!stopped) timer = window.setTimeout(tick, lastHealth.current?.ollama === true ? 5000 : 1500);
    };
    void tick();
    return () => {
      stopped = true;
      ++healthRequest.current;
      ++modelRequest.current;
      window.clearTimeout(timer);
    };
  }, [mode, remoteBase, remoteToken]);
  useEffect(() => { void loadCloud(); void window.hymnix.settings.get().then((value) => setUiSettings({ ...DEFAULT_UI_SETTINGS, ...value })).catch(() => undefined); }, []);
  useEffect(() => { void window.hymnix.github.stars().then((value) => setStars(value?.stars ?? null)).catch(() => undefined); }, []);
  useEffect(() => { document.documentElement.style.scrollBehavior = uiSettings.smoothScroll ? "smooth" : "auto"; }, [uiSettings.smoothScroll]);
  useEffect(() => {
    if (active !== "Gateway" && active !== "Monitor") return;
    void pollTunnel();
    void loadHostClients();
    const timer = window.setInterval(() => { void pollTunnel(); void loadHostClients(); }, 2000);
    return () => window.clearInterval(timer);
  }, [active]);
  useEffect(() => {
    if (active !== "Monitor" || !monitorAutoRefresh) return;
    const timer = window.setInterval(() => { void loadHealth(); if (adminKey.trim()) void loadStatus(); }, 5000);
    return () => window.clearInterval(timer);
  }, [active, monitorAutoRefresh, adminKey]);
  useEffect(() => {
    let alive = true;
    const tick = async () => { try { const next = await window.hymnix.system.stats(); if (alive) setStats(next); } catch { /* ignore */ } };
    void tick();
    const timer = window.setInterval(() => void tick(), 3000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => { const mode = THEMES.find((item) => item.id === theme)?.mode || (appearanceMode === "auto" ? systemMode() : appearanceMode); applyTheme(theme, mode); }, [theme, appearanceMode]);
  useEffect(() => { if (active === "Plugins") void loadPlugins(); }, [active]);
  useEffect(() => {
    const previous = activeRef.current;
    if (previous === active) { goingBackRef.current = false; return; }
    activeRef.current = active;
    if (goingBackRef.current) goingBackRef.current = false;
    else navTrailRef.current = [...navTrailRef.current.slice(-9), previous];
    setCanGoBack(navTrailRef.current.length > 0);
  }, [active]);
  useEffect(() => {
    const backgroundColor = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    void window.hymnix.window.setAppearance(appearanceMode, backgroundColor);
  }, [appearanceMode, theme]);
  useEffect(() => {
    if (appearanceMode !== "auto") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => { const next = selectedTheme(); setThemeState(next); applyTheme(next, media.matches ? "dark" : "light"); };
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [appearanceMode]);
  useEffect(() => { document.documentElement.dataset.density = density; }, [density]);
  useEffect(() => { document.documentElement.dataset.reduceMotion = reduceMotion ? "true" : "false"; }, [reduceMotion]);
  useEffect(() => { document.documentElement.dataset.softenAccent = softenAccent ? "true" : "false"; try { localStorage.setItem("hymnix.softenAccent", softenAccent ? "1" : "0"); } catch { /* private mode */ } }, [softenAccent]);
  useEffect(() => {
    document.documentElement.style.setProperty("--text-scale", String(textScale / 100));
    // Layout relaxes fixed row heights once text is large, so 200% stays usable.
    document.documentElement.dataset.textScale = textScale >= 150 ? "large" : "normal";
  }, [textScale]);
  useEffect(() => { try { localStorage.setItem("hymnix.sidebar.collapsed", sidebarCollapsed ? "1" : "0"); } catch { /* private mode */ } }, [sidebarCollapsed]);
  useEffect(() => { try { localStorage.setItem("hymnix.enterSwaps", enterSwaps ? "1" : "0"); } catch { /* private mode */ } }, [enterSwaps]);
  useEffect(() => { try { localStorage.setItem("hymnix.systemPrompt", systemPrompt); } catch { /* private mode */ } }, [systemPrompt]);
  useEffect(() => {
    void window.hymnix.credentials?.get("adminKey").then((value) => { if (value) setAdminKey(value); }).catch(() => undefined);
  }, []);
  useEffect(() => { void loadProviders(); void loadToolPolicy(); }, []);
  useEffect(() => {
    // The release notes come straight from CHANGELOG.md, packaged beside the app.
    void window.hymnix.changelog.get().then((result) => {
      if (!result?.ok || !result.text) return;
      const releases: Array<{ version: string; date: string; groups: Array<{ title: string; items: string[] }> }> = [];
      let current: (typeof releases)[number] | null = null;
      let group: { title: string; items: string[] } | null = null;
      for (const line of result.text.split(/\r?\n/)) {
        const heading = /^##\s+(.+?)\s*$/.exec(line);
        if (heading) {
          const raw = heading[1];
          if (/^unreleased/i.test(raw)) { current = null; group = null; continue; }
          const parts = raw.split(/\s+[—-]\s+/);
          current = { version: parts[0].replace(/^\[|\]$/g, ""), date: parts[1] || "", groups: [] };
          releases.push(current);
          group = null;
          continue;
        }
        const sub = /^###\s+(.+?)\s*$/.exec(line);
        if (sub && current) { group = { title: sub[1], items: [] }; current.groups.push(group); continue; }
        const item = /^[-*]\s+(.+)$/.exec(line);
        if (item && group) group.items.push(item[1].replace(/\*\*/g, ""));
      }
      setChangelog(releases.filter((release) => release.groups.length > 0).slice(0, 8));
    }).catch(() => undefined);
  }, []);
  // Any click outside the composer closes the model panel: a popover must never
  // survive a click on the page, a tab switch or a keystroke into the message box.
  useEffect(() => {
    if (modelPopover === "closed") return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && target.closest(".composer")) return;
      setModelPopover("closed");
    };
    const onKeyDown = () => setModelPopover("closed");
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [modelPopover]);
  useEffect(() => { setModelPopover("closed"); setConversationMenuOpen(false); }, [active]);
  // Sidebar footer: what this machine did today, straight from the saved sessions.
  useEffect(() => {
    const today = new Date().toDateString();
    let messages = 0;
    let tokens = 0;
    for (const session of savedSessions) {
      if (new Date(session.updatedAt).toDateString() !== today) continue;
      messages += session.count || 0;
      tokens += estimateTokens((session.messages || []).map((item) => item.content).join(" "));
    }
    setTodayUsage({ messages, tokens });
  }, [savedSessions]);
  useEffect(() => { try { localStorage.setItem("hymnix.surface", surface); } catch { /* private mode */ } }, [surface]);
  // The surface sets the default working mode: Orbit is the coding agent.
  useEffect(() => { setComposerMode(surface === "orbit" ? "code" : "chat"); }, [surface]);
  useEffect(() => {
    void window.hymnix.system.disk("").then((info) => setDiskFree(info?.free ?? null)).catch(() => undefined);
  }, []);
  useEffect(() => {
    void window.hymnix.system.paths().then(setPaths).catch(() => undefined);
  }, [uiSettings.cacheDir]);
  // Playwright visual baselines drive pages and themes through this hook.
  useEffect(() => {
    (window as any).__hymnixDev = {
      navigate: (page: string) => setActive(page),
      applyTheme: (id: string) => changeTheme(id),
      setSettingsSection: (section: string) => { setActive("Settings"); setSettingsSection(section); },
      setLanguage: (next: Lang) => changeLang(next),
      version: __APP_VERSION__,
      // Visual baselines must not include first-run or "what's new" overlays.
      dismissOverlays: () => {
        try {
          localStorage.setItem("hymnix.welcome", "1");
          localStorage.setItem("hymnix.whatsNew", __APP_VERSION__);
        } catch { /* private mode */ }
        setWhatsNewOpen(false);
        setQrOpen(false);
        setClosePromptOpen(false);
        setStopShareConfirm(false);
        setUnloadTarget(null);
      },
    };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (clearAllConfirm || modelDeleteTarget || pluginDeleteTarget) {
        if (event.key === "Escape") { event.preventDefault(); setClearAllConfirm(false); setModelDeleteTarget(null); setPluginDeleteTarget(null); }
        return;
      }
      if (event.altKey && event.key === "ArrowLeft") { event.preventDefault(); goBack(); return; }
      if (mod && key === "f" && active === "Terminal") { event.preventDefault(); terminalSearchRef.current?.focus(); terminalSearchRef.current?.select(); return; }
      if (mod && key === "n") { event.preventDefault(); createSession(); return; }
      if (mod && key === "b") { event.preventDefault(); setSidebarCollapsed((value) => !value); return; }
      if (mod && key === ".") { event.preventDefault(); setModelPopover((value) => (value === "closed" ? "root" : "closed")); return; }
      if (mod && key === ",") { event.preventDefault(); setActive("Settings"); return; }
      if (mod && key === "l") { event.preventDefault(); setActive("Chat"); window.setTimeout(() => composerRef.current?.focus(), 0); return; }
      if (mod && key === "/") { event.preventDefault(); setActive("Settings"); setSettingsSection("Shortcuts"); return; }
      if (mod && event.shiftKey && key === "c") { event.preventDefault(); void copyLastReply(); return; }
      if (mod && event.shiftKey && key === "e") { event.preventDefault(); exportChat(); return; }
      if (mod && /^[1-5]$/.test(key)) { event.preventDefault(); setActive(["Chat", "Models", "Gateway", "Monitor", "Terminal"][Number(key) - 1]); return; }
      if (event.key === "Escape") {
        // One Escape is one layer. The shortcut sheet promises "close or stop",
        // but only three dialogs ever listened.
        if (qrOpen) { event.preventDefault(); setQrOpen(false); return; }
        if (conversationMenuOpen) { event.preventDefault(); setConversationMenuOpen(false); return; }
        if (renamingSession) { event.preventDefault(); setRenamingSession(false); return; }
        if (previewOpen) { event.preventDefault(); void closePreview(); return; }
        if (stopShareConfirm) { event.preventDefault(); setStopShareConfirm(false); return; }
        if (modelPopover !== "closed") { event.preventDefault(); setModelPopover("closed"); return; }
        if (requestRef.current) { event.preventDefault(); cancel(); return; }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, clearAllConfirm, modelDeleteTarget, pluginDeleteTarget, qrOpen, conversationMenuOpen, renamingSession, previewOpen, stopShareConfirm, modelPopover]);
  useEffect(() => {
    if (!messages.length && !draft.trim() && !savedSessions.some((item) => item.id === currentSessionId)) return;
    const timer = window.setTimeout(() => {
      const now = new Date().toISOString();
      const title = sessionName === "New chat" || sessionName === "Untitled session" ? conversationTitle(messages, t("New chat")) : sessionName;
      if (title !== sessionName) setSessionName(title);
      setSavedSessions((current) => {
        const previous = current.find((item) => item.id === currentSessionId);
        const record: LocalChatSession = {
          id: currentSessionId, name: title, createdAt: previous?.createdAt || now, updatedAt: now,
          count: messages.length, model, draft, messages, pinned: previous?.pinned || false,
        };
        // Keep the row where it is while the user types or reopens it; only a new
        // message (count went up) moves the conversation to the top.
        const moved = !previous || record.count > (previous.count || 0);
        const next = (moved
          ? [record, ...current.filter((item) => item.id !== currentSessionId)]
          : current.map((item) => (item.id === currentSessionId ? record : item))).slice(0, 200);
        writeChatSessions(next);
        return next;
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [messages, draft, model, currentSessionId, sessionName, savedSessions.length]);
  useEffect(() => { installAutoTranslate(); }, [lang]);
  useEffect(() => { translateDom(); }, [active, messages, models, state, error, termEntries, fileText, history]);
  useEffect(() => {
    const offOut = window.hymnix.terminal.onOutput((event: any) => {
      if (event.id !== termId.current) return;
      setTermEntries((current) => [...current, { time: stamp(), tag: event.stream === "stderr" ? "err" : "out", text: String(event.text || "").replace(/\n$/, "") }]);
    });
    const offDone = window.hymnix.terminal.onComplete((event: any) => {
      if (event.id !== termId.current) return;
      setTermBusy(false);
      setTermEntries((current) => [...current, { time: stamp(), tag: event.error ? "err" : "sys", text: event.error ? event.error.message : "[exit " + (event.code ?? "?") + "]" }]);
    });
    return () => { offOut(); offDone(); };
  }, []);

  function changeLang(next: Lang) { setLang(next); setLangState(next); }
  // Exactly one theme card carries a tick. Picking a light theme unticks the dark
  // row and vice versa, because there is only one active theme at a time.
  function goBack(): void {
    const target = navTrailRef.current[navTrailRef.current.length - 1];
    if (!target) return;
    navTrailRef.current = navTrailRef.current.slice(0, -1);
    goingBackRef.current = true;
    setCanGoBack(navTrailRef.current.length > 0);
    setActive(target);
  }
  function changeTheme(next: string) {
    // Picking a theme also picks its mode: in Auto, choosing Neon black while
    // Windows is light used to do nothing visible because Auto kept resolving to
    // the light theme. Explicit choice wins, same as VS Code and macOS.
    const definition = THEMES.find((item) => item.id === next);
    let preferences = persistTheme(next);
    if (definition && activeMode(preferences) !== definition.mode) preferences = persistAppearanceMode(definition.mode);
    const effectiveMode = activeMode(preferences);
    const effectiveTheme = selectedTheme(preferences);
    setAppearanceMode(preferences.mode);
    setThemeState(effectiveTheme);
    applyTheme(effectiveTheme, effectiveMode);
  }
  function changeAppearanceMode(next: AppearanceMode) {
    const preferences = persistAppearanceMode(next);
    setAppearanceMode(next);
    const id = selectedTheme(preferences);
    setThemeState(id);
    applyTheme(id, activeMode(preferences));
  }
  function setDensityPreference(next: "comfortable" | "compact") { setDensity(next); try { localStorage.setItem("hymnix.density", next); } catch { /* private mode */ } }
  function setMotionPreference(next: boolean) { setReduceMotion(next); try { localStorage.setItem("hymnix.reduceMotion", next ? "1" : "0"); } catch { /* private mode */ } }
  function setTextScalePreference(next: number) { const value = Math.min(150, Math.max(90, next)); setTextScale(value); try { localStorage.setItem("hymnix.textScale", String(value)); } catch { /* private mode */ } }

  function persistCurrentSession(): void {
    if (!messages.length && !draft.trim()) return;
    const current = savedSessions.find((item) => item.id === currentSessionId);
    const now = new Date().toISOString();
    const title = sessionName === "New chat" || sessionName === "Untitled session" ? conversationTitle(messages, t("New chat")) : sessionName;
    const record: LocalChatSession = { id: currentSessionId, name: title, createdAt: current?.createdAt || now, updatedAt: now, count: messages.length, model, draft, messages, pinned: current?.pinned || false };
    const next = [record, ...savedSessions.filter((item) => item.id !== currentSessionId)].slice(0, 200);
    if (title !== sessionName) setSessionName(title);
    setSavedSessions(next); writeChatSessions(next);
  }

  function createSession(): void {
    cancel();
    persistCurrentSession();
    startFreshSession();
  }
  function startFreshSession(): void {
    cancel();
    const id = newSessionId();
    setCurrentSessionId(id);
    setSessionName(t("New chat"));
    setMessages([]); setDraft(""); setEditingMessageIndex(null); setError(""); setFollowSignal((value) => value + 1);
    setActive("Chat");
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }
  function openSession(id: string): void {
    if (id === currentSessionId) { setActive("Chat"); return; }
    cancel();
    persistCurrentSession();
    const record = savedSessions.find((item) => item.id === id);
    if (!record) return;
    setCurrentSessionId(record.id); setSessionName(record.name); setMessages(record.messages); setDraft(record.draft || ""); setEditingMessageIndex(null); setModel(record.model || "");
    setActive("Chat"); setFollowSignal((value) => value + 1);
  }
  function togglePinSession(id: string): void {
    setSavedSessions((current) => {
      const next = current.map((item) => item.id === id ? { ...item, pinned: !item.pinned, updatedAt: new Date().toISOString() } : item);
      writeChatSessions(next); return next;
    });
  }
  function clearCurrentConversation(): void {
    const previousMessages = messages;
    const previousDraft = draft;
    const previousId = currentSessionId;
    const previousName = sessionName;
    const previousSessions = savedSessions;
    cancel();
    const nextId = newSessionId();
    setCurrentSessionId(nextId); setSessionName(t("New chat")); setMessages([]); setDraft(""); setEditingMessageIndex(null); setError("");
    setSavedSessions((current) => { const next = current.filter((item) => item.id !== previousId); writeChatSessions(next); return next; });
    setFollowSignal((value) => value + 1);
    setToast({ message: t("Conversation cleared"), action: t("Undo"), undo: () => {
      setCurrentSessionId(previousId); setSessionName(previousName); setMessages(previousMessages); setDraft(previousDraft);
      setSavedSessions(previousSessions); writeChatSessions(previousSessions); setFollowSignal((value) => value + 1); setToast(null);
    } });
    window.setTimeout(() => setToast((current) => current?.message === t("Conversation cleared") ? null : current), 10000);
  }
  function beginRenameSession(): void { setConversationMenuOpen(false); setRenameDraft(sessionName); setRenamingSession(true); }
  function commitRenameSession(): void {
    const name = renameDraft.trim().slice(0, 80);
    if (!name) { setRenamingSession(false); return; }
    const previous = savedSessions.find((item) => item.id === currentSessionId);
    const now = new Date().toISOString();
    const record: LocalChatSession = { id: currentSessionId, name, createdAt: previous?.createdAt || now, updatedAt: now, count: messages.length, model, draft, messages, pinned: previous?.pinned || false };
    const next = [record, ...savedSessions.filter((item) => item.id !== currentSessionId)];
    setSessionName(name); setSavedSessions(next); writeChatSessions(next); setRenamingSession(false);
  }
  function toggleCurrentPin(): void {
    const previous = savedSessions.find((item) => item.id === currentSessionId);
    const now = new Date().toISOString();
    const record: LocalChatSession = { id: currentSessionId, name: sessionName, createdAt: previous?.createdAt || now, updatedAt: now, count: messages.length, model, draft, messages, pinned: !previous?.pinned };
    const next = [record, ...savedSessions.filter((item) => item.id !== currentSessionId)];
    setSavedSessions(next); writeChatSessions(next);
    setToast({ message: t(record.pinned ? "Conversation pinned" : "Conversation unpinned") });
    window.setTimeout(() => setToast(null), 2200);
  }
  function deleteSession(id: string): void {
    const removed = savedSessions.find((item) => item.id === id);
    setSavedSessions((current) => { const next = current.filter((item) => item.id !== id); writeChatSessions(next); return next; });
    setToast({ message: t("Conversation deleted"), action: t("Undo"), undo: () => { if (removed) setSavedSessions((current) => { const next = [removed, ...current.filter((item) => item.id !== removed.id)]; writeChatSessions(next); return next; }); setToast(null); } });
    if (id === currentSessionId) startFreshSession();
    window.setTimeout(() => setToast((current) => current?.message === t("Conversation deleted") ? null : current), 10000);
  }

  async function send(textOverride?: string, historyOverride?: Message[]) {
    const typed = (textOverride ?? draft).trim();
    if ((!typed && !attachments.length) || requestRef.current) return;
    if (textOverride === undefined && typed.startsWith("/") && runSlash(typed)) { setDraft(""); return; }
    const usingCloud = source === "cloud";
    const selectedLocal = models.find((item) => item.name === model);
    const ready = usingCloud ? !!cloudModel.trim() && !!cloudBase.trim() : !!model && selectedLocal?.loaded !== false;
    if (!ready) { setStartupNote(t("Pick a model, start Ollama, or switch to Cloud API.")); window.setTimeout(() => setStartupNote(""), 5000); return; }
    const attached = attachments.map((item) => item.kind === "text" && item.text
      ? `[Attached: ${item.name}]\n\`\`\`\n${item.text}\n\`\`\``
      : `[Attached: ${item.name} · ${Math.max(1, Math.round(item.size / 1024))} KB]`).join("\n\n");
    const text = attached ? (typed ? typed + "\n\n" : "") + attached : typed;
    const history = historyOverride ?? (editingMessageIndex == null ? messages : messages.slice(0, editingMessageIndex));
    const next: Message[] = [...history, { role: "user", content: text, at: stamp() }, { role: "assistant", content: "", at: stamp() }];
    setMessages(next); if (textOverride === undefined) setDraft(""); setAttachments([]); setEditingMessageIndex(null); setError("");
    setFollowSignal((current) => current + 1);
    const requestId = crypto.randomUUID(); requestRef.current = requestId; setChatBusy(true);
    transport.current = { startedAt: performance.now(), chars: 0, reasoningStartedAt: null, reasoningMs: 0 };
    try {
      const cloudMode = source === "cloud";
      // The adapter in the main process owns URL joining, so cloud addresses go out
      // as typed; only the local gateway path is normalised here.
      const chatBase = cloudMode ? cloudBase.trim() : (remoteActive() ? serverBase.trim() : gatewayBase);
      const chatKey = cloudMode ? cloudKey.trim() : (remoteActive() ? apiKey.trim() : "");
      const chatModel = cloudMode ? (cloudModel.trim() || model) : model;
      const outbound = [
        ...(composerMode === "code" || systemPrompt.trim() ? [{ role: "system" as const, content: [systemPrompt.trim(), composerMode === "code" ? t("CODE_MODE_PROMPT") : ""].filter(Boolean).join("\n\n") }] : []),
        ...next.slice(0, -1).map((item) => ({ role: item.role, content: item.content })),
      ];
      await window.hymnix.gateway.streamChat({ requestId, baseUrl: chatBase, apiKey: chatKey, model: chatModel, reasoningEffort: effort, kind: cloudMode ? providerKind : "openai", agentId: cloudMode ? agentId.trim() : "", maxTokens: cloudMode ? providerMaxTokens : 0, messages: outbound, onDelta: (part: any) => {
        const payload = part?.choices?.[0]?.delta || {};
        const content = payload.content || ""; const thinking = payload.reasoning_content || payload.reasoning || "";
        if (requestRef.current !== requestId || (!content && !thinking)) return;
        if (thinking && transport.current.reasoningStartedAt == null) transport.current.reasoningStartedAt = performance.now();
        transport.current.chars += content.length + thinking.length;
        setMessages((current) => current.map((item, index) => index === current.length - 1 ? { ...item, content: item.content + content, reasoning: (item.reasoning || "") + thinking } : item));
      } });
      settleTransport();
    } catch (reason) {
      if (requestRef.current !== requestId) return;
      setState("degraded");
      const detail = reason instanceof Error ? reason.message : String(reason);
      setMessages((current) => current.map((item, index) => index === current.length - 1 && item.role === "assistant"
        ? { ...item, error: detail || t("Connection lost") } : item));
    } finally { if (requestRef.current === requestId) { requestRef.current = null; setChatBusy(false); } }
  }
  function settleTransport() {
    const elapsed = performance.now() - transport.current.startedAt;
    const reasoningMs = transport.current.reasoningStartedAt != null ? performance.now() - transport.current.reasoningStartedAt : 0;
    setMessages((current) => {
      const last = current[current.length - 1];
      if (!last || last.role !== "assistant") return current;
      const tokens = estimateTokens(last.content + (last.reasoning || ""));
      const rate = elapsed > 600 && tokens > 0 ? tokens / (elapsed / 1000) : undefined;
      return current.map((item, index) => index === current.length - 1 ? { ...item, tokensPerSecond: rate, reasoningMs: reasoningMs || item.reasoningMs } : item);
    });
  }
  function runSlash(input: string): boolean {
    const { command, argument, isCommand } = parseSlashCommand(input);
    if (!isCommand) return false;
    if (command === "model") {
      if (!argument) { setToast({ message: t("Usage: /model <name>") }); window.setTimeout(() => setToast(null), 3200); return true; }
      const match = models.find((item) => item.name.toLowerCase() === argument.toLowerCase()) || models.find((item) => item.name.toLowerCase().includes(argument.toLowerCase()));
      if (!match) { setToast({ message: tf("No model matches {name}", { name: argument }) }); window.setTimeout(() => setToast(null), 3200); return true; }
      setModel(match.name); setToast({ message: tf("Model switched to {name}", { name: match.name }) }); window.setTimeout(() => setToast(null), 2400);
      return true;
    }
    if (command === "clear") { clearCurrentConversation(); return true; }
    if (command === "export") { exportChat(); return true; }
    if (command === "system") {
      setSystemPrompt(argument);
      setToast({ message: argument ? t("System prompt set") : t("System prompt cleared") });
      window.setTimeout(() => setToast(null), 2400);
      return true;
    }
    return false;
  }
  async function addFiles(files: FileList | File[]): Promise<void> {
    const picked: Attachment[] = [];
    for (const file of Array.from(files).slice(0, 6)) {
      if (file.size > 5_000_000) { setStartupNote(tf("{name} is larger than 5 MB and was skipped.", { name: file.name })); window.setTimeout(() => setStartupNote(""), 5000); continue; }
      const kind: Attachment["kind"] = file.type.startsWith("image/") ? "image"
        : (/^(text\/|application\/(json|xml|javascript))/i.test(file.type) || /\.(txt|md|json|js|ts|tsx|css|html|py|sh|yml|yaml|log|csv)$/i.test(file.name)) ? "text" : "file";
      let body: string | undefined;
      if (kind === "text") { try { body = (await file.text()).slice(0, 20000); } catch { /* unreadable file */ } }
      picked.push({ id: crypto.randomUUID(), name: file.name, size: file.size, kind, text: body });
    }
    if (picked.length) setAttachments((current) => [...current, ...picked].slice(0, 6));
  }
  function retryMessage(index: number): void {
    if (requestRef.current) return;
    let userIndex = index;
    while (userIndex >= 0 && messages[userIndex].role !== "user") userIndex--;
    if (userIndex < 0) return;
    void send(messages[userIndex].content, messages.slice(0, userIndex));
  }
  function branchFrom(index: number): void {
    // Branching replaces the conversation, so the previous stream must stop:
    // its deltas only carry a request id and would append to the new session.
    cancel();
    persistCurrentSession();
    const branch = messages.slice(0, index + 1);
    const now = new Date().toISOString();
    const record: LocalChatSession = { id: newSessionId(), name: tf("Branch of {name}", { name: sessionName }), createdAt: now, updatedAt: now, count: branch.length, model, draft: "", messages: branch, pinned: false };
    const next = [record, ...savedSessions].slice(0, 200);
    setSavedSessions(next); writeChatSessions(next);
    setCurrentSessionId(record.id); setSessionName(record.name); setMessages(branch); setDraft(""); setActive("Chat");
    setFollowSignal((value) => value + 1);
    setToast({ message: t("Branched into a new conversation") });
    window.setTimeout(() => setToast(null), 2400);
  }
  function cancel() {
    if (!requestRef.current) return;
    window.hymnix.gateway.cancelChat(requestRef.current);
    requestRef.current = null;
    setChatBusy(false);
    // Leave a visible marker: a stopped reply used to look like a truncated one
    // with no way to tell it apart from a finished answer.
    setMessages((current) => {
      const last = current[current.length - 1];
      if (!last || last.role !== "assistant" || last.error) return current;
      return current.map((item, index) => index === current.length - 1 ? { ...item, stopped: item.stopped || !item.content ? true : item.stopped, tokensPerSecond: undefined } : item);
    });
  }
  function editMessage(index: number): void {
    if (requestRef.current) return;
    const message = messages[index];
    if (!message || message.role !== "user") return;
    setEditingMessageIndex(index); setDraft(message.content); window.setTimeout(() => composerRef.current?.focus(), 0);
  }
  function regenerateMessage(index: number): void {
    if (requestRef.current) return;
    let userIndex = index - 1;
    while (userIndex >= 0 && messages[userIndex].role !== "user") userIndex--;
    if (userIndex < 0) return;
    void send(messages[userIndex].content, messages.slice(0, userIndex));
  }
  function deleteMessageTurn(index: number): void {
    if (requestRef.current) return;
    const previous = messages;
    let start = index;
    while (start > 0 && messages[start].role !== "user") start--;
    if (messages[start]?.role !== "user") start = index;
    let end = start + 1;
    while (end < messages.length && messages[end].role !== "user") end++;
    if (end <= start) return;
    setMessages([...messages.slice(0, start), ...messages.slice(end)]);
    if (editingMessageIndex != null && editingMessageIndex >= start) { setEditingMessageIndex(null); setDraft(""); }
    setToast({ message: t("Turn deleted"), action: t("Undo"), undo: () => { setMessages(previous); setToast(null); } });
    window.setTimeout(() => setToast((current) => current?.message === t("Turn deleted") ? null : current), 10000);
  }
  function resizeComposer(): void {
    const element = composerRef.current;
    if (!element) return;
    element.style.height = "auto";
    const line = Number.parseFloat(getComputedStyle(element).lineHeight) || 20;
    element.style.height = Math.min(element.scrollHeight, line * 8 + 10) + "px";
    element.style.overflowY = element.scrollHeight > line * 8 + 12 ? "auto" : "hidden";
  }
  useEffect(() => { resizeComposer(); }, [draft, active]);

  async function modelAction(action: "start" | "stop" | "delete", name: string, force = false) {
    // Unloading the model that is producing the current reply is destructive; ask first.
    // The confirmation path passes force, because cancel() only schedules a state
    // update: reading chatBusy again in the same tick re-opened the dialog forever.
    if (!force && action === "stop" && chatBusy && model === name) { setUnloadTarget(name); return; }
    setModelBusy(name); setModelNote("");
    try { if (action === "start") await window.hymnix.models.start(name); if (action === "stop") await window.hymnix.models.stop(name); if (action === "delete") await window.hymnix.models.remove(name); await loadModels(); }
    catch (reason) { setModelNote(reason instanceof Error ? reason.message : String(reason)); }
    finally { setModelBusy(""); }
  }
  async function confirmStopAndUnload(): Promise<void> {
    const name = unloadTarget;
    if (!name) return;
    setUnloadTarget(null);
    cancel();
    await modelAction("stop", name, true);
  }
  async function pullModelByName(name: string, resume = false): Promise<"complete" | "paused" | "cancelled" | "failed" | "busy" | "remote"> {
    if (remoteActive()) return "remote";
    if (downloadRequest.current || (pausedModel.current && (!resume || pausedModel.current !== name))) return "busy";
    if (!resume) {
      const sizeGb = catalogSizeGb(name);
      if (sizeGb) {
        try {
          const disk = await window.hymnix.system.disk("");
          const need = sizeGb * 1.1;
          const freeGb = (disk?.free ?? 0) / 1_000_000_000;
          if (disk?.free && freeGb < need) {
            setDownload({ requestId: "", model: name, phase: "failed", error: tf("Needs {need} GB, you have {free} GB free.", { need: need.toFixed(1), free: freeGb.toFixed(1) }) });
            return "failed";
          }
        } catch { /* disk probe unavailable: continue */ }
      }
    }
    const requestId = crypto.randomUUID();
    downloadRequest.current = requestId;
    downloadStop.current = null;
    pausedModel.current = null;
    setModelNote("");
    setDownload({ requestId, model: name, phase: "downloading" });
    const trackProgress = trackDownloadProgress();
    try {
      const result = await window.hymnix.models.pullStream({ requestId, model: name, onProgress: (progress) => {
        if (downloadRequest.current !== requestId || downloadStop.current) return;
        const metrics = trackProgress(progress);
        setDownload((current) => current?.requestId === requestId && current.phase === "downloading" ? {
          ...current, ...metrics,
        } : current);
      } });
      if (result.cancelled && downloadStop.current === "pause") {
        pausedModel.current = name;
        setDownload((current) => current?.requestId === requestId
          ? { ...current, phase: "paused", bytesPerSecond: undefined } : current);
        return "paused";
      }
      if (result.cancelled) {
        setDownload({ requestId, model: name, phase: "cancelled" });
        return "cancelled";
      }
    } catch (reason) {
      if (resume) pausedModel.current = name;
      setDownload({ requestId, model: name, phase: resume ? "paused" : "failed", error: pullErrorMessage(reason) });
      return "failed";
    } finally {
      downloadRequest.current = null;
      downloadStop.current = null;
    }
    setDownload({ requestId, model: name, phase: "complete" });
    void window.hymnix.system.notify({ title: t("Download complete"), body: tf("{model} is ready to load.", { model: name }) }).catch(() => undefined);
    void loadModels();
    return "complete";
  }

  function stopModelDownload(action: "pause" | "cancel") {
    if (action === "cancel" && pausedModel.current) {
      pausedModel.current = null;
      setDownload((current) => current?.phase === "paused" ? { ...current, phase: "cancelled", error: undefined } : current);
      return;
    }
    const requestId = downloadRequest.current;
    if (!requestId || downloadStop.current) return;
    downloadStop.current = action;
    setDownload((current) => current?.requestId === requestId && current.phase === "downloading"
      ? { ...current, phase: action === "pause" ? "pausing" : "cancelling", error: undefined } : current);
    try {
      window.hymnix.models.cancelPull(requestId);
    } catch (reason) {
      downloadStop.current = null;
      setDownload((current) => current?.requestId === requestId
        ? { ...current, phase: "downloading", error: pullErrorMessage(reason) } : current);
    }
  }

  function resumeModelDownload() {
    const name = pausedModel.current;
    if (!name) return;
    void pullModelByName(name, true).then((result) => {
      if (result === "complete") setPullName((current) => current.trim() === name ? "" : current);
    });
  }

  async function pullModel() {
    const name = pullName.trim();
    if (!name) return;
    if (await pullModelByName(name) === "complete") {
      setPullName((current) => current.trim() === name ? "" : current);
    }
  }

  async function chooseWorkspace() {
    setFilesBusy(true); setFilesError("");
    try {
      const root: any = await window.hymnix.workspace.choose();
      if (!root?.path) { setFilesError(t("No workspace selected")); return; }
      setFilesRoot(root.path);
      setWorkspace(root.path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() || t("Workspace"));
      const tree: any = await window.hymnix.files.tree({ path: root.path, depth: 2, limit: 400 });
      setFileEntries(tree?.results || []);
    } catch (reason) { setFilesError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setFilesBusy(false); }
  }
  async function searchFiles() {
    if (!filesRoot || !fileQuery.trim()) return;
    setFilesBusy(true); setFilesError("");
    try { const result: any = await window.hymnix.files.search({ query: fileQuery.trim(), path: filesRoot, limit: 60 }); setFileHits(result?.results || []); }
    catch (reason) { setFilesError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setFilesBusy(false); }
  }
  async function readFile(path: string) {
    setFilesBusy(true); setFilesError("");
    try { const result: any = await window.hymnix.files.read({ path, start: 1, lines: 400 }); setFileText(String(result?.text || "")); void openPreview(path); }
    catch (reason) { setFilesError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setFilesBusy(false); }
  }
  async function loadHistory() {
    setHistoryBusy(true); setHistoryError("");
    try { const api: any = window.hymnix; const result = await api.adminHistory(adminKey.trim(), { limit: 100, days: 7 }); setHistory(result?.items || []); }
    catch (reason) { setHistoryError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setHistoryBusy(false); }
  }
  async function loadStatus() {
    try { const api: any = window.hymnix; setStatusData(await api.gateway.adminStatus(adminKey.trim())); setStatusError(""); }
    catch (reason) { setStatusError(reason instanceof Error ? reason.message : String(reason)); }
  }
  async function loadLogs() {
    try { const api: any = window.hymnix; const result = await api.gateway.adminErrors(adminKey.trim(), 50); setLogItems(Array.isArray(result) ? result : []); setLogError(""); }
    catch (reason) { setLogError(reason instanceof Error ? reason.message : String(reason)); }
  }

  function push(tag: Entry["tag"], text: string) { setTermEntries((current) => [...current, { time: stamp(), tag, text }]); }

  function termOut(tag: "sys" | "out" | "err", text: string) {
    setTermEntries((current) => [...current, { time: stamp(), tag, text }]);
  }

  async function runTerminalBridge(args: string[]) {
    const action = args[0]?.toLowerCase();
    if (args.length !== 1 || (action !== "on" && action !== "off" && action !== "status" && action !== "inbox")) {
      termOut("err", "bridge on | bridge status | bridge inbox | bridge off");
      return;
    }
    if (bridgeBusy.current) return;
    bridgeBusy.current = true;
    termOut("sys", "> bridge " + action);
    try {
      const result = await window.hymnix.terminal.bridge(action);
      if (!result.enabled) {
        setBridgeConnection(null);
        setBridgeReplies([]);
        termOut("sys", t("Local reply bridge is off."));
        return;
      }
      if (action === "on" && result.endpoint && result.token) {
        setBridgeConnection({ endpoint: result.endpoint, token: result.token });
        termOut("sys", t("Local reply bridge is on. Run bridge inbox to read replies."));
      } else if (action === "status") {
        termOut("sys", tf("Local reply bridge is on. Pending replies: {count}", { count: String(result.pending ?? 0) }));
      } else if (action === "inbox") {
        if (result.replies?.length) setBridgeReplies(result.replies);
        else { setBridgeReplies([]); termOut("sys", t("No new bridge replies.")); }
      }
    } catch (reason) {
      termOut("err", reason instanceof Error ? reason.message : String(reason));
    } finally {
      bridgeBusy.current = false;
    }
  }

  async function runTerm() {
    const raw = termCmd.trim();
    if (!raw || termBusy) return;
    const [cmd, ...args] = raw.split(/\s+/);
    const name = cmd.toLowerCase();
    setTermCmd("");
    if (name === "bridge") {
      await runTerminalBridge(args);
      return;
    }
    termOut("sys", "> " + raw);
    termHistory.current = [...termHistory.current, raw];
    termCursor.current = termHistory.current.length;
    try {
      switch (name) {
        case "help":
          termOut("sys", "help · status · version · models · model <name> · start <name> · stop <name> · pull <name>");
          termOut("sys", "tunnel on|off|restart|status · hardware · ps · dir · logtail · export · open <url>");
          termOut("sys", "config · get <key> · set <key> <value> · quota <n> · billing on|off · lang en|zh · clear");
          termOut("sys", "bridge on | bridge status | bridge inbox | bridge off");
          termOut("sys", "其它命令交给工作区 shell 执行");
          return;
        case "clear":
          setTermEntries([]);
          setBridgeReplies([]);
          return;
        case "status":
          termOut("sys", "gateway=" + state + " models=" + models.length + " model=" + (model || "-") + " cwd=" + (filesRoot || "-"));
          termOut("sys", "tunnel=" + tunnelState + " url=" + (tunnelUrl || "-"));
          return;
        case "version":
          termOut("sys", "Hymnix Orbit " + __APP_VERSION__ + " · gateway " + (health?.gateway || "-"));
          return;
        case "models":
          termOut("sys", models.length ? models.map((item) => item.name + (item.loaded ? "*" : "")).join("  ") : "没有已安装模型");
          return;
        case "model": {
          if (!args[0]) { termOut("err", "usage: model <name>"); return; }
          setModel(args[0]);
          termOut("sys", "current model = " + args[0]);
          return;
        }
        case "start":
        case "stop": {
          if (!args[0]) { termOut("err", "usage: " + name + " <name>"); return; }
          await modelAction(name === "start" ? "start" : "stop", args[0]);
          termOut("sys", name + " " + args[0] + " -> done");
          return;
        }
        case "pull": {
          if (!args[0]) { termOut("err", "usage: pull <name>"); return; }
          const result = await pullModelByName(args[0]);
          const outcome = {
            complete: "Download complete: {model}", cancelled: "Download cancelled: {model}", paused: "Download paused: {model}",
            failed: "Download failed: {model}", busy: "Resume or cancel the current model download first.",
            remote: "Switch to local mode to download models.",
          }[result];
          termOut(result === "complete" || result === "cancelled" || result === "paused" ? "sys" : "err", tf(outcome, { model: args[0] }));
          return;
        }
        case "tunnel": {
          const action = (args[0] || "status").toLowerCase();
          if (action === "status") { termOut("sys", "tunnel=" + tunnelState + " url=" + (tunnelUrl || "-")); return; }
          if (action === "on" || action === "start") { applyTunnel(await window.hymnix.network.tunnel("start")); termOut("sys", "tunnel starting"); return; }
          if (action === "off" || action === "stop") { applyTunnel(await window.hymnix.network.tunnel("stop")); termOut("sys", "tunnel stopped"); return; }
          if (action === "restart") { applyTunnel(await window.hymnix.network.tunnel("restart")); termOut("sys", "tunnel restarted"); return; }
          termOut("err", "usage: tunnel on|off|restart|status");
          return;
        }
        case "hardware":
          termOut("sys", "gpu=" + (stats?.gpu ?? "-") + "% vram=" + (stats?.vramUsed ?? "-") + "/" + (stats?.vramTotal ?? "-") + "G ram=" + (stats ? (stats.ramUsed / 1024).toFixed(1) : "-") + "/" + (stats ? (stats.ramTotal / 1024).toFixed(1) : "-") + "G");
          return;
        case "ps": {
          const result = await window.hymnix.terminal.start({ command: "tasklist /FO CSV /NH | findstr /I ollama", cwd: filesRoot || undefined, policy: "workspace" });
          termId.current = result.id;
          setTermBusy(true);
          return;
        }
        case "dir": {
          const result = await window.hymnix.terminal.start({ command: "dir", cwd: filesRoot || undefined, policy: "workspace" });
          termId.current = result.id;
          setTermBusy(true);
          return;
        }
        case "logtail":
          if (!tunnelLog.length) { termOut("sys", "隧道日志为空（先 tunnel on）"); return; }
          tunnelLog.slice(-12).forEach((line) => termOut("out", line));
          return;
        case "config": {
          if (args[0] === "set") {
            const key = args[1];
            const value = args.slice(2).join(" ");
            if (!key || value === "") { termOut("err", "usage: set <key> <value>"); return; }
            const parsed = value === "true" ? true : value === "false" ? false : /^-?\d+$/.test(value) ? Number(value) : value;
            const result: any = await window.hymnix.config.set({ [key]: parsed });
            termOut(result?.ok ? "sys" : "err", "set " + key + " = " + JSON.stringify((result?.changed || {})[key] ?? value) + (result?.rejected?.length ? " rejected=" + result.rejected.join(",") : ""));
            return;
          }
          const info: any = await window.hymnix.config.get();
          Object.entries(info?.values || {}).forEach(([key, value]) => termOut("out", key + " = " + JSON.stringify(value)));
          return;
        }
        case "get": {
          if (!args[0]) { termOut("err", "usage: get <key>"); return; }
          const info: any = await window.hymnix.config.get();
          const value = (info?.values || {})[args[0]];
          termOut(value === undefined ? "err" : "sys", args[0] + " = " + JSON.stringify(value ?? null));
          return;
        }
        case "quota": {
          if (!args[0]) { termOut("err", "usage: quota <n>"); return; }
          const result: any = await window.hymnix.config.set({ daily_quota_tokens: Number(args[0]) });
          termOut("sys", "daily_quota_tokens = " + (result?.changed?.daily_quota_tokens ?? "?"));
          return;
        }
        case "billing": {
          const on = (args[0] || "on").toLowerCase() !== "off";
          const result: any = await window.hymnix.config.set({ billing_enabled: on });
          termOut("sys", "billing_enabled = " + String(result?.changed?.billing_enabled));
          return;
        }
        case "lang": {
          const next = (args[0] || "zh").toLowerCase() === "en" ? "en" : "zh";
          changeLang(next as Lang);
          termOut("sys", "lang = " + next);
          return;
        }
        case "open": {
          if (!args[0]) { termOut("err", "usage: open <url>"); return; }
          await window.hymnix.system.openExternal(args[0]);
          termOut("sys", "opened " + args[0]);
          return;
        }
        case "export": {
          const text = messages.map((item) => (item.role === "user" ? "You" : "Hymnix Orbit") + " [" + (item.at || "") + "]\n" + item.content).join("\n\n");
          const blob = new Blob([text || "empty"], { type: "text/plain;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url; link.download = "hymnix-chat.txt"; link.click();
          URL.revokeObjectURL(url);
          termOut("sys", "exported hymnix-chat.txt");
          return;
        }
        default: {
          setTermBusy(true);
          const result = await window.hymnix.terminal.start({ command: raw, cwd: filesRoot || undefined, policy: "workspace" });
          termId.current = result.id;
          return;
        }
      }
    } catch (reason) {
      termOut("err", reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function copyLastReply() {
    const last = [...messages].reverse().find((item) => item.role === "assistant" && item.content);
    if (last) await navigator.clipboard?.writeText(last.content);
  }
  function saveChat() {
    const current = savedSessions.find((item) => item.id === currentSessionId);
    const now = new Date().toISOString();
    const record: LocalChatSession = { id: currentSessionId, name: conversationTitle(messages, sessionName), createdAt: current?.createdAt || now, updatedAt: now, count: messages.length, model, draft, messages, pinned: current?.pinned || false };
    const next = [record, ...savedSessions.filter((item) => item.id !== currentSessionId)];
    setSessionName(record.name); setSavedSessions(next); writeChatSessions(next);
    setToast({ message: t("Saved") });
    window.setTimeout(() => setToast(null), 4000);
  }
  function loadChat() {
    const current = savedSessions.find((item) => item.id === currentSessionId) || savedSessions[0];
    if (current) openSession(current.id);
    else setStartupNote(t("No saved conversation yet."));
  }
  function clearAllSessions(): void {
    setClearAllConfirm(false);
    const previous = savedSessions;
    setSavedSessions([]); writeChatSessions([]);
    setToast({ message: t("All conversations cleared"), action: t("Undo"), undo: () => { setSavedSessions(previous); writeChatSessions(previous); setToast(null); } });
    window.setTimeout(() => setToast((current) => current?.message === t("All conversations cleared") ? null : current), 10000);
    if (previous.some((item) => item.id === currentSessionId)) startFreshSession();
  }
  function exportChat() {
    const text = messages.map((item) => (item.role === "user" ? "You" : "Hymnix Orbit") + " [" + (item.at || "") + "]\n" + item.content).join("\n\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "hymnix-chat.txt"; link.click();
    URL.revokeObjectURL(url);
  }
  function StarBanner() {
    return <button className="star-banner" onClick={() => void window.hymnix.system.openExternal("https://github.com/CarrisFlynn/hymnix-ai-server")} type="button">
      <span className="star-text">{t("If this solved your problem, a star would mean a lot!")}<u>{t("Click here")}</u> →</span>
      <span className="star-pill"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" /></svg>{t("Stars")}</span>
      <span className="star-count">{stars == null ? "★" : stars >= 1000 ? (stars / 1000).toFixed(1) + "k" : String(stars)}</span>
    </button>;
  }
  function renderOllamaNotice() {
    if (remoteActive() || health?.ollama !== false) return null;
    return <div className="card offline-card">
      <div><strong>{t("Model service is offline")}</strong><span>{t("Start Ollama to list and run local models.")}</span>
        {ollamaError && <span role="alert">{ollamaError}</span>}</div>
      <button type="button" className="btn primary" onClick={() => void startOllama()} disabled={ollamaBusy}>
        {t(ollamaBusy ? "Starting Ollama..." : "Start Ollama")}
      </button>
    </div>;
  }

  function renderChat() {
    const localOffline = source === "local" && !remoteActive() && health?.ollama === false;
    const noLocalModels = source === "local" && health !== null && !localOffline && models.length === 0;
    const selectedLocalModel = models.find((item) => item.name === model);
    const modelNeedsLoad = source === "local" && !!selectedLocalModel && selectedLocalModel.loaded === false;
    const checkingService = source === "local" && !remoteActive() && health === null;
    const cloudUnconfigured = source === "cloud" && !cloudBase.trim();
    const slashQuery = draft.startsWith("/") && !draft.includes("\n") ? draft.split(/\s/)[0].toLowerCase() : "";
    const slashMatches = slashQuery ? SLASH_COMMANDS.filter((item) => item.name.startsWith(slashQuery)) : [];
    const lastAssistant = [...messages].reverse().find((item) => item.role === "assistant");
    const liveRate = chatBusy && transport.current.startedAt && lastAssistant?.content
      ? estimateTokens(lastAssistant.content) / Math.max(0.4, (Date.now() - transport.current.startedAt) / 1000)
      : null;
    const totalTokens = estimateTokens(messages.map((item) => item.content).join(" "));
    const activeProvider = providers.find((item) => item.id === activeProviderId);
    const effortIndex = Math.max(0, EFFORT_LEVELS.findIndex((level) => level.key === effort));
    const effortLevel = EFFORT_LEVELS[effortIndex];
    const maxSupported = source === "cloud" ? activeProvider?.max_effort === true : false;
    // "No model" means nothing can answer right now: no local service, no cloud
    // profile, no tunnel. A remembered model name must not pretend otherwise.
    const modelUsable = source === "cloud"
      ? Boolean(cloudBase.trim() && cloudModel.trim())
      : mode === "remote" ? Boolean(serverBase.trim()) : (Boolean(model) && health?.ollama === true);
    const sourceLabel = source === "cloud"
      ? (activeProvider?.label || t("Cloud API"))
      : mode === "remote" ? (guestName || t("Remote host")) : t("Local model");
    const modelTitle = modelUsable
      ? (source === "cloud" ? cloudModel : model)
      : t("No model");
    const sessionStart = savedSessions.find((item) => item.id === currentSessionId)?.createdAt;
    const elapsed = sessionStart ? formatDuration(Math.max(0, Math.round((Date.now() - new Date(sessionStart).getTime()) / 1000))) : "";
    const query = modelQuery.trim().toLowerCase();
    const matches = (name: string) => !query || name.toLowerCase().includes(query);
    const providerRows = providers.flatMap((provider) => {
      const names = provider.models.length ? provider.models : [""];
      return names.map((name) => ({ provider, name }));
    }).filter((row) => matches(row.name || row.provider.label));

    const composer = (
      <form className={"composer" + (dropActive ? " drop-active" : "")} onSubmit={(event) => { event.preventDefault(); void send(); }}
        onDragOver={(event) => { if (event.dataTransfer?.types.includes("Files")) { event.preventDefault(); setDropActive(true); } }}
        onDragLeave={() => setDropActive(false)}
        onDrop={(event) => { event.preventDefault(); setDropActive(false); if (event.dataTransfer?.files.length) void addFiles(event.dataTransfer.files); }}>
        {editingMessageIndex !== null && <div className="editing-banner"><span>{t("Editing prompt")}</span><button type="button" onClick={() => { setEditingMessageIndex(null); setDraft(""); }}>{t("Cancel edit")}</button></div>}
        {attachments.length > 0 && <div className="attachment-strip" aria-label={t("Attachments")}>{attachments.map((item) => <span className="attachment-chip" key={item.id}><span aria-hidden="true">{item.kind === "image" ? "▣" : "▤"}</span><span className="attachment-name">{item.name}</span><small>{Math.max(1, Math.round(item.size / 1024))} KB</small><button type="button" aria-label={tf("Remove {name}", { name: item.name })} onClick={() => setAttachments((current) => current.filter((entry) => entry.id !== item.id))}>×</button></span>)}</div>}
        {slashMatches.length > 0 && <div className="slash-menu" role="listbox" aria-label={t("Slash commands")}>
          {slashMatches.map((item, index) => <button type="button" role="option" aria-selected={index === slashIndex} key={item.name} className={index === slashIndex ? "active" : ""}
            onMouseEnter={() => setSlashIndex(index)}
            onClick={() => { if (item.insert) { setDraft(item.insert); window.setTimeout(() => composerRef.current?.focus(), 0); } else { runSlash(item.name); setDraft(""); } setSlashIndex(0); }}>
            <code>{item.name}</code><span>{t(item.detail)}</span>
          </button>)}
        </div>}
        <textarea ref={composerRef} aria-label={t("Message")} rows={1} value={draft} onChange={(event) => { setDraft(event.target.value); setSlashIndex(0); }}
          onPaste={(event) => { const files = event.clipboardData?.files; if (files && files.length) { event.preventDefault(); void addFiles(files); } }}
          onKeyDown={(event) => {
            if (slashMatches.length && !event.nativeEvent.isComposing) {
              if (event.key === "ArrowDown") { event.preventDefault(); setSlashIndex((index) => (index + 1) % slashMatches.length); return; }
              if (event.key === "ArrowUp") { event.preventDefault(); setSlashIndex((index) => (index - 1 + slashMatches.length) % slashMatches.length); return; }
              if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
                event.preventDefault();
                const item = slashMatches[Math.min(slashIndex, slashMatches.length - 1)];
                if (item.insert) setDraft(item.insert); else { runSlash(item.name); setDraft(""); }
                return;
              }
            }
            const shouldSend = enterSwaps ? event.key === "Enter" && event.shiftKey : event.key === "Enter" && !event.shiftKey;
            if (shouldSend && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
            if (event.key === "ArrowUp" && !draft.trim() && !event.nativeEvent.isComposing) { const lastUser = messages.map((item, index) => item.role === "user" ? index : -1).filter((index) => index >= 0).at(-1); if (lastUser != null) { event.preventDefault(); editMessage(lastUser); } }
          }} placeholder={t(source === "local" && health?.ollama === false ? "Start the model service to chat." : "Ask Hymnix anything...")} />
        <div className="composer-bar">
          <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => { if (event.target.files?.length) void addFiles(event.target.files); event.target.value = ""; }} />
          <button type="button" className="cb-icon" onClick={() => fileInputRef.current?.click()} aria-label={t("Attach a file")} data-tip={t("Attach a file")}><Icon name="Plus" /></button>
          <div className="policy-wrap">
            <button type="button" className="cb-chip approval" onClick={() => setPolicyMenu((value) => !value)} aria-expanded={policyMenu} aria-haspopup="listbox" title={t("Tool policy")}>
              <Icon name="Approvals" />{t(TOOL_POLICIES.find((level) => level.id === toolPolicy)?.label || "Workspace writes")}
            </button>
            {policyMenu && <div className="policy-menu" role="listbox" aria-label={t("Tool policy")}>
              {TOOL_POLICIES.map((level) => <button key={level.id} type="button" role="option" aria-selected={toolPolicy === level.id} className={toolPolicy === level.id ? "active" : ""} onClick={() => void chooseToolPolicy(level.id)}>
                <span className="policy-check" aria-hidden="true">{toolPolicy === level.id ? "✓" : ""}</span>
                <span className="policy-copy"><strong>{t(level.label)}</strong><small>{t(level.detail)}</small></span>
              </button>)}
            </div>}
          </div>
          <button type="button" className={"cb-chip model" + (modelUsable ? "" : " is-empty")} onClick={() => setModelPopover((value) => value === "closed" ? "root" : "closed")} aria-expanded={modelPopover !== "closed"} aria-haspopup="dialog">
            <span className="cb-model-name">{modelTitle}</span>
            <span className="cb-model-source">{sourceLabel}</span>
            <span className="cb-level" data-level={effortLevel.key}>{effortLevel.label}</span>
            <Icon name="Chevron" />
          </button>
          <span className="composer-hint">{t(enterSwaps ? "Shift+Enter to send · Enter for new line" : "Enter to send · Shift+Enter for new line")}</span>
          <div className="cb-right">
            {liveRate != null && <span className="composer-rate" data-no-translate>{liveRate.toFixed(1)} tok/s</span>}
            {chatBusy ? <button type="button" className="composer-send stop" onClick={cancel} aria-label={t("Stop generating")} data-tip={t("Stop generating")} data-tip-key="Esc"><span aria-hidden="true">■</span></button> : <button type="submit" className="composer-send" disabled={!draft.trim() && !attachments.length} aria-label={t("Send")} data-tip={t("Send")} data-tip-key={enterSwaps ? "Shift+Enter" : "Enter"}><span aria-hidden="true">↑</span></button>}
          </div>
        </div>

        {modelPopover !== "closed" && <div className="model-panel" role="dialog" aria-label={t("Model and reasoning")}>
          <div className="mp-head">
            {modelPopover === "models"
              ? <button type="button" className="mp-back" onClick={() => setModelPopover("root")}>‹ {t("Back")}</button>
              : <strong>{t("Model and reasoning")}</strong>}
            <button type="button" className="mp-close" onClick={() => setModelPopover("closed")} aria-label={t("Close")}>×</button>
          </div>
          {modelPopover === "root" ? <div className="mp-body">
            <button type="button" className="mp-row mp-row-button" onClick={() => setModelPopover("models")}>
              <span className="mp-label">{t("Model")}</span>
              <span className="mp-value">{modelTitle}</span>
              <span className="mp-source">{sourceLabel}</span>
              <Icon name="Chevron" />
            </button>
            <div className="mp-row mp-row-slider">
              <div className="mp-slider-head"><span className="mp-label">{t("Reasoning")}</span><strong className="mp-level" data-level={effortLevel.key}>{effortLevel.label}</strong></div>
              <div className="effort-slider-wrap"
                onPointerDown={(event) => { const rect = event.currentTarget.getBoundingClientRect(); event.currentTarget.setPointerCapture(event.pointerId); setEffortDrag(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * 3); }}
                onPointerMove={(event) => {
                  if (effortDrag === null) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  setEffortDrag(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * 3);
                }}
                onPointerUp={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  let index = Math.round(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * 3);
                  if (index === 3 && !maxSupported) index = 2;
                  setEffortDrag(null);
                  setEffort(EFFORT_LEVELS[index].key);
                }}
                onPointerCancel={() => setEffortDrag(null)}
                role="slider" tabIndex={0} aria-valuemin={0} aria-valuemax={3} aria-valuenow={effortIndex} aria-valuetext={effortLevel.label} aria-label={t("Reasoning effort")}
                onKeyDown={(event) => {
                  const current = effortIndex;
                  let next = current;
                  if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = Math.max(0, current - 1);
                  else if (event.key === "ArrowRight" || event.key === "ArrowUp") next = Math.min(3, current + 1);
                  else if (event.key === "Home") next = 0;
                  else if (event.key === "End") next = 3;
                  else return;
                  if (next === 3 && !maxSupported) return;
                  event.preventDefault();
                  setEffort(EFFORT_LEVELS[next].key);
                }}>
                <div className="effort-track" data-level={EFFORT_LEVELS[Math.round(effortDrag ?? effortIndex)].key} aria-hidden="true" />
                <span className="effort-fill" style={{ width: ((effortDrag ?? effortIndex) / 3) * 100 + "%" }} aria-hidden="true" />
                <span className="effort-ticks" aria-hidden="true">{EFFORT_LEVELS.map((level, index) => <i key={level.key} style={{ left: (index / 3) * 100 + "%" }} />)}</span>
                <span className="effort-thumb" style={{ left: ((effortDrag ?? effortIndex) / 3) * 100 + "%" }} aria-hidden="true" />
              </div>
              <div className="effort-stops">{EFFORT_LEVELS.map((level, index) => <button key={level.key} type="button" className={index <= effortIndex ? "on" : ""} data-disabled={level.key === "max" && !maxSupported ? "true" : "false"} onClick={() => { if (index === 3 && !maxSupported) return; setEffort(level.key); }}>{level.label}</button>)}</div>
              {!maxSupported && <p className="mp-note">{t("Max needs a provider that declares support for it.")}</p>}
            </div>
            <div className="mp-row"><span className="mp-label">{t("Context")}</span><span className="mp-value">~{totalTokens} {t("tokens")}</span></div>
            <div className="mp-row"><span className="mp-label">{t("Tool policy")}</span><span className="mp-value">{t(TOOL_POLICIES.find((level) => level.id === toolPolicy)?.label || "Workspace writes")}</span></div>
          </div> : <div className="mp-body mp-models">
            <input className="mp-search" autoFocus value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder={t("Search models")} aria-label={t("Search models")} />
            <div className="mp-scroll">
              <div className="mp-group">{mode === "remote" ? t("Remote host models") : t("Local models")}</div>
              {models.filter((item) => matches(item.name)).map((item) => <button type="button" key={item.name} className={"mp-option" + (source === "local" && model === item.name ? " active" : "")} onClick={() => void chooseModel({ kind: "local", model: item.name })}>
                <span className="mp-option-name">{item.name}</span>
                {item.loaded && <span className="chip accent">{t("Loaded")}</span>}
              </button>)}
              {models.length === 0 && <p className="mp-note">{t("No local models yet.")}</p>}

              <div className="mp-group">{t("Cloud API")}</div>
              {providers.length === 0
                ? <button type="button" className="mp-option mp-placeholder" onClick={() => goConfigure("api")}><span className="mp-option-name">{t("Cloud API")} · {t("Not configured")}</span><span className="mp-go">{t("Configure")} →</span></button>
                : providerRows.map(({ provider, name }) => <button type="button" key={provider.id + ":" + name} className={"mp-option" + (source === "cloud" && activeProviderId === provider.id && cloudModel === name ? " active" : "")} onClick={() => void chooseModel({ kind: "cloud", providerId: provider.id, model: name })}>
                  <span className="mp-option-name">{name || provider.label}</span>
                  <span className="mp-option-meta">{provider.label}</span>
                </button>)}
              {providers.length > 0 && <button type="button" className="mp-option mp-placeholder" onClick={() => goConfigure("api")}><span className="mp-option-name">{t("Add another provider")}</span><span className="mp-go">→</span></button>}

              <div className="mp-group">{t("Remote hosts")}</div>
              {mode === "remote"
                ? <button type="button" className="mp-option active" onClick={() => setModelPopover("closed")}><span className="mp-option-name">{serverBase}</span><span className="mp-option-meta">{t("Connected")}</span></button>
                : <button type="button" className="mp-option mp-placeholder" onClick={() => goConfigure("remote")}><span className="mp-option-name">{t("Remote host")} · {t("Not configured")}</span><span className="mp-go">{t("Configure")} →</span></button>}
            </div>
            <div className="mp-foot">
              <button type="button" className="btn" onClick={() => { setModelPopover("closed"); setActive("Models"); setModelsSection("local"); }}>{t("Manage models")}</button>
              <button type="button" className="btn ghost" onClick={() => { setModelPopover("closed"); setActive("Models"); setModelsSection("api"); }}>{t("Provider settings")}</button>
            </div>
          </div>}
        </div>}
      </form>
    );

    const emptyLead = checkingService ? <div className="chat-ready-card readiness-checking" role="status"><span className="orbit-loader" aria-hidden="true" /><div className="ready-copy"><span className="eyebrow">{t("GET STARTED")}</span><h2>{t("Checking the model service")}</h2><p>{t("Checking whether the local model service is ready...")}</p></div></div> : localOffline ? <div className="chat-ready-card">
      <div className="ready-icon"><Icon name="Models" /></div><div className="ready-copy"><span className="eyebrow">{t("GET STARTED")}</span><h2>{t("Model service is offline")}</h2><p>{t("Start Ollama to list and run local models. Your conversations stay on this device.")}</p>{ollamaError && <p className="error" role="alert">{ollamaError}</p>}</div>
      <div className="ready-actions"><button className="btn primary" onClick={() => void startOllama()} disabled={ollamaBusy}>{t(ollamaBusy ? "Starting Ollama..." : "Start Ollama")}</button><button className="btn" onClick={() => { setActive("Models"); setModelsSection("local"); }}>{t("View models")}</button></div>
    </div> : noLocalModels ? <div className="chat-ready-card">
      <div className="ready-icon"><Icon name="Models" /></div><div className="ready-copy"><span className="eyebrow">{t("GET STARTED")}</span><h2>{t("Choose a model to begin")}</h2><p>{t("Install a local model, or add a cloud provider and pick one of its models.")}</p></div>
      <div className="ready-actions"><button className="btn primary" onClick={() => { setActive("Models"); setModelsSection("local"); setModelsTab("Discover"); }}>{t("Discover models")}</button><button className="btn" onClick={() => goConfigure("api")}>{t("Add a cloud provider")}</button></div>
    </div> : modelNeedsLoad ? <div className="chat-ready-card">
      <div className="ready-icon"><Icon name="Models" /></div><div className="ready-copy"><span className="eyebrow">{t("MODEL READY")}</span><h2>{tf("Load {model} to begin", { model })}</h2><p>{t("The model is installed but not loaded. Load it before starting a conversation.")}</p></div>
      <div className="ready-actions"><button className="btn primary" onClick={() => void modelAction("start", model)} disabled={!!modelBusy}>{t(model && modelBusy === model ? "Loading..." : "Load model")}</button><button className="btn" onClick={() => { setActive("Models"); setModelsSection("local"); }}>{t("Choose another model")}</button></div>
    </div> : cloudUnconfigured ? <div className="chat-ready-card">
      <div className="ready-icon"><span>✦</span></div><div className="ready-copy"><span className="eyebrow">{t("CLOUD API")}</span><h2>{t("Configure a cloud provider")}</h2><p>{t("Add an address and an API key, then pick one of its models.")}</p></div>
      <div className="ready-actions"><button className="btn primary" onClick={() => goConfigure("api")}>{t("Add a cloud provider")}</button><button className="btn" onClick={() => setSource("local")}>{t("Use local model")}</button></div>
    </div> : <div className="chat-landing-head">
      <div className="empty-orbit" aria-hidden="true"><img src={brandIcon} alt="" /></div><span className="eyebrow">{t("HYMNIX ORBIT")}</span><h2>{t("What are you working on?")}</h2>
      <p>{tf("Start with {workspace} or choose a prompt.", { workspace: t(workspace) })}</p>
    </div>;
    const plainEmpty = !checkingService && !localOffline && !noLocalModels && !modelNeedsLoad && !cloudUnconfigured;
    const emptyChat = <div className={plainEmpty ? "chat-empty-state" : "chat-empty-state has-card"}>{emptyLead}{composer}{plainEmpty && <div className="prompt-grid"><button className="prompt-card" onClick={() => setDraft(t("Summarize the current workspace"))}><strong>{t("Summarize workspace")}</strong><span>{t("Get a concise overview of your files and project context.")}</span><i>↗</i></button><button className="prompt-card" onClick={() => setDraft(t("Help me inspect a model"))}><strong>{t("Inspect a model")}</strong><span>{t("Compare model details and find a good fit.")}</span><i>↗</i></button><button className="prompt-card" onClick={() => setDraft(t("Help me draft a clear message"))}><strong>{t("Write something")}</strong><span>{t("Turn a rough idea into a polished first draft.")}</span><i>↗</i></button><button className="prompt-card" onClick={() => setDraft(t("Help me write a code example"))}><strong>{t("Write code")}</strong><span>{t("Explain a coding task and get a useful starting point.")}</span><i>↗</i></button></div>}</div>;

    const contextPanel = <div className="tab-panel">
      <div className="panel-card">
        <h3>{t("System prompt")}</h3>
        <textarea className="panel-textarea" value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} placeholder={t("Optional instructions for every reply in this conversation.")} rows={5} />
        <p className="panel-note">{t("Sent with every message in this conversation.")}</p>
      </div>
      <div className="panel-card">
        <h3>{t("Conversation")}</h3>
        <div className="panel-row"><span>{t("Workspace")}</span><strong>{filesRoot || t("No workspace selected")}</strong></div>
        <div className="panel-row"><span>{t("Conversation mode")}</span><strong>{composerMode === "code" ? t("Code") : t("Chat")}</strong></div>
        <div className="panel-row"><span>{t("Model")}</span><strong>{modelTitle}</strong></div>
        <div className="panel-row"><span>{t("Reasoning")}</span><strong>{effortLevel.label}</strong></div>
        <div className="panel-row"><span>{t("Estimated tokens")}</span><strong>~{totalTokens}</strong></div>
        <div className="panel-actions"><button type="button" className="btn" onClick={() => void chooseWorkspace()}>{t("Choose folder")}</button><button type="button" className="btn ghost" onClick={exportChat}>{t("Export chat")}</button></div>
      </div>
      <div className="panel-card">
        <h3>{t("Telemetry")}</h3>
        <div className="telemetry-grid">
          {[{ label: "GPU", value: stats?.gpu }, { label: "AI", value: stats?.ai }, { label: "VRAM", value: stats?.vramTotal ? stats.vramUsed == null ? null : stats.vramUsed / stats.vramTotal * 100 : null, text: stats?.vramUsed != null && stats?.vramTotal != null ? stats.vramUsed + "/" + stats.vramTotal + " GB" : undefined }, { label: "RAM", value: stats?.ramTotal ? stats.ramUsed / stats.ramTotal * 100 : null, text: stats ? (stats.ramUsed / 1024).toFixed(1) + "/" + (stats.ramTotal / 1024).toFixed(1) + " GB" : undefined }].map((item) => <div className="telemetry-item" key={item.label}><div><span>{item.label}</span><strong>{item.text || (item.value != null ? Math.round(item.value) + "%" : "—")}</strong></div><div className="telemetry-track"><i style={{ width: Math.max(0, Math.min(100, item.value || 0)) + "%" }} /></div></div>)}
        </div>
      </div>
    </div>;

    const tracePanel = <div className="tab-panel">
      <div className="panel-card">
        <h3>{t("Tool activity")}</h3>
        {toolCall.status === "idle"
          ? <p className="panel-note">{t("No tool calls in this conversation yet.")}</p>
          : <div className="trace-row"><span className={"trace-dot " + toolCall.status} aria-hidden="true" /><span>{t(toolCall.message || toolCall.status)}</span></div>}
        {approvals.length > 0 && <div className="trace-list">{approvals.map((approval) => <div className="trace-row" key={approval.id}><span className="trace-tool">{approval.tool}</span><span className="mono">{approval.risk}</span><span className="trace-actions"><button type="button" className="btn" onClick={() => void decideApproval(approval.id, "approve")} disabled={approvalsBusy}>{t("Approve")}</button><button type="button" className="btn ghost" onClick={() => void decideApproval(approval.id, "deny")} disabled={approvalsBusy}>{t("Deny")}</button></span></div>)}</div>}
        {approvalsError && <p className="error">{approvalsError}</p>}
      </div>
      <div className="panel-card">
        <h3>{t("Recent activity")}</h3>
        {termEntries.length === 0
          ? <p className="panel-note">{t("Nothing has been logged yet.")}</p>
          : <div className="trace-log">{termEntries.slice(-40).map((entry, index) => <div className="trace-line" key={index}><span className="term-time">{entry.time}</span><span className={"term-tag " + entry.tag}>{entry.tag.toUpperCase()}</span><span className="trace-text">{entry.text}</span></div>)}</div>}
      </div>
    </div>;

    // Tool runs belong to the conversation, not a separate page: one collapsible
    // row that stays quiet until there is something to show.
    const toolCard = (toolCall.status !== "idle" || approvals.length > 0)
      ? <details className="tool-card">
          <summary><span className={"trace-dot " + toolCall.status} aria-hidden="true" />{t("Tool activity")}{approvals.length > 0 ? " · " + approvals.length + " " + t("pending approvals") : ""}</summary>
          <div className="tool-card-body">
            {toolCall.message ? toolCall.message + "\n" : ""}
            {approvals.map((approval) => "• " + approval.tool + " · " + approval.risk).join("\n")}
          </div>
        </details>
      : null;

    return <section className="chat-page">
      <div className="page-head chat-head">
        {renamingSession
          ? <form className="rename-session" onSubmit={(event) => { event.preventDefault(); commitRenameSession(); }}><input autoFocus value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setRenamingSession(false); }} aria-label={t("Conversation name")} /><button className="btn primary" type="submit">{t("Save name")}</button></form>
          : <h1 className="chat-title" title={t("Double-click to rename")} onDoubleClick={beginRenameSession}>{sessionName}</h1>}
        <nav className="chat-tabs" role="tablist" aria-label={t("Conversation views")}>
          {(["chat", "context", "trace"] as const).map((tab) => <button key={tab} type="button" role="tab" aria-selected={chatTab === tab} className={chatTab === tab ? "active" : ""} onClick={() => setChatTab(tab)}>{t(tab === "chat" ? "Chat" : tab === "context" ? "Context" : "Trace")}</button>)}
        </nav>
        <div className="chat-head-actions">
          <div className="conversation-menu-wrap" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setConversationMenuOpen(false); }}>
            <button type="button" className="btn ghost icon-button" aria-label={t("Conversation actions")} aria-haspopup="menu" aria-expanded={conversationMenuOpen} onClick={() => setConversationMenuOpen((value) => !value)}>⋯</button>
            {conversationMenuOpen && <div className="conversation-menu" role="menu">
              <button type="button" role="menuitem" onClick={beginRenameSession}>{t("Rename conversation")}</button>
              <button type="button" role="menuitem" onClick={() => { toggleCurrentPin(); setConversationMenuOpen(false); }}>{t(savedSessions.find((item) => item.id === currentSessionId)?.pinned ? "Unpin conversation" : "Pin conversation")}</button>
              <button type="button" role="menuitem" onClick={() => { exportChat(); setConversationMenuOpen(false); }}>{t("Export chat")}</button>
              <hr />
              <button type="button" role="menuitem" className="danger" onClick={() => { clearCurrentConversation(); setConversationMenuOpen(false); }}>{t("Clear conversation")}</button>
            </div>}
          </div>
        </div>
      </div>
      {chatTab === "chat" && <>
        <ChatViewport messages={messages} footer={toolCard} followSignal={followSignal} empty={emptyChat} busy={chatBusy} onEditMessage={editMessage} onRegenerateMessage={regenerateMessage} onDeleteMessage={deleteMessageTurn} onBranchMessage={branchFrom} onRetryMessage={retryMessage} />
        {messages.length > 0 && composer}
      </>}
      {chatTab === "context" && <div className="chat-tab-body">{contextPanel}</div>}
      {chatTab === "trace" && <div className="chat-tab-body">{tracePanel}</div>}
    </section>;
  }

  function renderProviders() {
    return <div className="models-section">
      <div className="section-head">
        <div><h3>{t("Cloud providers")}</h3><p className="subtitle">{t("Add a provider once, then pick any of its models from the composer.")}</p></div>
        {!providerForm && <button type="button" className="btn primary" onClick={() => openProviderForm()}>{t("Add provider")}</button>}
      </div>
      {providerError && <div className="error" role="alert">{providerError}</div>}
      {providers.length === 0 && !providerForm && <div className="card empty-state">
        <strong>{t("No cloud provider yet.")}</strong>
        <span>{t("Add OpenAI, DeepSeek, Claude or any OpenAI-compatible endpoint.")}</span>
        <button type="button" className="btn primary" onClick={() => openProviderForm()}>{t("Add provider")}</button>
      </div>}
      {providers.length > 0 && <div className="provider-list">{providers.map((provider) => <article className={"provider-card" + (provider.id === activeProviderId ? " active" : "")} key={provider.id}>
        <div className="provider-main">
          <span className="provider-dot" data-kind={provider.kind} aria-hidden="true" />
          <div><strong>{provider.label}</strong><small className="mono">{provider.base_url || "—"}</small></div>
        </div>
        <div className="provider-meta">
          <span className="chip">{provider.models.length} {t("models")}</span>
          <span className={"status-pill " + (provider.has_key ? "success" : "warning")}><span className="status-dot" />{provider.has_key ? t("Key saved") : t("No key")}</span>
          {provider.max_effort && <span className="chip accent">Max</span>}
        </div>
        <div className="provider-actions">
          {provider.id === activeProviderId
            ? <span className="chip accent">{t("In use")}</span>
            : <button type="button" className="btn" onClick={() => void providerAction({ action: "select", id: provider.id }).then((ok) => { if (ok) void loadCloud(); })} disabled={providersBusy}>{t("Use this provider")}</button>}
          <button type="button" className="btn ghost" onClick={() => openProviderForm(provider.id)}>{t("Edit")}</button>
          <button type="button" className="btn danger" onClick={() => void providerAction({ action: "delete", id: provider.id })} disabled={providersBusy}>{t("Delete")}</button>
        </div>
      </article>)}</div>}
      {providerForm && renderProviderForm()}
    </div>;
  }

  function renderProviderForm() {
    const form = providerForm;
    if (!form) return null;
    const update = (patch: Partial<typeof form>) => setProviderForm((current) => current ? { ...current, ...patch } : current);
    const addDraft = () => {
      const name = form.modelDraft.trim();
      if (!name) return;
      update({ models: form.models.includes(name) ? form.models : [...form.models, name], modelDraft: "" });
    };
    return <div className="card provider-form">
      <div className="provider-form-head">
        <h3>{form.id ? t("Edit provider") : t("Add provider")}</h3>
        <button type="button" className="btn ghost" onClick={() => setProviderForm(null)}>{t("Close")}</button>
      </div>
      <div className="segmented provider-form-tabs">
        <button type="button" className={form.tab === "catalog" ? "active" : ""} onClick={() => update({ tab: "catalog" })}>{t("Provider catalog")}</button>
        <button type="button" className={form.tab === "custom" ? "active" : ""} onClick={() => update({ tab: "custom" })}>{t("Custom API")}</button>
      </div>
      {form.tab === "catalog" && <div className="provider-catalog">{PROVIDER_CATALOG.map((preset) => <button type="button" key={preset.id} className={"catalog-pill" + (form.catalogId === preset.id ? " active" : "")} onClick={() => applyCatalog(preset.id)}>
        <strong>{t(preset.label)}</strong><small className="mono">{preset.base || t("Custom endpoint")}</small>
      </button>)}</div>}
      <div className="setting-row"><label>{t("Name")}</label><div className="controls"><input value={form.label} onChange={(event) => update({ label: event.target.value })} placeholder="DeepSeek" /></div></div>
      <div className="setting-row"><label>{t("Base URL")}</label><div className="controls"><input className="mono" value={form.base_url} onChange={(event) => update({ base_url: event.target.value })} placeholder="https://api.deepseek.com/v1" /></div></div>
      <div className="setting-row"><label>{t("API key")}<span className="hint">{t("Stored on this computer by the gateway.")}</span></label><div className="controls"><input type="password" value={form.api_key} onChange={(event) => update({ api_key: event.target.value })} placeholder={form.id ? t("Leave empty to keep the saved key") : "sk-..."} /></div></div>
      <div className="setting-row"><label>{t("Protocol")}</label><div className="controls segmented">{([["openai", "OpenAI compatible"], ["anthropic", "Anthropic"], ["openclaw", "OpenClaw"]] as const).map(([kind, label]) => <button type="button" key={kind} className={form.kind === kind ? "active" : ""} onClick={() => update({ kind })}>{t(label)}</button>)}</div></div>
      <div className="setting-row"><label>{t("Models")}<span className="hint">{t("Fetched from the provider, or add a name by hand.")}</span></label><div className="controls"><input value={form.modelDraft} onChange={(event) => update({ modelDraft: event.target.value })} placeholder="deepseek-chat" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addDraft(); } }} /><button type="button" className="btn" onClick={addDraft}>{t("Add")}</button>{form.id && <button type="button" className="btn" onClick={() => void providerAction({ action: "fetch_models", id: form.id })} disabled={providersBusy}>{t("Fetch from provider")}</button>}</div></div>
      {form.models.length > 0 && <div className="chip-row">{form.models.map((name) => <span className="chip" key={name}>{name}<button type="button" aria-label={t("Remove")} onClick={() => update({ models: form.models.filter((entry) => entry !== name) })}>×</button></span>)}</div>}
      <details className="provider-advanced">
        <summary>{t("Advanced")}</summary>
        <div className="setting-row"><label>{t("Agent id")}<span className="hint">{t("OpenClaw only")}</span></label><div className="controls"><input value={form.agent_id} onChange={(event) => update({ agent_id: event.target.value })} placeholder="main" /></div></div>
        <div className="setting-row"><label>{t("Max output tokens")}</label><div className="controls"><input type="number" min={0} step={256} value={form.max_tokens || ""} placeholder="0" onChange={(event) => update({ max_tokens: Math.max(0, Math.floor(Number(event.target.value) || 0)) })} /></div></div>
        <div className="setting-row"><label>{t("Supports Max reasoning")}<span className="hint">{t("Enable to unlock the Max stop.")}</span></label><div className="controls"><button type="button" className={"switch" + (form.max_effort ? " on" : "")} aria-pressed={form.max_effort} aria-label={t("Supports Max reasoning")} onClick={() => update({ max_effort: !form.max_effort })}><span /></button></div></div>
      </details>
      <div className="provider-form-actions">
        <button type="button" className="btn" onClick={() => setProviderForm(null)}>{t("Cancel")}</button>
        <button type="button" className="btn primary" onClick={() => void submitProviderForm()} disabled={providersBusy || !form.base_url.trim()}>{t("Save provider")}</button>
      </div>
    </div>;
  }

  function renderRemote() {
    return <div className="models-section">
      <div className="remote-intro">
        <h3>{t("Remote hosts")}</h3>
        <p className="subtitle">{t("Connect to a friend's computer through a tunnel and a key, and run your models on their hardware. Conversations are still stored on this device.")}</p>
      </div>
      <div className="card">
        <div className="setting-row"><label>{t("Tunnel address")}</label><div className="controls"><input value={serverBase} onChange={(event) => setServerBase(event.target.value)} placeholder="https://xxxx.trycloudflare.com" /></div></div>
        <div className="setting-row"><label>{t("Share name")}<span className="hint">{t("host name")}</span></label><div className="controls"><input value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="Hymnix Orbit" /></div></div>
        <div className="setting-row"><label>{t("Connection password")}<span className="hint">{t("given by the host")}</span></label><div className="controls"><input type="password" value={guestPassword} onChange={(event) => setGuestPassword(event.target.value)} /><button type="button" className="btn" onClick={() => void testConnection()} disabled={netBusy || shareTest.state === "testing"}>{t(shareTest.state === "testing" ? "Testing..." : "Test connection")}</button><button type="button" className="btn primary" onClick={() => void guestConnect().then((ok) => { if (ok) setShareTest({ state: "ok", message: t("Connected. Chats now run on the friend's hardware.") }); })} disabled={netBusy}>{netBusy ? t("Working...") : mode === "remote" ? t("Reconnect") : t("Connect")}</button></div></div>
        {shareTest.state === "fail" && <ErrorPanel title={t("Could not connect")} cause={shareTest.category || shareTest.message} fix={t("Try again")} onFix={() => void testConnection()} details={shareTest.message} />}
        {shareTest.state === "ok" && <p className="panel-note success-text" role="status">✓ {shareTest.message}</p>}
        {mode === "remote" && <div className="setting-row"><label>{t("Connected")}</label><div className="controls"><span className="status-pill success"><span className="status-dot" />{serverBase}</span><button type="button" className="btn danger" onClick={disconnectGuest}>{t("Disconnect and use this computer")}</button></div></div>}
        <div className="favourite-row"><button type="button" className="btn tonal" onClick={rememberHost} disabled={!serverBase.trim()}>{t("Save to favourites")}</button>{savedHosts.length > 0 && <span className="hint">{savedHosts.length} {t("saved hosts")}</span>}</div>
        {savedHosts.length > 0 && <div className="host-list">{savedHosts.map((host) => <div className="host-row" key={host.url}><button type="button" className="panel-link" onClick={() => { setServerBase(host.url); setGuestName(host.name); }}><strong>{host.name}</strong><small>{host.url}</small></button><button type="button" className="btn ghost" onClick={() => forgetHost(host.url)}>{t("Remove")}</button></div>)}</div>}
      </div>
      <div className="card share-cta">
        <div><h3>{t("Share this computer instead")}</h3><p className="subtitle">{t("Let a friend run their chats on your hardware.")}</p></div>
        <button type="button" className="btn" onClick={() => setActive("Gateway")}>{t("Open sharing")}</button>
      </div>
    </div>;
  }

  function renderModels() {
    const tabs: Array<"Installed" | "Discover" | "Downloads"> = ["Installed", "Discover", "Downloads"];
    return <section className="page models-page">
      <div className="page-head">
        <div className="page-head-copy"><h2>{t("Models")}</h2><p>{t("Choose where replies run: this computer, a cloud provider, or a friend's machine.")}</p></div>
        <div className="page-actions">{modelsSection === "local" && <button type="button" className="btn" onClick={() => void loadModels()}>{t("Refresh models")}</button>}</div>
      </div>
      <nav className="section-tabs" role="tablist" aria-label={t("Model sources")}>
        {([
          ["local", t("Local models"), t("Runs on this computer.")],
          ["api", t("Cloud API"), t("Saved provider profiles.")],
          ["remote", t("Remote hosts"), t("Runs on a friend's machine over a tunnel.")]
        ] as const).map(([key, label, hint]) => <button key={key} type="button" role="tab" aria-selected={modelsSection === key} className={modelsSection === key ? "active" : ""} onClick={() => setModelsSection(key)}>
          <strong>{label}</strong><small>{hint}</small>
        </button>)}
      </nav>
      {modelsSection === "local" && <div className="models-section">
        {renderOllamaNotice()}
        <div className="tab-strip model-tabs" role="tablist" aria-label={t("Model sections")}>{tabs.map((tab) => <button role="tab" aria-selected={modelsTab === tab} className={modelsTab === tab ? "tab active" : "tab"} key={tab} onClick={() => setModelsTab(tab)}>{t(tab)}{tab === "Downloads" && downloadOccupied ? <span className="count-badge">1</span> : null}</button>)}</div>
        {modelsTab === "Installed" && <div className="card model-table-card">
          <div className="section-heading"><div><h3 className="card-title">{t("Installed models")}</h3><p className="subtitle">{tf("{count} models on this device", { count: models.length })}</p></div></div>
          {models.length === 0 && state === "starting" ? <SkeletonList rows={4} /> : models.length === 0 ? <div className="empty-state"><strong>{t("No model installed yet.")}</strong><span>{t("Choose a model that fits your hardware from Discover.")}</span><button type="button" className="btn primary" onClick={() => setModelsTab("Discover")}>{t("Discover models")}</button></div> : <div className="model-table"><div className="model-table-head"><span>{t("Name")}</span><span>{t("Status")}</span><span>{t("Actions")}</span></div>{models.map((item) => <div className="model-table-row" key={item.name}>
            <span className="catalog-main"><strong>{item.name}</strong><small>{item.name.split(":")[1] || t("Installed model")}</small></span>
            <span className={item.loaded ? "status-pill success" : "status-pill neutral"}><span className="status-dot" />{item.loaded ? t("Loaded") : t("Installed")}</span>
            <span className="controls"><button type="button" className={item.loaded ? "btn" : "btn primary"} onClick={() => { setModel(item.name); void modelAction(item.loaded ? "stop" : "start", item.name); }} disabled={modelBusy === item.name}>{(item.name && modelBusy === item.name) ? t("Loading...") : item.loaded ? t("Unload") : t("Load")}</button><button type="button" className="btn danger" onClick={() => setModelDeleteTarget(item.name)} disabled={modelBusy === item.name}>{t("Delete")}</button></span>
          </div>)}</div>}
        </div>}
        {modelsTab === "Discover" && <ModelCatalog installedNames={models.map((item) => item.name)} filters={catalogFilters} onFiltersChange={setCatalogFilters} lang={lang} remote={remoteActive()} downloadDisabled={!!modelBusy} activeDownload={downloadOccupied ? download?.model : undefined} downloadPaused={download?.phase === "paused"} onDownload={(name) => void pullModelByName(name)} note={modelNote} />}
        {modelsTab === "Downloads" && <div className="card download-list"><h3 className="card-title">{t("Downloads")}</h3>{download ? (() => {
          const percent = download.completed != null && download.total ? Math.floor(100 * download.completed / download.total) : null;
          const eta = download.bytesPerSecond && download.total && download.completed != null && download.bytesPerSecond > 0
            ? Math.max(0, Math.round((download.total - download.completed) / download.bytesPerSecond)) : null;
          return <div className="download-row">
            <span className="model-mark">↓</span>
            <span className="catalog-main"><strong>{download.model}</strong><small>{t(download.phase)} · {download.status || downloadStage(download.status)}</small>
              {download.phase === "downloading" && <div className="download-inline"><div className="progress"><i style={{ width: (percent ?? 0) + "%" }} /></div><small>{percent != null ? percent + "%" : ""}{download.bytesPerSecond ? " · " + downloadBytes(download.bytesPerSecond, lang) + "/s" : ""}{eta != null ? " · " + formatDuration(eta) + " " + t("left") : ""}</small></div>}
            </span>
            <span className="controls"><span className="status-pill">{download.phase === "downloading" ? t("In progress") : t(download.phase)}</span>
              {download.phase === "downloading" && <button type="button" className="btn" onClick={() => stopModelDownload("pause")}>{t("Pause download")}</button>}
              {download.phase === "paused" && <button type="button" className="btn primary" onClick={resumeModelDownload}>{t("Resume download")}</button>}
              {download.phase !== "complete" && download.phase !== "failed" && <button type="button" className="btn danger" onClick={() => stopModelDownload("cancel")}>{t("Cancel download")}</button>}
              {(download.phase === "complete" || download.phase === "failed" || download.phase === "cancelled") && <button type="button" className="btn" onClick={() => setDownload(null)}>{t("Close")}</button>}
            </span>
          </div>;
        })() : <div className="empty-state"><strong>{t("No active downloads")}</strong><span>{t("Downloads you start will appear here.")}</span><button type="button" className="btn primary" onClick={() => setModelsTab("Discover")}>{t("Discover models")}</button></div>}</div>}
      </div>}
      {modelsSection === "api" && renderProviders()}
      {modelsSection === "remote" && renderRemote()}
    </section>;
  }

  function renderTerminal() {
    const hints = [t("↑ history"), "Tab " + t("complete"), t("scroll to inspect")].join(" · ");
    // System rows that carry a warning are promoted to their own level, otherwise
    // the Warn filter had nothing to match and showed system chatter instead.
    const levelOf = (item: Entry): Entry["tag"] => item.tag === "err" ? "err" : item.tag === "warn" ? "warn" : item.tag === "sys" && /warn|警告|deprecat/i.test(item.text) ? "warn" : item.tag;
    const visibleTermEntries = termEntries.filter((item) => (terminalFilter === "All" || levelOf(item) === (terminalFilter === "Info" ? "out" : terminalFilter === "Warn" ? "warn" : terminalFilter === "Error" ? "err" : "sys")) && (!terminalSearch.trim() || item.text.toLowerCase().includes(terminalSearch.trim().toLowerCase())));
    return <section className="term-shell">
      <div className="term-head"><span className="term-title">HYMNIX ORBIT <i>//</i> TERMINAL</span><span className="term-clock">{stamp()}<i className="term-bars"><b /><b /><b /><b /></i></span></div>
      <div className="term-status">
        <span className="term-key">STATUS</span>
        <span className="term-pill">LINK <b>{t(state)}</b></span>
        <span className="term-pill">CWD <b>{filesRoot || "-"}</b></span>
        <span className="term-pill">PROC <b>{termBusy ? "running" : "idle"}</b></span>
        <span className="term-pill">MODEL <b>{model || "-"}</b></span>
        <span className="term-pill">TUN <b>{tunnelState}</b></span>
        <span className="term-pill">GPU <b>{stats?.gpu != null ? stats.gpu + "%" : "-"}</b></span>
        <span className="term-pill">VRAM <b>{stats?.vramUsed != null ? stats.vramUsed + "/" + stats.vramTotal + "G" : "-"}</b></span>
        <span className="term-pill">RAM <b>{stats ? (stats.ramUsed / 1024).toFixed(1) + "/" + (stats.ramTotal / 1024).toFixed(1) : "-"}G</b></span>
      </div>
      <div className="term-model">
        <span className="term-key">MODEL</span>
        <select value={model} onChange={(event) => setModel(event.target.value)}>{models.length === 0 && <option value="-">{t("No model list loaded")}</option>}{models.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select>
        <button className="term-btn" onClick={() => setActive("Models")}>APPLY</button>
        <span className="term-dim">BILL</span>
        <span className="term-dim">QUOTA {models.length}</span>
        <button className="term-btn" onClick={() => void loadModels()}>SAVE</button>
      </div>
      {bridgeConnection && <details className="term-bridge-connection">
        <summary>{t("Local reply bridge connection")}</summary>
        <label>{t("Endpoint")} <input aria-label={t("Endpoint")} readOnly value={bridgeConnection.endpoint} /></label>
        <label>{t("Bridge token")} <input aria-label={t("Bridge token")} readOnly value={bridgeConnection.token} /></label>
      </details>}
      <div className="term-logbar"><span className="term-log-title">SYS.LOG <small>{visibleTermEntries.length} {t("entries")}</small></span><div className="term-logfilters">{["All", "Info", "Warn", "Error"].map((filter) => <button className={terminalFilter === filter ? "active" : ""} key={filter} onClick={() => setTerminalFilter(filter)}>{t(filter)}</button>)}</div><input ref={terminalSearchRef} className="term-search" type="search" value={terminalSearch} onChange={(event) => setTerminalSearch(event.target.value)} placeholder={tf("Search logs · {shortcut}", { shortcut: "Ctrl+F" })} aria-label={t("Search logs")} /><span className="term-logactions"><button className="term-link" onClick={() => void navigator.clipboard?.writeText(visibleTermEntries.map((item) => item.time + "  " + item.tag.toUpperCase() + "  " + item.text).join("\n"))}>{t("Copy")}</button><button className="term-link" onClick={() => { setTermEntries([]); setBridgeReplies([]); }}>{t("Clear")}</button></span></div>
      <div className="term-body">
        {visibleTermEntries.length === 0 ? <div className="term-line"><span className="term-time">--:--:--.---</span><span className="term-tag sys">SYS</span><span className="term-text dim">{termEntries.length ? t("No entries match these filters") : t("No output yet")}</span></div>
          : visibleTermEntries.map((item, index) => { const level = levelOf(item); return <div className="term-line" key={index}><span className="term-time">{item.time}</span><span className={"term-tag " + level}>{level.toUpperCase()}</span><span className="term-text">{item.text}</span></div>; })}
        {bridgeReplies.length > 0 && <section className="term-bridge-replies" aria-label={t("External replies")}>
          {bridgeReplies.map((reply, index) => <div key={index} className="term-line">
            <span className="term-time">{new Date(reply.receivedAt).toLocaleTimeString()}</span>
            <span className="term-tag out">{reply.provider.toUpperCase()}</span>
            <span className="term-text" data-no-translate dir="auto">{reply.text}</span>
          </div>)}
        </section>}
      </div>
      <form className="term-input" onSubmit={(event) => { event.preventDefault(); void runTerm(); }}>
        <span className="term-caret">&gt;</span>
        <input value={termCmd} onChange={(event) => setTermCmd(event.target.value)} placeholder={t("Type a command…")}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" && termHistory.current.length) { event.preventDefault(); const next = Math.max(0, termCursor.current - 1); termCursor.current = next; setTermCmd(termHistory.current[next] || ""); }
            if (event.key === "ArrowDown" && termHistory.current.length) { event.preventDefault(); const next = Math.min(termHistory.current.length, termCursor.current + 1); termCursor.current = next; setTermCmd(termHistory.current[next] || ""); }
            if (event.key === "Tab") { event.preventDefault(); const builtins = ["help", "status", "models", "clear", "bridge on", "bridge status", "bridge inbox", "bridge off"]; const typed = termCmd.trim(); const match = typed ? builtins.find((name) => name.startsWith(typed)) : undefined; if (match) setTermCmd(match); }
          }} />
        <button className="term-exec" type="submit" disabled={termBusy}>EXEC</button>
      </form>
      <div className="term-foot"><span>UPTIME {health?.uptime_s ? health.uptime_s + "s" : "-"}   LOG N {termEntries.length}</span></div>
      <div className="term-hint">{t("Commands")}: status · models · model [name] · start/stop [name] · pull [name] · tunnel on|off · hardware · config · set [key] [value] · logtail · export · bridge on|status|inbox|off · {hints}</div>
    </section>;
  }

  function renderHistory() {
    const filtered = sessions.filter((item) => {
      const transcript = savedSessions.find((session) => session.id === item.id)?.messages || [];
      return `${item.name} ${item.model} ${transcript.map((message) => message.content).join(" ")}`.toLowerCase().includes(historyQuery.trim().toLowerCase());
    });
    return <section className="view-page">
      <div className="page-head"><div><label>{t("CONVERSATIONS")}</label><h2>{t("History")}</h2><p>{t("Saved conversations on this machine.")}</p></div><button className="btn danger" onClick={() => setClearAllConfirm(true)} disabled={!sessions.length}>{t("Clear all")}</button></div>
      <div className="history-toolbar"><input type="search" value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder={t("Search conversations...")} aria-label={t("Search conversations")} /><span className="hint">{filtered.length} {t("conversations")}</span></div>
      {filtered.length === 0 ? <div className="card empty-state"><div className="empty-orbit" aria-hidden="true">✦</div><strong>{sessions.length ? t("No conversations match your search") : t("Your conversations will appear here")}</strong><span>{sessions.length ? t("Try another search term.") : t("Messages are saved automatically on this device.")}</span><button className="btn primary" onClick={createSession}>{t("Start chatting")}</button></div> : <div className="list conversation-list">{filtered.map((item) => {
        const record = savedSessions.find((session) => session.id === item.id);
        const snippet = record?.messages.find((message) => message.role === "user")?.content || t("No message preview");
        return <div className="list-row conversation-row" key={item.id}>
          <span className="conversation-mark">✦</span>
          <button className="conversation-open" onClick={() => openSession(item.id)}><strong>{item.name}</strong><small>{snippet}</small><span className="conversation-meta"><span className="model-chip">{item.model || t("No model")}</span><span>{item.at ? new Date(item.at).toLocaleString(lang === "zh" ? "zh-CN" : "en-US") : ""}</span></span></button>
          <span className="conversation-actions"><button className="icon-action" title={item.pinned ? t("Unpin") : t("Pin")} aria-label={item.pinned ? t("Unpin conversation") : t("Pin conversation")} onClick={() => togglePinSession(item.id)}>{item.pinned ? "★" : "☆"}</button><button className="icon-action danger-text" title={t("Delete")} aria-label={t("Delete conversation")} onClick={() => deleteSession(item.id)}>×</button></span>
        </div>;
      })}</div>}
    </section>;
  }

  function renderGateway() {
    const online = health?.clients_online ?? hostClients.filter((client) => client.online !== false).length;
    const passwordScore = passwordStrength(hostPassword).score;
    const steps = [
      { key: "name", label: t("Name this computer"), done: !!hostName.trim() },
      { key: "password", label: t("Set a share password"), done: !!hostPassword.trim() && passwordScore >= 2 },
      { key: "share", label: t("Start sharing"), done: tunnelState === "up" },
    ];
    return <section className="view-page">
      <div className="page-head"><div><label>{t("SHARING & CONNECTIONS")}</label><h2>{t("Sharing")}</h2><p>{t("Share this computer's model service with friends. Connecting to a friend or adding a cloud provider lives on the Models page.")}</p></div><button className="btn ghost" onClick={() => { void loadNetwork(); void loadCloud(); void loadHealth(); void loadHostClients(); }}>{t("Refresh")}</button></div>
      <div className="sharing-summary card"><span className={"status-pill " + (tunnelState === "up" ? "success" : "neutral")}><span className="status-dot" />{t(tunnelState === "up" ? "Sharing" : "Not sharing")}</span><span>{t("Clients online")}: <strong>{online}</strong></span><span className="public-link">{tunnelUrl || t("No public link yet")}</span>{tunnelUrl && <button className="btn tonal" onClick={() => void navigator.clipboard?.writeText(tunnelUrl)}>{t("Copy link")}</button>}{tunnelUrl && <button className="btn" onClick={() => setQrOpen(true)}>{t("Show QR code")}</button>}</div>
      <div className="section-head"><div><h3>{t("Share this computer")}</h3><p className="subtitle">{t("People connect with the address and password below; their chats run on your hardware.")}</p></div></div>

        <div className="card">
          <h3 className="card-title">{t("Host a server")}</h3>
          <ol className="share-steps">{steps.map((step, index) => <li key={step.key} className={step.done ? "done" : ""}><span className="share-step-number">{step.done ? "✓" : index + 1}</span>{step.label}</li>)}</ol>
          <div className="setting-row"><label>{t("Share name")}</label><div className="controls"><input value={hostName} onChange={(event) => setHostName(event.target.value)} placeholder="Hymnix Orbit" /><button className="btn" onClick={() => void saveIdentity()}>{t("Save")}</button></div></div>
          <div className="setting-row"><label>{t("Share password")}<span className="hint">{t("required before the tunnel can start")}</span></label><div className="controls"><input type="password" value={hostPassword} onChange={(event) => setHostPassword(event.target.value)} placeholder={t("Set a password")} /><button className="btn" onClick={() => { const next = Array.from(crypto.getRandomValues(new Uint8Array(10))).map((value) => "abcdefghjkmnpqrstuvwxyz23456789"[value % 32]).join(""); setHostPassword(next); void window.hymnix.network.saveIdentity({ host_password: next }); }}>{t("Generate")}</button><button className="btn" onClick={() => void navigator.clipboard?.writeText(hostPassword)} disabled={!hostPassword}>{t("Copy")}</button></div></div>
          <PasswordMeter password={hostPassword} />
          {!!hostPassword.trim() && passwordScore < 2 && <p className="panel-note warning-text">{t("Use at least 10 characters so friends cannot guess the password.")}</p>}
          <div className="setting-row"><label>{t("Tunnel state")}</label><div className="controls"><span className="inline-status"><span className="dot" data-state={tunnelState === "up" ? "ready" : tunnelState === "starting" ? "connecting" : tunnelState === "failed" || tunnelState === "lost" ? "error" : "idle"} aria-hidden="true" /><strong>{t({ off: "Not started", starting: "Starting", up: "Ready", lost: "Disconnected", failed: "Failed" }[tunnelState] || "Not started")}</strong></span><button className="btn primary" onClick={() => { if (tunnelState === "up" || tunnelState === "starting") { if (online > 0) setStopShareConfirm(true); else void toggleTunnel("stop"); } else void toggleTunnel("start"); }} disabled={netBusy || (!hostPassword.trim() && tunnelState !== "up" && tunnelState !== "starting")}>{tunnelState === "up" || tunnelState === "starting" ? t("Stop sharing") : t("Start sharing")}</button><button className="btn" onClick={() => void toggleTunnel("restart")} disabled={netBusy || !hostPassword.trim()}>{t("Restart")}</button></div></div>
          <div className="setting-row"><label>{t("Public address")}</label><div className="controls"><input className="mono" readOnly value={tunnelUrl || t("Not started")} /><button className="btn" onClick={() => void navigator.clipboard?.writeText(tunnelUrl)} disabled={!tunnelUrl}>{t("Copy")}</button><button className="btn" onClick={() => setQrOpen(true)} disabled={!tunnelUrl}>{t("QR code")}</button></div></div>
          {!hostPassword.trim() && <p className="panel-note warning-text">{t("Sharing without a password is blocked.")}</p>}
          <p className="subtitle">{t("Friends connect with this address, name and password. Their chats run on your hardware.")}</p>
        </div>
        <div className="card">
          <h3 className="card-title">{t("Connected people")}</h3>
          {hostClients.length ? <div className="client-list">{hostClients.map((client: any, index: number) => <div className="client-row" key={client.ip || index}>
            <span className="avatar">{index + 1}</span>
            <span><strong>{tf("Client {n}", { n: String(index + 1) })}</strong><small>{client.last_seen || ""} · {client.requests ?? 0} {t("requests")}</small></span>
            <span className="status-pill neutral">{client.online === false ? t("Offline") : t("Online")}</span>
            <button className="btn danger" onClick={() => void disconnectClient(String(client.ip || ""))} disabled={!client.ip}>{t("Disconnect")}</button>
          </div>)}</div> : <div className="empty-inline">{online ? tf("{count} connected · refresh to list them", { count: String(online) }) : t("No one is connected right now.")}</div>}
        </div>

    </section>;
  }
  function renderChangelog() {
    return <section className="page changelog-page">
      <div className="page-head"><h2>{t("Changelog")}</h2></div>
      {changelog.length === 0
        ? <div className="empty-state"><strong>{t("Nothing to show yet")}</strong><span>{t("The release notes ship with the app.")}</span></div>
        : <div className="timeline">{changelog.map((release) => <article className="timeline-row" key={release.version}>
            <div className="timeline-meta">
              <strong>{release.version}</strong>
              {release.date && <small>{release.date}</small>}
            </div>
            <div className="timeline-body">
              {release.groups.map((group) => <section className="timeline-group" key={group.title}>
                <h4>{t(group.title)}</h4>
                {group.items.map((item, index) => <p key={index}>{item}</p>)}
              </section>)}
            </div>
          </article>)}
        </div>}
    </section>;
  }

  function renderPlugins() {
    const enabledCount = plugins.filter((item) => item.enabled).length;
    const loadedCount = plugins.filter((item) => item.loaded).length;
    return <section className="view-page plugin-page">
      <div className="page-head"><div><label>{t("EXTENSIONS")}</label><h2>{t("Plugin center")}</h2><p>{t("Manage local plugins, requested permissions and runtime status.")}</p></div>
        <div className="header-actions"><button type="button" className="btn ghost" onClick={() => void loadPlugins()} disabled={pluginsBusy || !!pluginActionBusy}>{t(pluginsBusy ? "Loading plugins..." : "Refresh plugins")}</button><button type="button" className="btn primary" onClick={() => void installPlugin()} disabled={pluginsBusy || !!pluginActionBusy}>{t("Install local plugin")}</button></div>
      </div>
      <div className="plugin-summary card"><span>{tf("Installed {count} · Enabled {enabled} · Loaded {loaded}", { count: String(plugins.length), enabled: String(enabledCount), loaded: String(loadedCount) })}</span><small>{t("Permissions are granted individually; revoking one stops the plugin.")}</small></div>
      {pluginsError && <div className="error" role="alert">{pluginsError}</div>}
      {pluginsBusy && plugins.length === 0 && !pluginsError && <div className="card empty-state" role="status"><strong>{t("Loading plugins...")}</strong></div>}
      {!pluginsBusy && !pluginsError && plugins.length === 0 && <div className="card empty-state"><strong>{t("No plugins installed")}</strong><span>{t("Install local plugin")}</span></div>}
      <div className="plugin-grid">{plugins.map((item) => {
        const permissions = Array.isArray(item.permissions) ? item.permissions : [];
        const granted = Array.isArray(item.granted) ? item.granted : [];
        const allGranted = permissions.every((permission) => granted.includes(permission));
        const busy = pluginActionBusy !== "";
        return <article className="card plugin-card" key={item.id}>
          <header className="plugin-card-head"><div><h3>{item.name}</h3><p className="plugin-meta">{item.id} · {t("Version")} {item.version || "—"} · {t("Author")} {item.author || "—"}</p></div><span className={item.loaded ? "status-pill success" : item.enabled ? "status-pill neutral" : "status-pill neutral"}>{t(item.loaded ? "Loaded" : item.enabled ? "Enabled" : "Disabled")}</span></header>
          <p className="plugin-description">{item.description || t("No description")}</p>
          <div className="plugin-meta-row"><span>{t("Capabilities")}: {item.capabilities.length ? item.capabilities.map((value) => t(value)).join(" · ") : "—"}</span><span>{item.source ? t(item.source === "trusted" ? "Trusted source" : "Unverified local source") : ""}</span></div>
          {item.error && <div className="plugin-error" role="alert">{t("Plugin manifest rejected")}: {t(item.error)}</div>}
          <div className="plugin-permissions"><strong>{t("Requested permissions")}</strong>{permissions.length ? permissions.map((permission) => {
            const hasPermission = granted.includes(permission);
            return <div className="plugin-permission" key={permission}><code>{permission}</code><span className={hasPermission ? "permission-state granted" : "permission-state"}>{t(hasPermission ? "Granted" : "Not granted")}</span><button type="button" className="btn ghost" disabled={busy} aria-pressed={hasPermission} onClick={() => void changePlugin(hasPermission ? "revoke" : "grant", item.id, permission)}>{t(hasPermission ? "Revoke" : "Grant")}</button></div>;
          }) : <span className="plugin-no-permissions">{t("No permissions requested")}</span>}</div>
          {!allGranted && <p className="plugin-permission-note">{t("All requested permissions must be granted first.")}</p>}
          <div className="plugin-actions"><button type="button" className={item.enabled ? "btn" : "btn primary"} disabled={busy || (!item.enabled && (!allGranted || !!item.error))} onClick={() => void changePlugin(item.enabled ? "disable" : "enable", item.id)}>{t(item.enabled ? "Disable" : "Enable")}</button>{item.enabled && <button type="button" className="btn" disabled={busy} onClick={() => void changePlugin(item.loaded ? "reload" : "load", item.id)}>{t(item.loaded ? "Reload" : "Load")}</button>}<button type="button" className="btn danger" disabled={busy} onClick={() => setPluginDeleteTarget(item)}>{t("Uninstall")}</button></div>
        </article>;
      })}</div>
    </section>;
  }
  function renderMonitor() {
    const statusLabel = state === "ready" ? t("Ready") : state === "connecting" ? t("Starting") : t(state);
    const clients = Array.isArray(statusData?.clients) ? statusData.clients : [];
    const recent = Array.isArray(statusData?.recent) ? statusData.recent : [];
    return <section className="view-page">
      <div className="page-head"><div><label>{t("GATEWAY MONITOR")}</label><h2>{t("Monitor")}</h2><p>{t("Review gateway health, usage and active operations.")}</p></div><div className="header-actions"><label className="inline-toggle"><input type="checkbox" checked={monitorAutoRefresh} onChange={(event) => setMonitorAutoRefresh(event.target.checked)} />{t("Auto refresh · 5s")}</label><button className="btn ghost" onClick={() => { void loadHealth(); if (adminKey.trim()) void loadStatus(); void pollTunnel(); }}>{t("Refresh")}</button></div></div>
      <div className="metric-grid">
        <div className="metric-card"><span>{t("Status")}</span><strong><i className={"status-dot " + (state === "ready" ? "success" : "warning")} />{statusLabel}</strong><small>{health?.gateway || t("Gateway")}</small></div>
        <div className="metric-card"><span>{t("Models")}</span><strong>{health?.models ?? models.length}</strong><small>{health?.ollama ? t("Model service online") : t("Model service offline")}</small></div>
        <div className="metric-card"><span>{t("Clients online")}</span><strong>{health?.clients_online ?? statusData?.online ?? 0}</strong><small>{t("Connected devices")}</small></div>
        <div className="metric-card"><span>{t("Uptime")}</span><strong>{formatDuration(health?.uptime_s)}</strong><small>{t("Since gateway start")}</small></div>
      </div>
      <div className="card monitor-details"><h3 className="card-title">{t("Service details")}</h3>
        <div className="detail-grid"><span>{t("Version")}</span><strong>{health?.gateway || statusData?.gateway?.version || "—"}</strong><span>{t("Gateway address")}</span><strong className="mono">{gatewayBase.replace("http://", "")}</strong><span>{t("Model service")}</span><strong>{health?.ollama ? t("Online") : t("Offline")}</strong><span>{t("Tunnel")}</span><strong>{t({ off: "Not started", starting: "Starting", up: "Ready", lost: "Disconnected", failed: "Failed" }[tunnelState] || "Not started")}</strong><span>{t("Public address")}</span><strong className="mono">{tunnelUrl || "—"}</strong></div>
      </div>
      <div className="card"><div className="setting-row admin-key-row"><label>{t("Admin key")}<span className="hint">{t("Needed only to view gateway details.")}</span></label><div className="controls"><input type="password" value={adminKey} onChange={(event) => setAdminKey(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadStatus(); }} placeholder={t("Admin key")} /><button className="btn primary" onClick={() => void loadStatus()}>{t("Load details")}</button><button className="btn" onClick={() => void rememberAdminKey(true)} disabled={!adminKey.trim()}>{t("Remember on this device")}</button><button className="btn ghost" onClick={() => void rememberAdminKey(false)}>{t("Forget")}</button></div></div>{statusError && <p className="error">{statusError}</p>}</div>
      <div className="card"><h3 className="card-title">{t("Connected clients")}</h3>{clients.length ? <div className="client-list">{clients.map((client: any, index: number) => <div className="client-row" key={index}><span className="avatar">{index + 1}</span><span><strong>{t("Client")} {index + 1}</strong><small>{t("Last active")} · {formatDuration(client.last_seen ? Math.max(0, Math.floor((Date.now() - new Date(client.last_seen).getTime()) / 1000)) : undefined)}</small></span><span className="status-pill neutral">{client.online === false ? t("Offline") : t("Online")}</span></div>)}</div> : <div className="empty-inline">{adminKey ? t("No client details available.") : t("Load gateway details with an admin key to view clients.")}</div>}</div>
      <div className="card"><h3 className="card-title">{t("Recent activity")}</h3>{recent.length ? <div className="activity-list">{recent.slice(0, 8).map((entry: any, index: number) => <div className="activity-row" key={index}><span className="activity-dot" /><span><strong>{entry.model || entry.path || t("Gateway request")}</strong><small>{entry.t || entry.ts || ""} · {entry.status || ""}</small></span><span>{entry.elapsed_ms ? `${entry.elapsed_ms} ms` : ""}</span></div>)}</div> : <div className="empty-inline">{t("Recent activity will appear when gateway details are loaded.")}</div>}</div>
    </section>;
  }

  function renderSupport() {
    return <section className="view-page">
      <div className="page-head"><div><label>{t("SUPPORT")}</label><h2>{t("Sponsor")}</h2><p>{t("Sponsor the project or send feedback.")}</p></div></div>
      <div className="card">
        <div className="setting-row"><label>{t("Sponsor")}<span className="hint">爱发电</span></label><div className="controls"><button className="btn primary" onClick={() => void window.hymnix.system.openExternal("https://ifdian.net/a/hymnixstudio")}>{t("Open sponsor page")}</button></div></div>
        <div className="setting-row"><label>{t("Source code")}<span className="hint">GitHub</span></label><div className="controls"><button className="btn" onClick={() => void window.hymnix.system.openExternal("https://github.com/CarrisFlynn/hymnix-ai-server")}>github.com/CarrisFlynn/hymnix-ai-server</button></div></div>
        <div className="setting-row"><label>{t("License")}</label><div className="controls"><span className="hint">{t("Open source. See LICENSE in the repository.")}</span></div></div>
        <div className="setting-row"><label>{t("Aurora project email")}<span className="hint">Aurora</span></label><div className="controls"><button className="btn" onClick={() => void navigator.clipboard?.writeText("aurora.hymn@outlook.com")}>aurora.hymn@outlook.com</button><span className="hint">{t("Click to copy")}</span></div></div>
        <div className="setting-row"><label>{t("Hymnix Studio email")}</label><div className="controls"><button className="btn" onClick={() => void navigator.clipboard?.writeText("hymnixstudio@outlook.com")}>hymnixstudio@outlook.com</button><span className="hint">{t("Click to copy")}</span></div></div>
        <div className="setting-row"><label>{t("Carris personal email")}</label><div className="controls"><button className="btn" onClick={() => void navigator.clipboard?.writeText("shayhyhmnix@gmail.com")}>shayhyhmnix@gmail.com</button><span className="hint">{t("Click to copy")}</span></div></div>
        <div className="setting-row"><label>{t("Carris on X")}<span className="hint">@ShayHymnix</span></label><div className="controls"><button className="btn" onClick={() => void window.hymnix.system.openExternal("https://x.com/ShayHymnix")}>x.com/ShayHymnix</button></div></div>
      </div>
    </section>;
  }
  async function setSetting(key: keyof typeof DEFAULT_UI_SETTINGS, value: unknown) {
    setUiSettings((current) => ({ ...current, [key]: value }) as typeof current);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1600);
    if (key === "gpuAcceleration" || key === "cacheDir" || key === "dpiScaling") {
      setRestartKeys((current) => current.includes(key) ? current : [...current, key]);
    }
    try { const saved = await window.hymnix.settings.set({ [key]: value }); setUiSettings({ ...DEFAULT_UI_SETTINGS, ...saved }); }
    catch (reason) { setStartupNote(reason instanceof Error ? reason.message : String(reason)); }
  }
  async function resetSection(section: string): Promise<void> {
    if (section === "General") {
      changeLang("en"); setWorkspace("Default workspace");
    } else if (section === "Appearance") {
      changeTheme("camellia-white");
      setDensityPreference("comfortable"); setTextScalePreference(100);
      setMotionPreference(false); setSoftenAccent(false);
    } else if (section === "Startup and runtime") {
      const patch = { betaChannel: false, runAtStartup: false, dpiScaling: false, startFullscreen: false, autoUpdate: true, smoothScroll: true, gpuAcceleration: true };
      setUiSettings((current) => ({ ...current, ...patch }));
      try { setUiSettings({ ...DEFAULT_UI_SETTINGS, ...await window.hymnix.settings.set(patch) }); } catch { /* keep defaults in memory */ }
    } else if (section === "Models and storage") {
      await setSetting("cacheDir", ""); await setSetting("previewMode", "inapp");
    } else if (section === "Sharing and security") {
      try { localStorage.removeItem("hymnix.hosts"); } catch { /* private mode */ }
      setSavedHosts([]); setHostPassword(""); setGuestPassword(""); setShareTest({ state: "idle", message: "" });
    } else if (section === "Shortcuts") {
      setEnterSwaps(false);
    }
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1600);
  }
  async function chooseCacheDir() {
    // Uses its own picker: the workspace picker also repointed the file browser
    // root and the terminal working directory at the cache folder.
    try {
      const picked = await window.hymnix.workspace.chooseCacheDir();
      if (picked?.selected && picked.path) await setSetting("cacheDir", picked.path);
    } catch { /* cancelled */ }
  }
  async function openPreview(target: string) {
    if (uiSettings.previewMode === "browser") { await window.hymnix.system.openExternal(/^https?:/i.test(target) ? target : "file:///" + target.replace(/\\/g, "/")); return; }
    try { await window.hymnix.preview.open(target); setPreviewOpen(true); }
    catch (reason) { setStartupNote(reason instanceof Error ? reason.message : String(reason)); }
  }
  async function closePreview() { try { await window.hymnix.preview.close(); } catch { /* ignore */ } setPreviewOpen(false); }
  async function saveIdentity() {
    try {
      await window.hymnix.network.saveIdentity({ host_name: hostName, host_password: hostPassword });
      setNetError("");
    } catch (reason) { setNetError(reason instanceof Error ? reason.message : String(reason)); }
  }
  async function loadCloud() {
    try {
      const info: any = await window.hymnix.cloud.get();
      setCloudBase(String(info?.base_url || ""));
      setCloudModel(String(info?.model || ""));
      setCloudMasked(String(info?.api_key_masked || ""));
      // The stored key comes back only over loopback; keeping it in state is what
      // makes a chat turn work right after a restart.
      setCloudKey(String(info?.api_key || ""));
      setSource(info?.chat_source === "cloud" ? "cloud" : "local");
      setProviderKind(normalizeProviderKind(info?.kind));
      setAgentId(String(info?.agent_id || ""));
      setProviderMaxTokens(Number(info?.max_tokens || 0) || 0);
      setCloudStatus("");
    } catch (reason) { setCloudStatus(reason instanceof Error ? reason.message : String(reason)); }
  }
  async function loadProviders(): Promise<void> {
    try {
      const data = await window.hymnix.providers.list();
      setProviders(Array.isArray(data.providers) ? data.providers : []);
      setActiveProviderId(String(data.active || ""));
      setProviderError("");
    } catch (reason) { setProviderError(reason instanceof Error ? reason.message : String(reason)); }
  }
  async function providerAction(payload: Record<string, unknown>): Promise<boolean> {
    setProvidersBusy(true); setProviderError("");
    try {
      const data = await window.hymnix.providers.save(payload);
      setProviders(Array.isArray(data.providers) ? data.providers : []);
      setActiveProviderId(String(data.active || ""));
      if (data.ok === false) { setProviderError(String(data.detail || data.error || "provider_error")); return false; }
      return true;
    } catch (reason) { setProviderError(reason instanceof Error ? reason.message : String(reason)); return false; }
    finally { setProvidersBusy(false); }
  }
  async function loadToolPolicy(): Promise<void> {
    try {
      const data = await window.hymnix.config.get();
      const value = String((data?.values as Record<string, unknown>)?.tool_policy || "workspace");
      setToolPolicy(value === "read" || value === "full" ? value : "workspace");
    } catch { /* gateway not ready yet */ }
  }
  async function chooseToolPolicy(next: "read" | "workspace" | "full"): Promise<void> {
    setPolicyMenu(false);
    const previous = toolPolicy;
    setToolPolicy(next);
    try { await window.hymnix.config.set({ tool_policy: next }); }
    catch (reason) { setToolPolicy(previous); setStartupNote(reason instanceof Error ? reason.message : String(reason)); }
  }
  function openProviderForm(id?: string): void {
    const existing = id ? providers.find((item) => item.id === id) : undefined;
    setProviderForm({
      id: existing?.id || "", label: existing?.label || "", kind: existing?.kind || "openai",
      base_url: existing?.base_url || "", api_key: "", models: existing?.models ? [...existing.models] : [],
      max_effort: existing?.max_effort || false, agent_id: existing?.agent_id || "", max_tokens: existing?.max_tokens || 0,
      tab: existing ? "custom" : "catalog", catalogId: existing ? "custom" : "deepseek", modelDraft: ""
    });
  }
  function applyCatalog(id: string): void {
    const preset = PROVIDER_CATALOG.find((item) => item.id === id);
    setProviderForm((current) => current ? {
      ...current, catalogId: id,
      label: preset ? preset.label : current.label,
      kind: preset ? preset.kind : current.kind,
      base_url: preset ? preset.base : current.base_url,
      models: preset && preset.models.length ? [...preset.models] : current.models
    } : current);
  }
  async function submitProviderForm(): Promise<void> {
    if (!providerForm) return;
    const ok = await providerAction({ action: "save", provider: {
      id: providerForm.id, label: providerForm.label || "Provider", kind: providerForm.kind,
      base_url: providerForm.base_url, api_key: providerForm.api_key, models: providerForm.models,
      max_effort: providerForm.max_effort, agent_id: providerForm.agent_id, max_tokens: providerForm.max_tokens
    } });
    if (ok) { setProviderForm(null); setToast({ message: t("Provider saved") }); window.setTimeout(() => setToast(null), 2200); }
  }
  async function chooseModel(choice: { kind: "local" | "cloud" | "remote"; model: string; providerId?: string }): Promise<void> {
    setModelPopover("closed"); setModelQuery("");
    if (choice.kind === "local") { setSource("local"); setModel(choice.model); return; }
    if (choice.kind === "cloud" && choice.providerId) {
      const ok = await providerAction({ action: "select", id: choice.providerId, model: choice.model });
      if (ok) await loadCloud();
      return;
    }
    setModel(choice.model);
  }
  function goConfigure(target: "api" | "remote"): void {
    setModelPopover("closed");
    setActive("Models");
    setModelsSection(target);
    if (target === "api" && !providerForm) openProviderForm();
  }
  function providerDraft() {
    return { kind: providerKind, baseUrl: cloudBase.trim(), apiKey: cloudKey.trim(), model: cloudModel.trim(), agentId: agentId.trim(), maxTokens: providerMaxTokens };
  }
  function switchProviderKind(kind: ProviderKind): void {
    setProviderKind(kind);
    const preset = PROVIDER_PRESETS.find((item) => item.kind === kind) || PROVIDER_PRESETS[0];
    // Only replace an address or model that came from a preset; anything the user
    // typed for a different backend must survive the switch.
    setCloudBase((current) => (!current.trim() || PROVIDER_PRESETS.some((item) => item.base === current.trim()) ? preset.base : current));
    setCloudModel((current) => (!current.trim() || PROVIDER_PRESETS.some((item) => item.model === current.trim()) ? preset.model : current));
    setProviderModels([]);
    setCloudStatus("");
  }
  async function saveCloud() {
    try {
      const info: any = await window.hymnix.cloud.save({ kind: providerKind, base_url: cloudBase.trim(), model: cloudModel.trim(), api_key: cloudKey.trim(), agent_id: agentId.trim(), max_tokens: providerMaxTokens, chat_source: source, cloud_enabled: source === "cloud" });
      setCloudMasked(String(info?.api_key_masked || ""));
      // Keep the key in state: the field is masked on screen, and the next chat
      // turn must not go out without it.
      setCloudStatus(t("Provider settings saved."));
    } catch (reason) { setCloudStatus(reason instanceof Error ? reason.message : String(reason)); }
  }
  async function testCloud() {
    setProviderBusy(true);
    setCloudStatus(t("Testing..."));
    try {
      const result: any = await window.hymnix.provider.probe(providerDraft());
      if (result?.ok) {
        const list: string[] = Array.isArray(result.models) ? result.models : [];
        setProviderModels(list);
        const names = list.slice(0, 4).join(", ");
        setCloudStatus(`${result.latencyMs ?? 0} ms · ${t("Reachable, models:")} ${list.length}${names ? " · " + names : ""}`);
      } else {
        setCloudStatus(String(result?.message || t("Could not reach this provider.")));
      }
    } catch (reason) { setCloudStatus(reason instanceof Error ? reason.message : String(reason)); }
    finally { setProviderBusy(false); }
  }
  async function fetchProviderModels() {
    setProviderBusy(true);
    setCloudStatus(t("Fetching models..."));
    try {
      const result: any = await window.hymnix.provider.models(providerDraft());
      const list: string[] = Array.isArray(result?.models) ? result.models : [];
      setProviderModels(list);
      setCloudStatus(result?.ok ? tf("{count} models returned", { count: String(list.length) }) : String(result?.message || t("No models were returned.")));
    } catch (reason) { setCloudStatus(reason instanceof Error ? reason.message : String(reason)); }
    finally { setProviderBusy(false); }
  }
  async function loadNetwork() {
    try { const info: any = await window.hymnix.network.info(); setHostName(String(info?.host_name || "")); setHostPassword(String(info?.host_password || "")); setTunnelUrl(String(info?.tunnel || "")); }
    catch (reason) { setNetError(reason instanceof Error ? reason.message : String(reason)); }
  }
  function applyTunnel(payload: any) {
    setTunnelState(String(payload?.state || "off"));
    setTunnelUrl(String(payload?.url || ""));
    const nextLog: string[] = Array.isArray(payload?.log) ? payload.log.slice(-12) : [];
    // Diff against the previous snapshot held in a ref. Doing it inside the state
    // updater pushed terminal rows from a render-time function, which StrictMode
    // ran twice and duplicated every tunnel line.
    const fresh = nextLog.filter((line) => !tunnelLogRef.current.includes(line));
    tunnelLogRef.current = nextLog;
    setTunnelLog(nextLog);
    if (fresh.length) setTermEntries((current) => [...current, ...fresh.map((line) => ({ time: stamp(), tag: "sys" as const, text: "[tunnel] " + line }))]);
  }
  async function pollTunnel() {
    try { applyTunnel(await window.hymnix.network.tunnelStatus()); }
    catch { /* gateway not ready yet */ }
  }
  async function loadHostClients(): Promise<void> {
    try { const result: any = await window.hymnix.network.clients(); setHostClients(Array.isArray(result?.clients) ? result.clients : []); }
    catch { /* gateway not ready yet */ }
  }
  async function toggleTunnel(action: "start" | "stop" | "restart") {
    setNetBusy(true); setNetError("");
    try { applyTunnel(await window.hymnix.network.tunnel(action)); }
    catch (reason) { setNetError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setNetBusy(false); }
  }
  function disconnectGuest(): void {
    // Guests had no way back: setMode("remote") was the only transition in the
    // whole file, so a wrong host meant restarting the app.
    cancel();
    setMode("local");
    setApiKey("");
    setShareTest({ state: "idle", message: "" });
    setToast({ message: t("Using this computer again") });
    window.setTimeout(() => setToast(null), 2400);
    void loadHealth(true);
  }
  async function checkUpdates(): Promise<void> {
    setUpdateState({ status: "checking", detail: t("Checking..."), url: "" });
    try {
      const result = await window.hymnix.updates.check();
      if (!result.ok) {
        setUpdateState({ status: "error", detail: result.error || t("Could not check for updates."), url: "" });
        return;
      }
      if (result.newer && result.version) {
        setUpdateState({ status: "available", detail: tf("Version {version} is available.", { version: result.version }), url: result.url || "" });
      } else {
        setUpdateState({ status: "current", detail: tf("You are on the latest version ({version}).", { version: result.current || __APP_VERSION__ }), url: "" });
      }
    } catch (reason) {
      setUpdateState({ status: "error", detail: reason instanceof Error ? reason.message : String(reason), url: "" });
    }
  }
  async function guestConnect(): Promise<boolean> {
    setNetBusy(true); setNetError("");
    try { const result: any = await window.hymnix.network.connect(serverBase.trim(), guestName.trim(), guestPassword); setApiKey(String(result?.token || "")); setMode("remote"); return true; }
    catch (reason) { setNetError(reason instanceof Error ? reason.message : String(reason)); return false; }
    finally { setNetBusy(false); }
  }
  async function testConnection(): Promise<void> {
    if (!serverBase.trim() || !guestPassword) { setShareTest({ state: "fail", message: t("Enter the link and password first."), category: t("Both fields are required.") }); return; }
    setShareTest({ state: "testing", message: t("Testing connection...") });
    try {
      const result: any = await window.hymnix.network.connect(serverBase.trim(), guestName.trim(), guestPassword);
      if (result?.ok === false) throw new Error(result?.error || "connect failed");
      setShareTest({ state: "ok", message: tf("Connected to {name}", { name: String(result?.name || guestName || t("the host")) }) });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      const { hint } = classifyConnectError(message);
      setShareTest({ state: "fail", message, category: t(hint) });
    }
  }
  function rememberHost(): void {
    if (!serverBase.trim()) return;
    const next = [{ url: serverBase.trim(), name: guestName.trim() || t("Friend's server"), at: new Date().toISOString() }, ...savedHosts.filter((item) => item.url !== serverBase.trim())].slice(0, 12);
    setSavedHosts(next);
    try { localStorage.setItem("hymnix.hosts", JSON.stringify(next)); } catch { /* private mode */ }
    setToast({ message: t("Host saved to favourites") });
    window.setTimeout(() => setToast(null), 2200);
  }
  function forgetHost(url: string): void {
    const next = savedHosts.filter((item) => item.url !== url);
    setSavedHosts(next);
    try { localStorage.setItem("hymnix.hosts", JSON.stringify(next)); } catch { /* private mode */ }
  }
  async function disconnectClient(ip: string): Promise<void> {
    try { await window.hymnix.network.disconnect(ip); await loadStatus(); }
    catch (reason) { setStatusError(reason instanceof Error ? reason.message : String(reason)); }
  }
  async function rememberAdminKey(remember: boolean): Promise<void> {
    try {
      if (remember && adminKey.trim()) await window.hymnix.credentials.set("adminKey", adminKey.trim());
      else await window.hymnix.credentials.remove("adminKey");
      setToast({ message: t(remember ? "Admin key stored in the Windows credential vault" : "Admin key removed from this device") });
      window.setTimeout(() => setToast(null), 2600);
    } catch (reason) { setStartupNote(reason instanceof Error ? reason.message : String(reason)); }
  }
  function requestClose(): void {
    let behaviour = "ask";
    try { behaviour = localStorage.getItem("hymnix.closeBehaviour") || "ask"; } catch { /* private mode */ }
    if (tunnelState === "up" && behaviour === "ask") { setClosePromptOpen(true); return; }
    if (tunnelState === "up" && behaviour === "tray") { void window.hymnix.window.control("hide"); return; }
    void window.hymnix.window.control("close");
  }
  function keepSharing(remember: boolean): void {
    if (remember) { try { localStorage.setItem("hymnix.closeBehaviour", "tray"); } catch { /* private mode */ } }
    setClosePromptOpen(false);
    void window.hymnix.window.control("hide");
  }
  async function stopSharingAndClose(): Promise<void> {
    if (tunnelState === "up" || tunnelState === "starting") await toggleTunnel("stop");
    setClosePromptOpen(false);
    void window.hymnix.window.control("close");
  }
  function renderSettings() {
    const sections = ["General", "Appearance", "Startup and runtime", "Models and storage", "Sharing and security", "Shortcuts", "About"];
    const sw = (key: keyof typeof DEFAULT_UI_SETTINGS, label: string, hint: string, disabled = false, restart = false) => <div className={disabled ? "setting-row disabled" : "setting-row"} aria-disabled={disabled}>
      <label>{t(label)}{restart && <span className="chip warning">{t("Restart needed")}</span>}<span className="hint">{t(hint)}</span></label>
      <div className="controls"><button type="button" className={"switch" + (uiSettings[key] ? " on" : "")} aria-pressed={!!uiSettings[key]} aria-label={t(label)} disabled={disabled} onClick={() => void setSetting(key, !uiSettings[key])}><span /></button></div>
    </div>;
    const head = (title: string, section: string) => <div className="card-head"><h3 className="card-title">{t(title)}</h3><button type="button" className="btn ghost reset-button" onClick={() => void resetSection(section)}>{t("Reset to default")}</button></div>;
    // Clicking a card switches to that preset straight away. There is no separate
    // light/dark/auto switch and no hover preview: the card itself is the choice,
    // and only the theme that is actually active can be ticked.
    const themeCards = (mode: "light" | "dark") => THEMES.filter((preset) => preset.mode === mode).map((preset) => {
      const selected = theme === preset.id;
      return <button type="button" key={preset.id} className={"theme-card " + (selected ? "selected" : "")} onClick={() => { changeTheme(preset.id); setToast({ message: t("Saved") }); window.setTimeout(() => setToast(null), 1800); }} aria-pressed={selected} title={t(preset.label)}>
        <span className="theme-preview" style={{ background: preset.bg }}>
          <i style={{ background: preset.surface }} />
          <i style={{ background: preset.swatch }} />
        </span>
        <span className="theme-card-copy"><strong>{t(preset.label)}</strong></span>
        {selected && <span className="theme-check">✓</span>}
      </button>;
    });
    return <section className="view-page">
      <div className="page-head"><div><label>{t("APPLICATION")}</label><h2>{t("Settings")}</h2><p>{t("Workspace and connection preferences.")}</p></div></div>
      <div className="settings-layout"><nav className="settings-nav" aria-label={t("Settings sections")}>{sections.map((section) => <button className={settingsSection === section ? "active" : ""} key={section} onClick={() => setSettingsSection(section)}>{t(section)}</button>)}</nav><div className="settings-content">
        {restartKeys.length > 0 && <div className="restart-bar" role="status"><span>{tf("{count} changes need a restart", { count: String(restartKeys.length) })}</span><button type="button" className="btn primary" onClick={() => void window.hymnix.window.control("restart")}>{t("Restart now")}</button><button type="button" className="btn ghost" onClick={() => setRestartKeys([])}>{t("Later")}</button></div>}
        {settingsSection === "General" && <div className="card">{head("General", "General")}
          <div className="setting-row"><label>{t("Language")}<span className="hint">English / 中文</span></label><div className="controls segmented"><button className={lang === "en" ? "active" : ""} onClick={() => changeLang("en")}>English</button><button className={lang === "zh" ? "active" : ""} onClick={() => changeLang("zh")}>中文</button></div></div>
          <div className="setting-row"><label>{t("Workspace")}</label><div className="controls"><input value={workspace} onChange={(event) => setWorkspace(event.target.value)} aria-label={t("Workspace name")} /></div></div>
        </div>}
        {settingsSection === "Appearance" && <><div className="card">{head("Appearance", "Appearance")}
          <div className="setting-row"><label>{t("Appearance mode")}<span className="hint">{t("Auto follows the Windows light and dark setting.")}</span></label><div className="controls segmented" role="group" aria-label={t("Appearance mode")}><button className={appearanceMode === "light" ? "active" : ""} aria-pressed={appearanceMode === "light"} onClick={() => changeAppearanceMode("light")}>{t("Light")}</button><button className={appearanceMode === "dark" ? "active" : ""} aria-pressed={appearanceMode === "dark"} onClick={() => changeAppearanceMode("dark")}>{t("Dark")}</button><button className={appearanceMode === "auto" ? "active" : ""} aria-pressed={appearanceMode === "auto"} onClick={() => changeAppearanceMode("auto")}>{t("Auto")}</button></div></div>
          <div className="theme-gallery-section"><div className="gallery-heading"><strong>{t("Light themes")}</strong><small>4</small></div><div className="theme-gallery">{themeCards("light")}</div></div><div className="theme-gallery-section"><div className="gallery-heading"><strong>{t("Dark themes")}</strong><small>5</small></div><div className="theme-gallery">{themeCards("dark")}</div></div>
          <div className="setting-row"><label>{t("Density")}<span className="hint">{t("Choose the spacing of rows and controls.")}</span></label><div className="controls segmented"><button className={density === "comfortable" ? "active" : ""} onClick={() => setDensityPreference("comfortable")}>{t("Comfortable")}</button><button className={density === "compact" ? "active" : ""} onClick={() => setDensityPreference("compact")}>{t("Compact")}</button></div></div>
          <div className="setting-row"><label>{t("Text size")}<span className="hint">{t("Scales every label, message and menu.")}</span></label><div className="controls scale-control"><input type="range" min="90" max="150" step="5" value={textScale} onChange={(event) => setTextScalePreference(Number(event.target.value))} aria-label={t("Text size")} /><output>{textScale}%</output></div></div>
          <div className="setting-row"><label>{t("Reduce motion")}<span className="hint">{t("Use fades instead of movement.")}</span></label><div className="controls"><button className={"switch" + (reduceMotion ? " on" : "")} aria-label={t("Reduce motion")} aria-pressed={reduceMotion} onClick={() => setMotionPreference(!reduceMotion)}><span /></button></div></div>
          {(theme.startsWith("neon") || theme.startsWith("cyan")) && <div className="setting-row"><label>{t("Soften accent")}<span className="hint">{t("Lower the accent intensity for long sessions.")}</span></label><div className="controls"><button className={"switch" + (softenAccent ? " on" : "")} aria-label={t("Soften accent")} aria-pressed={softenAccent} onClick={() => setSoftenAccent((value) => !value)}><span /></button></div></div>}
        </div><p className={"settings-saved" + (savedFlash ? " flash" : "")} role="status">{savedFlash ? "✓ " + t("Saved") : "✓ " + t("Changes are saved automatically")}</p></>}
        {settingsSection === "Startup and runtime" && <div className="card">{head("Startup and runtime", "Startup and runtime")}{sw("betaChannel", "Join client beta", "Pre-release builds, may be unstable")}{sw("runAtStartup", "Run at system startup", "Start minimized in the tray")}{sw("startFullscreen", "Start in fullscreen", "Open the window fullscreen")}</div>}
        {settingsSection === "Models and storage" && <div className="card">{head("Models and storage", "Models and storage")}
          <div className="setting-row path-row"><label>{t("Cache storage location")}<span className="hint">{uiSettings.cacheDir ? t("Custom folder") : t("System default")}</span></label><div className="controls"><input readOnly value={uiSettings.cacheDir || paths?.cache || paths?.cacheDefault || ""} title={uiSettings.cacheDir || paths?.cache || ""} /><button className="btn" onClick={() => void chooseCacheDir()}>{t("Choose folder")}</button>{uiSettings.cacheDir && <button className="btn ghost" onClick={() => void setSetting("cacheDir", "")}>{t("Reset")}</button>}</div></div>
          <div className="setting-row"><label>{t("File preview")}<span className="hint">{t("Where a clicked file opens.")}</span></label><div className="controls segmented"><button className={uiSettings.previewMode === "inapp" ? "active" : ""} onClick={() => void setSetting("previewMode", "inapp")}>{t("In-app window")}</button><button className={uiSettings.previewMode === "browser" ? "active" : ""} onClick={() => void setSetting("previewMode", "browser")}>{t("Default browser")}</button></div></div>
          <div className="setting-row path-row"><label>{t("Data folder")}<span className="hint">{t("Sessions, settings and logs.")}</span></label><div className="controls"><input readOnly value={paths?.appData || ""} title={paths?.appData || ""} /><button className="btn" onClick={() => { if (paths?.appData) void window.hymnix.system.reveal(paths.appData); }} disabled={!paths?.appData}>{t("Open folder")}</button></div></div>
        </div>}
        {settingsSection === "Sharing and security" && <div className="card settings-link-card">{head("Sharing and security", "Sharing and security")}<p className="subtitle">{t("Configure host sharing, connections and cloud provider credentials.")}</p><button className="btn primary" onClick={() => setActive("Gateway")}>{t("Open sharing settings")}</button></div>}
                {settingsSection === "Shortcuts" && <div className="card">{head("Shortcuts", "Shortcuts")}<div className="setting-row"><label>{t("Send with Shift+Enter")}<span className="hint">{t("Swap the Enter and Shift+Enter behaviour.")}</span></label><div className="controls"><button type="button" className={"switch" + (enterSwaps ? " on" : "")} aria-pressed={enterSwaps} aria-label={t("Send with Shift+Enter")} onClick={() => setEnterSwaps((value) => !value)}><span /></button></div></div><div className="shortcut-list">{[["Ctrl+N", "New session"], ["Ctrl+L", "Focus message composer"], ["Ctrl+B", "Toggle sidebar"], ["Ctrl+.", "Toggle inspector"], ["Ctrl+,", "Open settings"], ["Ctrl+/", "Open the shortcut sheet"], ["Ctrl+1–5", "Navigate primary pages"], ["Ctrl+Shift+C", "Copy last reply"], ["Ctrl+Shift+E", "Export chat"], [enterSwaps ? "Shift+Enter" : "Enter", "Send message"], [enterSwaps ? "Enter" : "Shift+Enter", "New line"], ["↑", "Edit the last message"], ["Esc", "Close or stop"]].map(([shortcut, action]) => <div key={shortcut}><kbd>{shortcut}</kbd><span>{t(action)}</span></div>)}</div></div>}
        {settingsSection === "About" && <div className="card">{head("About", "About")}<div className="about-brand"><img src={brandIcon} alt="" /><span><strong>Hymnix Orbit</strong><small>{__APP_VERSION__} · Hymnix Studio</small></span></div><div className="setting-row"><label>{t("Updates")}<span className="hint">{updateState.detail || tf("Installed version {version}", { version: __APP_VERSION__ })}</span></label><div className="controls"><button className="btn" onClick={() => void checkUpdates()} disabled={updateState.status === "checking"}>{t(updateState.status === "checking" ? "Checking..." : "Check for updates")}</button>{updateState.status === "available" && updateState.url && <button className="btn primary" onClick={() => void window.hymnix.system.openExternal(updateState.url)}>{t("Open download page")}</button>}<button className="btn ghost" onClick={() => void window.hymnix.system.openExternal("https://github.com/CarrisFlynn/hymnix-ai-server/releases")}>{t("View releases")}</button></div></div><div className="setting-row"><label>{t("Help")}</label><div className="controls"><button className="btn" onClick={() => setActive("Support")}>{t("Sponsor")}</button><button className="btn ghost" onClick={() => setActive("Changelog")}>{t("Changelog")}</button></div></div></div>}
      </div></div>
    </section>;
  }
  function renderView() {
    if (active === "Chat") return renderChat();
    if (active === "Models") return renderModels();
    if (active === "Plugins") return renderPlugins();
    if (active === "Terminal") return renderTerminal();
    if (active === "History") return renderHistory();
    if (active === "Gateway") return renderGateway();
    if (active === "Monitor") return renderMonitor();
    if (active === "Changelog") return renderChangelog();
    if (active === "Support") return renderSupport();
    if (active === "Settings") return renderSettings();
    // Removed pages (Files, Tools, Approvals, Logs, Support) fall back to chat
    // instead of showing a dead "capability" screen.
    return renderChat();
  }

  const terminalView = active === "Terminal";
  const chatView = active === "Chat";
  const activeProvider = providers.find((item) => item.id === activeProviderId);
  const effortIndex = Math.max(0, EFFORT_LEVELS.findIndex((level) => level.key === effort));
  const effortLevel = EFFORT_LEVELS[effortIndex];
  const sourceLabel = source === "cloud"
    ? (activeProvider?.label || t("Cloud API"))
    : mode === "remote" ? (guestName || t("Remote host")) : t("Local model");
  const modelTitle = (source === "cloud" ? cloudModel : model) || t("No model");
  const workspaceName = filesRoot ? filesRoot.split(/[\\/]/).filter(Boolean).pop() || t("Workspace") : t(workspace);
  const titleLabel = chatView ? sessionName : t(active === "Gateway" ? "Sharing" : active);
  const sessionRows = sessions
    .slice()
    .sort((left, right) => Number(!!right.pinned) - Number(!!left.pinned) || new Date(right.at).getTime() - new Date(left.at).getTime())
    .filter((item) => !historyQuery.trim() || item.name.toLowerCase().includes(historyQuery.trim().toLowerCase()));

  return <div className={"app" + (terminalView ? " terminal-mode" : "") + (chatView ? " chat-mode" : "") + (sidebarCollapsed ? " rail-collapsed" : "")} data-lang={lang}>
    <div className="titlebar">
      <div className="tb-left">
        <button type="button" className="tb-icon panel-toggle" onClick={() => setSidebarCollapsed((value) => !value)} aria-label={t(sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar")} title={t(sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar")}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="3" /><path d="M8 3.5v13" /></svg>
        </button>
      </div>
      <div className="titlebar-drag" />
      <div className="tb-window">
        {previewOpen && <button type="button" className="preview-close" onClick={() => void closePreview()}>{t("Close preview")}</button>}
        <button type="button" onClick={() => void window.hymnix.window.control("minimize")} aria-label={t("Minimize")}>–</button>
        <button type="button" onClick={() => void window.hymnix.window.control("maximize")} aria-label={t("Maximize")}>▢</button>
        <button type="button" className="close" onClick={requestClose} aria-label={t("Close")}>✕</button>
      </div>
    </div>

    <aside className="side" aria-label={t("NAVIGATION")}>
      <div className="side-brand-wrap">
        <button type="button" className="side-brand" onClick={() => setProductMenuOpen((value) => !value)} aria-expanded={productMenuOpen} aria-haspopup="menu">
          <img src={brandIcon} alt="" />
          <span className="side-brand-name">{surface === "ai" ? t("Hymnix AI") : t("Hymnix Orbit")}</span>
          <Icon name="Chevron" />
        </button>
        {productMenuOpen && <div className="product-menu" role="menu">
          {SURFACES.map((item) => <button key={item.id} type="button" role="menuitemradio" aria-checked={surface === item.id} className={surface === item.id ? "active" : ""} onClick={() => { setSurface(item.id); setProductMenuOpen(false); }}>
            <span className="product-dot" data-surface={item.id} aria-hidden="true" />
            <span className="product-copy"><strong>{t(item.label)}</strong><small>{t(item.hint)}</small></span>
            {surface === item.id && <span className="product-check" aria-hidden="true">✓</span>}
          </button>)}
        </div>}
      </div>
      <button type="button" className="side-new" onClick={createSession}>
        <Icon name="Plus" /><span className="side-new-label">{t("New chat")}</span>
      </button>

      <nav className="side-nav" aria-label={t("Navigation")}>
        {navGroups.flatMap((group) => group.items).map((item) => <button key={item} type="button" className={active === item ? "side-row active" : "side-row"} onClick={() => { setActive(item); if (item === "Chat") setChatTab("chat"); }} aria-current={active === item ? "page" : undefined} title={t(item === "Gateway" ? "Sharing" : item)}>
          <Icon name={item} /><span className="side-row-label">{t(item === "Gateway" ? "Sharing" : item)}</span>
        </button>)}
      </nav>

      <div className="side-workspace">
        <div className="ws-head">
          <span className="ws-label">{t("Workspace")}</span>
          <button type="button" className="ws-icon" onClick={() => setSessionSearchOpen((value) => !value)} aria-label={t("Search conversations")} title={t("Search conversations")}><Icon name="Search" /></button>
          <button type="button" className="ws-icon" onClick={() => void chooseWorkspace()} aria-label={t("Choose a workspace to browse files.")} title={t("Choose a workspace to browse files.")}><Icon name="Projects" /></button>
          <button type="button" className="ws-icon" onClick={createSession} aria-label={t("New chat")} title={t("New chat")}><Icon name="Plus" /></button>
        </div>
        {sessionSearchOpen && <input className="ws-search" autoFocus value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} onBlur={() => { if (!historyQuery.trim()) setSessionSearchOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape") { setHistoryQuery(""); setSessionSearchOpen(false); } }} placeholder={t("Search conversations")} aria-label={t("Search conversations")} />}
        <button type="button" className="ws-item" onClick={() => void chooseWorkspace()} title={filesRoot || t("Choose a workspace to browse files.")}>
          <Icon name="Projects" /><span className="ws-name">{workspaceName}</span>
        </button>
      </div>

      <div className="side-sessions">
        {sessionRows.length === 0
          ? <div className="side-empty">{sessions.length === 0 ? t("No sessions yet") : t("No conversations match your search")}</div>
          : <>
            {sessionRows.slice(0, 40).map((item) => <button type="button" key={item.id} className={"side-session" + (item.id === currentSessionId && chatView ? " active" : "")} onClick={() => openSession(item.id)} title={(item.name || t("New chat")) + " · " + item.count + " " + t("messages")} aria-current={item.id === currentSessionId ? "true" : undefined}>
              <span className="side-session-title">{item.name || t("New chat")}</span>
              <span className="side-session-time">{relativeTime(item.at)}</span>
              {item.pinned && <span className="side-session-pin" aria-hidden="true">✦</span>}
            </button>)}
            {sessionRows.length > 40 && <button type="button" className="side-all" onClick={() => setActive("History")}>{tf("Show the other {count}", { count: String(sessionRows.length - 40) })}</button>}
          </>}
      </div>

      <div className="side-foot">
        <div className="side-usage" title={t("Today")}>
          <span className="side-usage-head"><span>{t("Today")}</span><span>{todayUsage.messages} {t("messages")}</span></span>
          <span className="side-usage-bar" aria-hidden="true"><i style={{ width: Math.min(100, Math.max(2, todayUsage.tokens / 40)) + "%" }} /></span>
          <span className="side-usage-head"><span /> <span>~{(Math.round(todayUsage.tokens / 100) / 10).toFixed(1)}k {t("tokens")}</span></span>
        </div>
        <button type="button" className={active === "Settings" ? "side-row active" : "side-row"} onClick={() => setActive("Settings")} aria-current={active === "Settings" ? "page" : undefined} title={t("Settings")}>
          <Icon name="Settings" /><span className="side-row-label">{t("Settings")}</span>
        </button>
        <button type="button" className="side-account" onClick={() => setActive("Settings")} title={t("Connection") + " · " + t(state)}>
          <span className="avatar">{mode === "remote" ? "R" : "L"}</span>
          <span className="side-row-label"><strong>{mode === "local" ? t("Local mode") : t("Remote host")}</strong><small>{t(state)}</small></span>
          <span className="dot account-dot" data-state={state} aria-hidden="true" />
        </button>
      </div>
    </aside>

    <main className={terminalView ? "main terminal-main" : "main"}>
      {renderView()}
      {startupNote && !terminalView && <div className="notice" role="status">{startupNote}</div>}
      {(error || connectionError) && !terminalView && <div className="error" role="alert">{error || connectionError}</div>}
    </main>

    <footer className="statusbar">
      <span className="sb-item"><span className="dot" data-state={state} aria-hidden="true" />{t(state === "ready" ? "Ready" : state === "starting" ? "Starting" : state === "error" ? "Error" : "Limited")}</span>
      <span className="sb-item sb-model" title={modelTitle + " · " + sourceLabel}>{modelTitle}</span>
      <span className="sb-item sb-source">{sourceLabel}</span>
      <span className="sb-spacer" />
      <span className="sb-hardware">
        <span className="sb-item">{t("GPU")} {stats?.gpu != null ? stats.gpu + "%" : "—"}</span>
        <span className="sb-item">VRAM {stats?.vramUsed != null && stats?.vramTotal != null ? stats.vramUsed + "/" + stats.vramTotal + " GB" : "—"}</span>
        <span className="sb-item">RAM {stats ? (stats.ramUsed / 1024).toFixed(1) + "/" + (stats.ramTotal / 1024).toFixed(1) + " GB" : "—"}</span>
      </span>
      <span className="sb-item sb-effort" data-level={effortLevel.key}>{t("Reasoning")} {effortLevel.label}</span>
    </footer>
    {clearAllConfirm && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setClearAllConfirm(false); }}><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="clear-history-title"><div className="dialog-icon">!</div><h2 id="clear-history-title">{tf("Delete {count} conversations?", { count: String(sessions.length) })}</h2><p>{t("All saved conversations will be removed. You can undo this for 10 seconds.")}</p><div className="dialog-actions"><button type="button" className="btn" autoFocus onClick={() => setClearAllConfirm(false)}>{t("Cancel")}</button><button type="button" className="btn danger" onClick={clearAllSessions}>{tf("Delete {count} conversations", { count: String(sessions.length) })}</button></div></section></div>}
    {modelDeleteTarget && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModelDeleteTarget(null); }}><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-model-title"><div className="dialog-icon danger">!</div><h2 id="delete-model-title">{t("Delete model")}</h2><p>{tf("Delete model {model} from this device? This cannot be undone.", { model: modelDeleteTarget })}</p><div className="dialog-actions"><button type="button" className="btn" autoFocus onClick={() => setModelDeleteTarget(null)}>{t("Cancel")}</button><button type="button" className="btn danger" onClick={() => { void modelAction("delete", modelDeleteTarget); setModelDeleteTarget(null); }}>{t("Delete model")}</button></div></section></div>}
    {pluginDeleteTarget && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPluginDeleteTarget(null); }}><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="uninstall-plugin-title"><div className="dialog-icon danger">!</div><h2 id="uninstall-plugin-title">{tf("Uninstall {name}?", { name: pluginDeleteTarget.name })}</h2><p>{t("Uninstall moves the plugin to its local recovery folder.")}</p><div className="dialog-actions"><button type="button" className="btn" autoFocus onClick={() => setPluginDeleteTarget(null)}>{t("Cancel")}</button><button type="button" className="btn danger" disabled={!!pluginActionBusy} onClick={() => void uninstallPlugin()}>{t("Uninstall")}</button></div></section></div>}
    {toast && <div className="toast" role="status"><span>{toast.message}</span>{toast.action && toast.undo && <button type="button" onClick={toast.undo}>{toast.action}</button>}<button type="button" className="toast-close" onClick={() => setToast(null)} aria-label={t("Dismiss")}>×</button></div>}
    {download && <ModelDownloadFooter download={download} lang={lang} remote={remoteActive()}
      onPause={() => stopModelDownload("pause")} onResume={resumeModelDownload}
      onCancel={() => stopModelDownload("cancel")} onDismiss={() => setDownload(null)} />}
    {whatsNewOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setWhatsNewOpen(false); try { localStorage.setItem("hymnix.whatsNew", __APP_VERSION__); } catch { /* private mode */ } } }}>
      <section className="confirm-dialog whats-new" role="dialog" aria-modal="true" aria-labelledby="whats-new-title">
        <div className="dialog-icon">✦</div>
        <h2 id="whats-new-title">{tf("What's new in {version}", { version: __APP_VERSION__ })}</h2>
        <ul className="md-li">
          <li>{t("Nine themes with Auto following Windows, and a preview gallery in Settings.")}</li>
          <li>{t("A shortcut sheet in Settings, plus Alt+← back navigation on every page.")}</li>
          <li>{t("Autosaved conversations with search, pinning, branching and undo.")}</li>
          <li>{t("First-run setup, token speed while generating, and inline retry when a connection drops.")}</li>
          <li>{t("Sharing shows a QR code and the people connected to this computer.")}</li>
        </ul>
        <div className="dialog-actions"><button type="button" className="btn" autoFocus onClick={() => { setActive("Changelog"); setWhatsNewOpen(false); try { localStorage.setItem("hymnix.whatsNew", __APP_VERSION__); } catch { /* private mode */ } }}>{t("See changelog")}</button><button type="button" className="btn primary" onClick={() => { setWhatsNewOpen(false); try { localStorage.setItem("hymnix.whatsNew", __APP_VERSION__); } catch { /* private mode */ } }}>{t("Got it")}</button></div>
      </section>
    </div>}
    {qrOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setQrOpen(false); }}>
      <section className="confirm-dialog qr-dialog" role="dialog" aria-modal="true" aria-labelledby="qr-title">
        <h2 id="qr-title">{t("Scan to connect")}</h2>
        <p>{t("Friends scan this code, then enter the share password.")}</p>
        {tunnelUrl ? <QrCode text={tunnelUrl} /> : <div className="empty-inline">{t("Start sharing to get a public link.")}</div>}
        {tunnelUrl && <p className="mono qr-link">{tunnelUrl}</p>}
        <div className="dialog-actions"><button type="button" className="btn" onClick={() => void navigator.clipboard?.writeText(tunnelUrl)} disabled={!tunnelUrl}>{t("Copy link")}</button><button type="button" className="btn primary" autoFocus onClick={() => setQrOpen(false)}>{t("Close")}</button></div>
      </section>
    </div>}
    {closePromptOpen && <div className="dialog-backdrop" role="presentation">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="close-title">
        <div className="dialog-icon">!</div>
        <h2 id="close-title">{t("Keep sharing in the tray?")}</h2>
        <p>{t("People are connected to this computer. Hymnix Orbit can keep sharing in the notification area.")}</p>
        <label className="inline-check"><input type="checkbox" checked={rememberClose} onChange={(event) => setRememberClose(event.target.checked)} />{t("Remember my answer")}</label>
        <div className="dialog-actions"><button type="button" className="btn" autoFocus onClick={() => void stopSharingAndClose()}>{t("Stop sharing and quit")}</button><button type="button" className="btn primary" onClick={() => keepSharing(rememberClose)}>{t("Keep sharing")}</button></div>
      </section>
    </div>}
    {stopShareConfirm && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setStopShareConfirm(false); }}>
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="stop-share-title">
        <div className="dialog-icon danger">!</div>
        <h2 id="stop-share-title">{tf("{count} people are connected. Stop sharing?", { count: String(health?.clients_online ?? 0) })}</h2>
        <p>{t("Their chats will stop immediately. They can reconnect when you start sharing again.")}</p>
        <div className="dialog-actions"><button type="button" className="btn" autoFocus onClick={() => setStopShareConfirm(false)}>{t("Cancel")}</button><button type="button" className="btn danger" onClick={() => { setStopShareConfirm(false); void toggleTunnel("stop"); }}>{t("Stop sharing")}</button></div>
      </section>
    </div>}
    {unloadTarget && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setUnloadTarget(null); }}>
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="unload-title">
        <div className="dialog-icon">!</div>
        <h2 id="unload-title">{tf("{model} is still replying", { model: unloadTarget })}</h2>
        <p>{t("Unloading now stops the current reply. The text received so far is kept.")}</p>
        <div className="dialog-actions"><button type="button" className="btn" autoFocus onClick={() => setUnloadTarget(null)}>{t("Keep generating")}</button><button type="button" className="btn danger" onClick={() => void confirmStopAndUnload()}>{t("Stop and unload")}</button></div>
      </section>
    </div>}
    <TooltipLayer />
  </div>;
}

createRoot(document.getElementById("root")!).render(<App />);
