import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ApprovalRecord, DesktopApi, GatewayHealth, PluginDescriptor, TerminalBridgeReply, ToolDescriptor } from "../shared/protocol";
import "../styles/index.css";
import "./styles.css";
import "./orbit-v2.css";
import brandIcon from "./assets/hymnix-red-white-star.png";
import { THEMES, readAppearance, readStoredTheme, readStoredMode, applyTheme, persistTheme, persistAppearanceMode, activeMode, selectedTheme, systemMode, type AppearanceMode } from "../theme/themeManager";
import { t, tf, getLang, setLang, translateDom, installAutoTranslate, type Lang } from "./i18n";
import type { ChatMessage } from "./chat";
import { ChatViewport } from "./chat-navigation";
import { pullErrorMessage, trackDownloadProgress } from "./model-download";
import { ModelCatalog } from "./ModelCatalog";
import { DEFAULT_CATALOG_FILTERS, type CatalogFilters } from "./model-catalog";
import { MODEL_CATALOG } from "./model-catalog-data";
import { ModelCombobox, PasswordMeter, QrCode, SkeletonList, ErrorPanel, TooltipLayer, passwordStrength } from "./components";
import { DesignLab } from "./design-lab";
import { estimateTokens, parseSlashCommand, classifyConnectError, downloadBytes } from "./lib/pure.js";

declare global { interface Window { hymnix: DesktopApi } }

type Message = ChatMessage;
type Entry = { time: string; tag: "sys" | "out" | "err"; text: string };
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
  Changelog: "M6 4h12v16H6zM9 8h6M9 12h6M9 16h4"
};
function Icon({ name }: { name: string }) { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[name] || ICONS.Chat} /></svg> }

const navGroups = [
  { title: "WORKSPACE", items: ["Chat", "Models", "Gateway", "Files", "Tools", "Approvals", "Plugins"] },
  { title: "DEVELOPER", items: ["Monitor", "Terminal", "Logs"] }
];

const SLASH_COMMANDS = [
  { name: "/model", detail: "Switch the active model", insert: "/model " },
  { name: "/clear", detail: "Clear this conversation" },
  { name: "/export", detail: "Export the conversation as text" },
  { name: "/system", detail: "Set a system prompt", insert: "/system " },
];

const DEFAULT_UI_SETTINGS = { betaChannel: false, runAtStartup: false, dpiScaling: false, startFullscreen: false, autoUpdate: true, smoothScroll: true, gpuAcceleration: true, cacheDir: "", previewMode: "inapp" as "inapp" | "browser" };

const capabilityCopy: Record<string, string> = {
  Tools: "Inspect registered tools and recent tool calls.",
  Approvals: "Review and resolve pending permission requests.",
  Plugins: "Manage installed plugins and lifecycle status."
};

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
function fuzzyMatch(query: string, text: string): boolean {
  const normalized = text.toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).every((term) => {
    if (normalized.includes(term)) return true;
    let cursor = 0;
    for (const char of term) { cursor = normalized.indexOf(char, cursor); if (cursor < 0) return false; cursor++; }
    return true;
  });
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
  const [lang, setLangState] = useState<Lang>(getLang());
  const [theme, setThemeState] = useState<string>(readTheme);
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>(readStoredMode);
  const [workspace, setWorkspace] = useState("Default workspace");
  const [savedSessions, setSavedSessions] = useState<LocalChatSession[]>(() => initialSessionsRef.current || []);
  const [currentSessionId, setCurrentSessionId] = useState(() => initialSessionsRef.current?.[0]?.id || newSessionId());
  const [sessionName, setSessionName] = useState(() => initialSessionsRef.current?.[0]?.name || "New chat");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [welcomeOpen, setWelcomeOpen] = useState(() => { try { return localStorage.getItem("hymnix.welcome") !== "1"; } catch { return true; } });
  const [welcomeStep, setWelcomeStep] = useState(0);
  const [welcomeSkipped, setWelcomeSkipped] = useState<string[]>([]);
  const [developerExpanded, setDeveloperExpanded] = useState(false);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const [statusPopoverOpen, setStatusPopoverOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => { try { return localStorage.getItem("hymnix.sidebar.collapsed") === "1"; } catch { return false; } });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const paletteInputRef = useRef<HTMLInputElement>(null);
  const [historyQuery, setHistoryQuery] = useState("");
  const [modelsTab, setModelsTab] = useState<"Installed" | "Discover" | "Downloads">("Installed");
  const [gatewayTab, setGatewayTab] = useState<"Host" | "Connect" | "Cloud API">("Host");
  const [settingsSection, setSettingsSection] = useState("General");
  const [settingsQuery, setSettingsQuery] = useState("");
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
  const [textScale, setTextScale] = useState<number>(() => { try { return Math.min(200, Math.max(90, Number(localStorage.getItem("hymnix.textScale") || 100))); } catch { return 100; } });
  const [softenAccent, setSoftenAccent] = useState<boolean>(() => { try { return localStorage.getItem("hymnix.softenAccent") === "1"; } catch { return false; } });
  const [previewTheme, setPreviewTheme] = useState<string | null>(null);
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
  const [guestName, setGuestName] = useState("");
  const [guestPassword, setGuestPassword] = useState("");
  const [netBusy, setNetBusy] = useState(false);
  const [effort, setEffort] = useState("medium");
  const [uiSettings, setUiSettings] = useState(DEFAULT_UI_SETTINGS);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [stars, setStars] = useState<number | null>(null);
  const [source, setSource] = useState<"local" | "cloud">("local");
  const [cloudBase, setCloudBase] = useState("");
  const [cloudModel, setCloudModel] = useState("");
  const [cloudKey, setCloudKey] = useState("");
  const [cloudMasked, setCloudMasked] = useState("");
  const [cloudStatus, setCloudStatus] = useState("");
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
  useEffect(() => { const id = previewTheme || theme; const mode = THEMES.find((item) => item.id === id)?.mode || (appearanceMode === "auto" ? systemMode() : appearanceMode); applyTheme(id, mode); }, [theme, appearanceMode, previewTheme]);
  useEffect(() => { if (active === "Plugins") void loadPlugins(); }, [active]);
  useEffect(() => {
    const backgroundColor = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    void window.hymnix.window.setAppearance(appearanceMode, backgroundColor);
  }, [appearanceMode, theme, previewTheme]);
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
  useEffect(() => {
    void window.hymnix.system.disk("").then((info) => setDiskFree(info?.free ?? null)).catch(() => undefined);
  }, []);
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
        setWelcomeOpen(false);
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
      if (paletteOpen && event.key === "Escape") { event.preventDefault(); setPaletteOpen(false); setPaletteQuery(""); return; }
      if (paletteOpen && !mod) return;
      if (paletteOpen && mod && key !== "k") { setPaletteOpen(false); setPaletteQuery(""); }
      if (mod && key === "k") { event.preventDefault(); setPaletteOpen(true); setPaletteQuery(""); setPaletteIndex(0); return; }
      if (mod && key === "f" && active === "Terminal") { event.preventDefault(); terminalSearchRef.current?.focus(); terminalSearchRef.current?.select(); return; }
      if (mod && key === "n") { event.preventDefault(); createSession(); return; }
      if (mod && key === "b") { event.preventDefault(); setSidebarCollapsed((value) => !value); return; }
      if (mod && key === ".") { event.preventDefault(); setInspectorOpen((value) => !value); return; }
      if (mod && key === ",") { event.preventDefault(); setActive("Settings"); return; }
      if (mod && key === "l") { event.preventDefault(); setActive("Chat"); window.setTimeout(() => composerRef.current?.focus(), 0); return; }
      if (mod && key === "/") { event.preventDefault(); setActive("Settings"); setSettingsSection("Shortcuts"); return; }
      if (mod && event.shiftKey && key === "c") { event.preventDefault(); void copyLastReply(); return; }
      if (mod && event.shiftKey && key === "e") { event.preventDefault(); exportChat(); return; }
      if (mod && /^[1-5]$/.test(key)) { event.preventDefault(); setActive(["Chat", "Models", "Gateway", "Monitor", "Terminal"][Number(key) - 1]); return; }
      if (event.key === "Escape" && requestRef.current) cancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [paletteOpen, active, clearAllConfirm, modelDeleteTarget, pluginDeleteTarget]);
  useEffect(() => { if (paletteOpen) window.setTimeout(() => paletteInputRef.current?.focus(), 0); }, [paletteOpen]);
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
        const next = [record, ...current.filter((item) => item.id !== currentSessionId)].slice(0, 200);
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
  function setTextScalePreference(next: number) { const value = Math.min(200, Math.max(90, next)); setTextScale(value); try { localStorage.setItem("hymnix.textScale", String(value)); } catch { /* private mode */ } }

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
      const chatBase = cloudMode ? cloudBase.trim().replace(/\/+$/, "").replace(/\/v1$/, "") : (remoteActive() ? serverBase.trim() : gatewayBase);
      const chatKey = cloudMode ? cloudKey.trim() : (remoteActive() ? apiKey.trim() : "");
      const chatModel = cloudMode ? (cloudModel.trim() || model) : model;
      const outbound = [
        ...(systemPrompt.trim() ? [{ role: "system" as const, content: systemPrompt.trim() }] : []),
        ...next.slice(0, -1).map((item) => ({ role: item.role, content: item.content })),
      ];
      await window.hymnix.gateway.streamChat({ requestId, baseUrl: chatBase, apiKey: chatKey, model: chatModel, reasoningEffort: effort, messages: outbound, onDelta: (part: any) => {
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
  function cancel() { if (requestRef.current) { window.hymnix.gateway.cancelChat(requestRef.current); requestRef.current = null; setChatBusy(false); } }
  function editMessage(index: number): void {
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

  async function modelAction(action: "start" | "stop" | "delete", name: string) {
    // Unloading the model that is producing the current reply is destructive; ask first.
    if (action === "stop" && chatBusy && model === name) { setUnloadTarget(name); return; }
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
    await modelAction("stop", name);
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
        else termOut("sys", t("No new bridge replies."));
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
    const cloudUnconfigured = source === "cloud" && (!cloudBase.trim() || !cloudModel.trim());
    const emptyChat = checkingService ? <div className="chat-ready-card readiness-checking" role="status"><span className="orbit-loader" aria-hidden="true" /><div className="ready-copy"><span className="eyebrow">{t("GET STARTED")}</span><h2>{t("Checking the model service")}</h2><p>{t("Checking whether the local model service is ready...")}</p></div></div> : localOffline ? <div className="chat-ready-card">
      <div className="ready-icon"><Icon name="Models" /></div><div className="ready-copy"><span className="eyebrow">{t("GET STARTED")}</span><h2>{t("Model service is offline")}</h2><p>{t("Start Ollama to list and run local models. Your conversations stay on this device.")}</p>{ollamaError && <p className="error" role="alert">{ollamaError}</p>}</div>
      <div className="ready-actions"><button className="btn primary" onClick={() => void startOllama()} disabled={ollamaBusy}>{t(ollamaBusy ? "Starting Ollama..." : "Start Ollama")}</button><button className="btn" onClick={() => setActive("Models")}>{t("View models")}</button></div>
    </div> : noLocalModels ? <div className="chat-ready-card">
      <div className="ready-icon"><Icon name="Models" /></div><div className="ready-copy"><span className="eyebrow">{t("GET STARTED")}</span><h2>{t("Choose a model to begin")}</h2><p>{t("Browse available local models, or switch to Cloud API in the chat settings.")}</p></div>
      <div className="ready-actions"><button className="btn primary" onClick={() => { setActive("Models"); setModelsTab("Discover"); }}>{t("Discover models")}</button><button className="btn" onClick={() => { setSource("cloud"); setInspectorOpen(true); }}>{t("Use Cloud API")}</button></div>
    </div> : modelNeedsLoad ? <div className="chat-ready-card">
      <div className="ready-icon"><Icon name="Models" /></div><div className="ready-copy"><span className="eyebrow">{t("MODEL READY")}</span><h2>{tf("Load {model} to begin", { model })}</h2><p>{t("The model is installed but not loaded. Load it before starting a conversation.")}</p></div>
      <div className="ready-actions"><button className="btn primary" onClick={() => void modelAction("start", model)} disabled={!!modelBusy}>{t(modelBusy === model ? "Loading..." : "Load model")}</button><button className="btn" onClick={() => setActive("Models")}>{t("Choose another model")}</button></div>
    </div> : cloudUnconfigured ? <div className="chat-ready-card">
      <div className="ready-icon"><span>✦</span></div><div className="ready-copy"><span className="eyebrow">{t("CLOUD API")}</span><h2>{t("Configure a cloud model")}</h2><p>{t("Add an API endpoint and model name in Chat settings before sending a message.")}</p></div>
      <div className="ready-actions"><button className="btn primary" onClick={() => setInspectorOpen(true)}>{t("Open chat settings")}</button><button className="btn" onClick={() => setSource("local")}>{t("Use local model")}</button></div>
    </div> : <div className="chat-empty-state">
      <div className="empty-orbit" aria-hidden="true"><img src={brandIcon} alt="" /></div><span className="eyebrow">{t("HYMNIX ORBIT")}</span><h2>{t("What are you working on?")}</h2>
      <p>{tf("Start with {workspace} or choose a prompt.", { workspace: t(workspace) })}</p>
      <div className="prompt-grid"><button className="prompt-card" onClick={() => setDraft(t("Summarize the current workspace"))}><strong>{t("Summarize workspace")}</strong><span>{t("Get a concise overview of your files and project context.")}</span><i>↗</i></button><button className="prompt-card" onClick={() => setDraft(t("Help me inspect a model"))}><strong>{t("Inspect a model")}</strong><span>{t("Compare model details and find a good fit.")}</span><i>↗</i></button><button className="prompt-card" onClick={() => setDraft(t("Help me draft a clear message"))}><strong>{t("Write something")}</strong><span>{t("Turn a rough idea into a polished first draft.")}</span><i>↗</i></button><button className="prompt-card" onClick={() => setDraft(t("Help me write a code example"))}><strong>{t("Write code")}</strong><span>{t("Explain a coding task and get a useful starting point.")}</span><i>↗</i></button></div>
    </div>;
    const slashQuery = draft.startsWith("/") && !draft.includes("\n") ? draft.split(/\s/)[0].toLowerCase() : "";
    const slashMatches = slashQuery ? SLASH_COMMANDS.filter((item) => item.name.startsWith(slashQuery)) : [];
    const lastAssistant = [...messages].reverse().find((item) => item.role === "assistant");
    const liveRate = chatBusy && transport.current.startedAt && lastAssistant?.content
      ? estimateTokens(lastAssistant.content) / Math.max(0.4, (Date.now() - transport.current.startedAt) / 1000)
      : null;
    const lastRate = !chatBusy ? lastAssistant?.tokensPerSecond : undefined;
    const totalTokens = estimateTokens(messages.map((item) => item.content).join(" "));
    return <>
      <ChatViewport messages={messages} followSignal={followSignal} empty={emptyChat} busy={chatBusy} onEditMessage={editMessage} onRegenerateMessage={regenerateMessage} onDeleteMessage={deleteMessageTurn} onBranchMessage={branchFrom} onRetryMessage={retryMessage} />
      {messages.length > 0 && <div className="chat-tools">
        <button className="btn" onClick={() => void copyLastReply()}>{t("Copy last reply")}</button>
        <button className="btn" onClick={clearCurrentConversation}>{t("Clear")}</button>
        <button className="btn" onClick={exportChat}>{t("Export chat")}</button>
        <span className="chat-stat">{model || "-"} · {messages.length} {t("messages")} · ~{totalTokens} {t("tokens")}{lastRate ? ` · ${lastRate.toFixed(1)} tok/s` : ""}</span>
      </div>}
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
        <footer>
          <div>
            <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => { if (event.target.files?.length) void addFiles(event.target.files); event.target.value = ""; }} />
            <button type="button" className="btn icon attach-button" data-tip={t("Attach a file")} aria-label={t("Attach a file")} onClick={() => fileInputRef.current?.click()}>+</button>
            <ModelCombobox value={model} options={models} gpuGb={stats?.vramTotal} onChange={setModel} onDownload={() => { setActive("Models"); setModelsTab("Discover"); }} />
            <select className="btn composer-effort" value={effort} onChange={(event) => setEffort(event.target.value)} aria-label={t("Reasoning effort")}>{["low", "medium", "high"].map((value) => <option key={value} value={value}>{t(value === "low" ? "Low" : value === "medium" ? "Medium" : "High")}</option>)}</select>
            <span className="composer-hint">{t(enterSwaps ? "Shift+Enter to send · Enter for new line" : "Enter to send · Shift+Enter for new line")}</span>
          </div>
          <div>
            {liveRate != null && <span className="composer-rate" data-no-translate>{liveRate.toFixed(1)} tok/s</span>}
            {chatBusy ? <button type="button" className="btn composer-stop" onClick={cancel} aria-label={t("Stop generating")} data-tip={t("Stop generating")} data-tip-key="Esc">■</button> : <button type="submit" className="btn primary composer-send" disabled={!draft.trim() && !attachments.length} aria-label={t("Send")} data-tip={t("Send")} data-tip-key={enterSwaps ? "Shift+Enter" : "Enter"}>↑</button>}
          </div>
        </footer>
      </form>
    </>;
  }

  function renderModels() {
    const tabs: Array<"Installed" | "Discover" | "Downloads"> = ["Installed", "Discover", "Downloads"];
    return <section className="view-page">
      <div className="view-heading"><div><label>{t("MODEL CATALOG")}</label><h2>{t("Models")}</h2><p>{t("Discover models served by the local gateway.")}</p></div><button className="btn primary" onClick={() => void loadModels()}>{t("Refresh models")}</button></div>
      {renderOllamaNotice()}
      <div className="tab-strip model-tabs" role="tablist" aria-label={t("Model sections")}>{tabs.map((tab) => <button role="tab" aria-selected={modelsTab === tab} className={modelsTab === tab ? "tab active" : "tab"} key={tab} onClick={() => setModelsTab(tab)}>{t(tab)}{tab === "Downloads" && downloadOccupied ? <span className="count-badge">1</span> : null}</button>)}</div>
      {modelsTab === "Installed" && <div className="card model-table-card">
        <div className="section-heading"><div><h3 className="card-title">{t("Installed models")}</h3><p className="subtitle">{tf("{count} models on this device", { count: models.length })}</p></div></div>
        {models.length === 0 && state === "starting" ? <SkeletonList rows={4} /> : models.length === 0 ? <div className="empty-state"><strong>{t("No model installed yet.")}</strong><span>{t("Choose a model that fits your hardware from Discover.")}</span><button className="btn primary" onClick={() => setModelsTab("Discover")}>{t("Discover models")}</button></div> : <div className="model-table"><div className="model-table-head"><span>{t("Name")}</span><span>{t("Status")}</span><span>{t("Actions")}</span></div>{models.map((item) => <div className="model-table-row" key={item.name}>
          <span className="catalog-main"><strong>{item.name}</strong><small>{item.name.split(":")[1] || t("Installed model")}</small></span>
          <span className={item.loaded ? "status-pill success" : "status-pill neutral"}><span className="status-dot" />{item.loaded ? t("Loaded") : t("Installed")}</span>
          <span className="controls"><button className={item.loaded ? "btn" : "btn primary"} onClick={() => { setModel(item.name); void modelAction(item.loaded ? "stop" : "start", item.name); }} disabled={modelBusy === item.name}>{modelBusy === item.name ? t("Loading...") : item.loaded ? t("Unload") : t("Load")}</button><button className="btn danger" onClick={() => setModelDeleteTarget(item.name)} disabled={modelBusy === item.name}>{t("Delete")}</button></span>
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
            {download.phase === "downloading" && <div className="download-inline"><div className="progress"><i style={{ width: (percent ?? 0) + "%" }} /></div><small>{percent != null ? percent + "%" : ""}{download.bytesPerSecond ? ` · ${downloadBytes(download.bytesPerSecond, lang)}/s` : ""}{eta != null ? ` · ${formatDuration(eta)} ${t("left")}` : ""}</small></div>}
          </span>
          <span className="controls"><span className="status-pill">{download.phase === "downloading" ? t("In progress") : t(download.phase)}</span>
            {download.phase === "downloading" && <button className="btn" onClick={() => stopModelDownload("pause")}>{t("Pause download")}</button>}
            {download.phase === "paused" && <button className="btn primary" onClick={resumeModelDownload}>{t("Resume download")}</button>}
            {download.phase !== "complete" && download.phase !== "failed" && <button className="btn danger" onClick={() => stopModelDownload("cancel")}>{t("Cancel download")}</button>}
            {(download.phase === "complete" || download.phase === "failed" || download.phase === "cancelled") && <button className="btn" onClick={() => setDownload(null)}>{t("Close")}</button>}
          </span>
        </div>;
      })() : <div className="empty-state"><strong>{t("No active downloads")}</strong><span>{t("Downloads you start will appear here.")}</span><button className="btn primary" onClick={() => setModelsTab("Discover")}>{t("Discover models")}</button></div>}</div>}
    </section>;
  }
  function renderTerminal() {
    const hints = [t("↑ history"), "Tab " + t("complete"), t("scroll to inspect")].join(" · ");
    const visibleTermEntries = termEntries.filter((item) => (terminalFilter === "All" || (terminalFilter === "Error" ? item.tag === "err" : terminalFilter === "Info" ? item.tag !== "err" : item.tag === "sys")) && (!terminalSearch.trim() || item.text.toLowerCase().includes(terminalSearch.trim().toLowerCase())));
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
          : visibleTermEntries.map((item, index) => <div className="term-line" key={index}><span className="term-time">{item.time}</span><span className={"term-tag " + item.tag}>{item.tag.toUpperCase()}</span><span className="term-text">{item.text}</span></div>)}
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

  function renderFiles() {
    return <section className="view-page">
      <div className="view-heading"><div><label>{t("WORKSPACE FILES")}</label><h2>{t("Files")}</h2><p>{filesRoot || t("Choose a workspace to browse files.")}</p></div><button className="btn" onClick={() => void chooseWorkspace()} disabled={filesBusy}>{t("Choose workspace")}</button></div>
      {filesError && <div className="error">{filesError}</div>}
      <div className="card"><div className="setting-row"><label>{t("Search files")}</label><div className="controls"><input value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} /><button className="btn" onClick={() => void searchFiles()}>{t("Search")}</button></div></div></div>
      {(fileHits.length ? fileHits : fileEntries).length ? <div className="list">{(fileHits.length ? fileHits : fileEntries).slice(0, 200).map((item: any, index: number) => <button className="list-row" key={index} onClick={() => void readFile(item.path || item.rel)}><span className="model-mark">{(item.type === "directory" || item.isDir) ? "D" : "F"}</span><span>{item.path || item.rel}</span></button>)}</div> : <div className="card empty-state"><strong>{t("No files found")}</strong></div>}
      {fileText && <pre className="term-log">{fileText}</pre>}
    </section>;
  }

  function renderHistory() {
    const filtered = sessions.filter((item) => {
      const transcript = savedSessions.find((session) => session.id === item.id)?.messages || [];
      return `${item.name} ${item.model} ${transcript.map((message) => message.content).join(" ")}`.toLowerCase().includes(historyQuery.trim().toLowerCase());
    });
    return <section className="view-page">
      <div className="view-heading"><div><label>{t("CONVERSATIONS")}</label><h2>{t("History")}</h2><p>{t("Saved conversations on this machine.")}</p></div><button className="btn danger" onClick={() => setClearAllConfirm(true)} disabled={!sessions.length}>{t("Clear all")}</button></div>
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
    const presets = [
      { label: "DeepSeek", base: "https://api.deepseek.com", model: "deepseek-chat" },
      { label: "OpenAI", base: "https://api.openai.com", model: "gpt-4o-mini" },
      { label: "Moonshot", base: "https://api.moonshot.cn", model: "moonshot-v1-8k" },
    ];
    return <section className="view-page">
      <div className="view-heading"><div><label>{t("SHARING & CONNECTIONS")}</label><h2>{t("Sharing & connections")}</h2><p>{t("Host this computer, connect to a friend, or configure a cloud provider.")}</p></div><button className="btn ghost" onClick={() => { void loadNetwork(); void loadCloud(); void loadHealth(); void loadHostClients(); }}>{t("Refresh")}</button></div>
      <div className="sharing-summary card"><span className={"status-pill " + (tunnelState === "up" ? "success" : "neutral")}><span className="status-dot" />{t(tunnelState === "up" ? "Sharing" : "Not sharing")}</span><span>{t("Clients online")}: <strong>{online}</strong></span><span className="public-link">{tunnelUrl || t("No public link yet")}</span>{tunnelUrl && <button className="btn tonal" onClick={() => void navigator.clipboard?.writeText(tunnelUrl)}>{t("Copy link")}</button>}{tunnelUrl && <button className="btn" onClick={() => setQrOpen(true)}>{t("Show QR code")}</button>}</div>
      <div className="tab-strip" role="tablist" aria-label={t("Sharing options")}>{(["Host", "Connect", "Cloud API"] as const).map((tab) => <button role="tab" aria-selected={gatewayTab === tab} className={gatewayTab === tab ? "tab active" : "tab"} key={tab} onClick={() => setGatewayTab(tab)}>{t(tab)}</button>)}</div>

      {gatewayTab === "Host" && <>
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
      </>}

      {gatewayTab === "Connect" && <div className="card">
        <h3 className="card-title">{t("Connect to a friend")}</h3>
        <div className="setting-row"><label>{t("Server address")}<span className="hint">{t("host shares this")}</span></label><div className="controls"><input value={serverBase} onChange={(event) => setServerBase(event.target.value)} placeholder="https://xxxx.trycloudflare.com" /></div></div>
        <div className="setting-row"><label>{t("Share name")}<span className="hint">{t("host name")}</span></label><div className="controls"><input value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="Hymnix Orbit" /></div></div>
        <div className="setting-row"><label>{t("Connection password")}<span className="hint">{t("given by the host")}</span></label><div className="controls"><input type="password" value={guestPassword} onChange={(event) => setGuestPassword(event.target.value)} /><button className="btn" onClick={() => void testConnection()} disabled={netBusy || shareTest.state === "testing"}>{t(shareTest.state === "testing" ? "Testing..." : "Test connection")}</button><button className="btn primary" onClick={() => void guestConnect().then((ok) => { if (ok) setShareTest({ state: "ok", message: t("Connected. Chats now run on the friend's hardware.") }); })} disabled={netBusy}>{netBusy ? t("Working...") : t("Connect")}</button></div></div>
        {shareTest.state === "fail" && <ErrorPanel title={t("Could not connect")} cause={shareTest.category || shareTest.message} fix={t("Try again")} onFix={() => void testConnection()} details={shareTest.message} />}
        {shareTest.state === "ok" && <p className="panel-note success-text" role="status">✓ {shareTest.message}</p>}
        <div className="favourite-row"><button className="btn tonal" onClick={rememberHost} disabled={!serverBase.trim()}>{t("Save to favourites")}</button>{savedHosts.length > 0 && <span className="hint">{savedHosts.length} {t("saved hosts")}</span>}</div>
        {savedHosts.length > 0 && <div className="host-list">{savedHosts.map((host) => <div className="host-row" key={host.url}><button className="panel-link" onClick={() => { setServerBase(host.url); setGuestName(host.name); }}><strong>{host.name}</strong><small>{host.url}</small></button><button className="btn ghost" onClick={() => forgetHost(host.url)}>{t("Remove")}</button></div>)}</div>}
        <p className="subtitle">{mode === "remote" ? t("Connected: chats run on the friend's hardware.") : t("Not connected. Chats run locally.")}</p>
      </div>}

      {gatewayTab === "Cloud API" && <div className="card">
        <h3 className="card-title">{t("Cloud API")}</h3>
        <div className="setting-row"><label>{t("CHAT SOURCE")}</label><div className="controls segmented"><button className={source === "local" ? "active" : ""} onClick={() => setSource("local")}>{t("Local model")}</button><button className={source === "cloud" ? "active" : ""} onClick={() => setSource("cloud")}>{t("Cloud API")}</button></div></div>
        <div className="setting-row"><label>{t("Provider preset")}</label><div className="controls">{presets.map((preset) => <button className="chip" key={preset.label} onClick={() => { setCloudBase(preset.base); setCloudModel(preset.model); }}>{preset.label}</button>)}<button className="chip" onClick={() => { setCloudBase(""); setCloudModel(""); }}>{t("Custom")}</button></div></div>
        <div className="setting-row"><label>{t("Server address")}</label><div className="controls"><input value={cloudBase} onChange={(event) => setCloudBase(event.target.value)} placeholder="https://api.deepseek.com" /></div></div>
        <div className="setting-row"><label>{t("Model")}</label><div className="controls"><input value={cloudModel} onChange={(event) => setCloudModel(event.target.value)} placeholder="deepseek-chat" /></div></div>
        <div className="setting-row"><label>{t("API key")}</label><div className="controls"><input type="password" value={cloudKey} onChange={(event) => setCloudKey(event.target.value)} placeholder={cloudMasked || t("API key")} /><button className="btn" onClick={() => void saveCloud()}>{t("Save")}</button><button className="btn" onClick={() => void testCloud()}>{t("Test")}</button></div></div>
        <p className="hint">{t("Keys are stored in the Windows credential vault when the system supports it.")}</p>
        {cloudStatus && <p className="panel-note" role="status">{cloudStatus}</p>}
      </div>}

    </section>;
  }
  function renderChangelog() {
    const entries = [
      { version: __APP_VERSION__, items: [
        t("Added a plugin center backed by the isolated plugin manager; installs stay disabled until permissions are reviewed."),
        t("Revoking a plugin permission immediately unloads and disables it."),
        t("Wired Files and Logs navigation to their existing screens."),
        t("Native window background now follows light, dark or system appearance."),
        t("Rebuilt the workspace shell with a compact sidebar, global search, and a responsive chat settings panel."),
        t("Added Light, Dark and Auto appearance, nine theme previews, density, text size and reduced-motion controls."),
        t("Conversations now autosave with searchable history, pinning, deletion and undo; messages support copy, edit, regenerate and turn deletion."),
        t("Chat, model, sharing and monitoring pages now show setup steps and explicit service states."),
        t("Phase 0 of the 2.0 redesign: one semantic token layer, nine theme files and locally bundled fonts."),
        t("Three new themes: Ink green, Honey crimson and Graphite gold. Nine presets in total."),
        t("Fixed the clipped status pill, the terminal hint and the faint switch off-state."),
        t("Two new themes: Deep sea blue replaces Daylight, and Neon black pairs electric green with true black."),
        t("Closing Hymnix also stops its background gateway and services."),
        t("Start Ollama from the app or reconnect automatically after starting it yourself."),
        t("Chat follows streaming replies, with side markers to jump between turns."),
        t("Pause and resume local Ollama downloads with live progress."),
        t("The built-in terminal can receive replies from a local script via an experimental bridge."),
        t("The expanded Ollama catalog adds publisher, license, download size, and GPU memory filters."),
      ] },
      { version: "1.3.1", items: [t("Local mode always sends the local gateway key; the model list and chat now work without a manual key."), t("The Ollama button resolves the real executable instead of failing silently."), t("Startup: the window appears in ~40ms and the 9.7s port preflight loop is gone."), t("The connection bar only appears on Chat and Gateway, on a single aligned row.")] },
            { version: "1.3.0", items: [t("Product renamed to Hymnix Orbit."), t("New client-style UI with bubbles, terminal console and control panel."), t("Host mode with share password and public tunnel."), t("Guest mode: chats and models run on the host's hardware."), t("Cloud API source alongside local models.")] },
      { version: "1.2.0", items: [t("17 pages in one window."), t("Bubble cards with avatars and code copy."), t("Terminal console with status strips."), t("Five languages, 418 keys.")] },
      { version: "1.1.0", items: [t("First public build with gateway and local models.")] }
    ];
    return <section className="view-page">
      <div className="view-heading"><div><label>{t("CHANGELOG")}</label><h2>{t("Changelog")}</h2><p>{t("What changed in each release.")}</p></div></div>
      {entries.map((entry) => <div className="card" key={entry.version}>
        <h3 className="card-title">{entry.version}</h3>
        <ul className="md-li">{entry.items.map((item, index) => <li key={index}>{item}</li>)}</ul>
      </div>)}
    </section>;
  }

  function renderTools() {
    const safeTools = tools.filter((tool) => Object.prototype.hasOwnProperty.call(SAFE_TOOL_PRESETS, tool.name));
    return <section className="view-page">
      <div className="view-heading"><div><label>{t("TOOLS CATALOG")}</label><h2>{t("Tools")}</h2><p>{t("Inspect available tool metadata and permission requirements.")}</p></div><button className="btn primary" onClick={() => void loadTools()} disabled={toolsBusy}>{toolsBusy ? t("Loading...") : t("Refresh")}</button></div>
      {toolsBusy ? <div className="card empty-state"><strong>{t("Loading tools")}</strong><span>{t("Reading tool metadata...")}</span></div> : toolsError ? <div className="card empty-state"><strong>{t("Tools request failed")}</strong><span>{toolsError}</span><button className="btn" onClick={() => void loadTools()}>{t("Retry")}</button></div> : <><div className="card">
        <div className="setting-row"><label>{t("Safe tool")}</label><div className="controls"><select value={selectedTool} onChange={(event) => setSelectedTool(event.target.value)} aria-label={t("Safe tool")}><option value="">{t("Choose a safe tool")}</option>{safeTools.map((tool) => <option key={tool.name} value={tool.name}>{tool.name}</option>)}</select><button className="btn primary" onClick={() => void invokeSelectedTool()} disabled={!selectedTool || toolCall.status === "running"}>{toolCall.status === "running" ? t("Running...") : t("Run")}</button></div></div>
        <p className="subtitle">{t("Only fixed safe tools and fixed arguments are available. No commands or arbitrary arguments are accepted.")}</p>
        {toolCall.status !== "idle" && <div className="panel-row"><span>{t("Tool status")}</span><strong>{t(toolCall.status)}</strong><span>{toolCall.message}</span></div>}
        {(toolCall.status === "success" || toolCall.status === "error") && toolCall.value !== undefined && <pre>{JSON.stringify(toolCall.value, null, 2)}</pre>}
      </div>
      {tools.length === 0 ? <div className="card empty-state"><strong>{t("No tools available")}</strong><span>{t("No tool metadata was returned.")}</span></div> : <div className="list" aria-label={t("Tool metadata")}>{tools.map((tool) => <article className="list-row" key={tool.name}><span className="model-mark" aria-hidden="true">{tool.danger ? "!" : "T"}</span><span><strong>{tool.name}</strong><small>{tool.description || t("No description")}</small><small>{tool.danger ? t("Dangerous") : t("Read-only metadata")} · {tool.permission || t("No permission requirement")}</small><pre aria-label={t("Tool schema")}>{JSON.stringify(tool.schema, null, 2)}</pre></span></article>)}</div>}</> }
    </section>;
  }
  function renderPlugins() {
    const enabledCount = plugins.filter((item) => item.enabled).length;
    const loadedCount = plugins.filter((item) => item.loaded).length;
    return <section className="view-page plugin-page">
      <div className="view-heading"><div><label>{t("EXTENSIONS")}</label><h2>{t("Plugin center")}</h2><p>{t("Manage local plugins, requested permissions and runtime status.")}</p></div>
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
  function renderApprovals() {
    return <section className="view-page">
      <div className="view-heading"><div><label>{t("APPROVALS")}</label><h2>{t("Approvals")}</h2><p>{t("Review and resolve pending permission requests.")}</p></div><button className="btn primary" onClick={() => void refreshApprovals()} disabled={approvalsBusy}>{approvalsBusy ? t("Loading...") : t("Refresh")}</button></div>
      {approvalsError && <div className="error">{approvalsError}</div>}
      {approvals.length === 0 ? <div className="card empty-state"><strong>{t("No pending approvals")}</strong><span>{t("Approved and denied actions are recorded by the gateway.")}</span></div> : <div className="list">{approvals.map((approval) => <article className="list-row" key={approval.id}><span className="model-mark">!</span><span><strong>{approval.tool}</strong><small>{t("Risk")}: {approval.risk} · {approval.reasons.join("; ") || t("No reasons provided")}</small><pre>{JSON.stringify(approval.argsRedacted, null, 2)}</pre><small>{approval.createdAt} - {approval.expiresAt}</small><span className="controls"><button className="btn primary" onClick={() => void decideApproval(approval.id, "approve")} disabled={approvalsBusy}>{t("Approve")}</button><button className="btn" onClick={() => void decideApproval(approval.id, "deny")} disabled={approvalsBusy}>{t("Deny")}</button></span></span></article>)}</div>}
    </section>;
  }
  function renderMonitor() {
    const statusLabel = state === "ready" ? t("Ready") : state === "connecting" ? t("Starting") : t(state);
    const clients = Array.isArray(statusData?.clients) ? statusData.clients : [];
    const recent = Array.isArray(statusData?.recent) ? statusData.recent : [];
    return <section className="view-page">
      <div className="view-heading"><div><label>{t("GATEWAY MONITOR")}</label><h2>{t("Monitor")}</h2><p>{t("Review gateway health, usage and active operations.")}</p></div><div className="header-actions"><label className="inline-toggle"><input type="checkbox" checked={monitorAutoRefresh} onChange={(event) => setMonitorAutoRefresh(event.target.checked)} />{t("Auto refresh · 5s")}</label><button className="btn ghost" onClick={() => { void loadHealth(); if (adminKey.trim()) void loadStatus(); void pollTunnel(); }}>{t("Refresh")}</button></div></div>
      <div className="metric-grid">
        <div className="metric-card"><span>{t("Status")}</span><strong><i className={"status-dot " + (state === "ready" ? "success" : "warning")} />{statusLabel}</strong><small>{health?.gateway || t("Gateway")}</small></div>
        <div className="metric-card"><span>{t("Models")}</span><strong>{health?.models ?? models.length}</strong><small>{health?.ollama ? t("Model service online") : t("Model service offline")}</small></div>
        <div className="metric-card"><span>{t("Clients online")}</span><strong>{health?.clients_online ?? statusData?.online ?? 0}</strong><small>{t("Connected devices")}</small></div>
        <div className="metric-card"><span>{t("Uptime")}</span><strong>{formatDuration(health?.uptime_s)}</strong><small>{t("Since gateway start")}</small></div>
      </div>
      <div className="card monitor-details"><h3 className="card-title">{t("Service details")}</h3>
        <div className="detail-grid"><span>{t("Version")}</span><strong>{health?.gateway || statusData?.gateway?.version || "—"}</strong><span>{t("Gateway address")}</span><strong className="mono">{gatewayBase.replace("http://", "")}</strong><span>{t("Model service")}</span><strong>{health?.ollama ? t("Online") : t("Offline")}</strong><span>{t("Tunnel")}</span><strong>{t({ off: "Not started", starting: "Starting", up: "Ready", lost: "Disconnected", failed: "Failed" }[tunnelState] || "Not started")}</strong><span>{t("Public address")}</span><strong className="mono">{tunnelUrl || "—"}</strong></div>
      </div>
      <div className="card"><div className="setting-row admin-key-row"><label>{t("Admin key")}<span className="hint">{t("Needed only to view gateway details.")}</span></label><div className="controls"><input type="password" value={adminKey} onChange={(event) => setAdminKey(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadStatus(); }} /><button className="btn primary" onClick={() => void loadStatus()}>{t("Load details")}</button></div></div>{statusError && <p className="error">{statusError}</p>}</div>
      <div className="card"><h3 className="card-title">{t("Connected clients")}</h3>{clients.length ? <div className="client-list">{clients.map((client: any, index: number) => <div className="client-row" key={index}><span className="avatar">{index + 1}</span><span><strong>{t("Client")} {index + 1}</strong><small>{t("Last active")} · {formatDuration(client.last_seen ? Math.max(0, Math.floor((Date.now() - new Date(client.last_seen).getTime()) / 1000)) : undefined)}</small></span><span className="status-pill neutral">{client.online === false ? t("Offline") : t("Online")}</span></div>)}</div> : <div className="empty-inline">{adminKey ? t("No client details available.") : t("Load gateway details with an admin key to view clients.")}</div>}</div>
      <div className="card"><h3 className="card-title">{t("Recent activity")}</h3>{recent.length ? <div className="activity-list">{recent.slice(0, 8).map((entry: any, index: number) => <div className="activity-row" key={index}><span className="activity-dot" /><span><strong>{entry.model || entry.path || t("Gateway request")}</strong><small>{entry.t || entry.ts || ""} · {entry.status || ""}</small></span><span>{entry.elapsed_ms ? `${entry.elapsed_ms} ms` : ""}</span></div>)}</div> : <div className="empty-inline">{t("Recent activity will appear when gateway details are loaded.")}</div>}</div>
    </section>;
  }

  function renderLogs() {
    return <section className="view-page">
      <div className="view-heading"><div><label>{t("ADMIN ERRORS")}</label><h2>{t("Logs")}</h2><p>{t("Review short, redacted gateway error summaries.")}</p></div><button className="btn primary" onClick={() => void loadLogs()}>{t("Load")}</button></div>
      <div className="card"><div className="setting-row"><label>{t("Admin key")}</label><div className="controls"><input type="password" value={adminKey} onChange={(event) => setAdminKey(event.target.value)} /></div></div></div>
      {logError && <div className="error">{logError}</div>}
      {logItems.length ? <div className="list">{logItems.map((item: any, index: number) => <div className="list-row" key={index}><span className="model-mark">E</span><span>{item.t || item.time || "-"}</span><span className="model-meta">{item.code || item.message || ""}</span></div>)}</div> : <div className="card empty-state"><strong>{t("No error entries")}</strong></div>}
    </section>;
  }

  function finishWelcome() {
    try {
      localStorage.setItem("hymnix.welcome", "1");
      // Mark this version as seen so the changelog card does not pop up right after setup.
      localStorage.setItem("hymnix.whatsNew", __APP_VERSION__);
    } catch { /* ignore */ }
    setWelcomeOpen(false);
    setStartupNote(t("Gateway ready. Local models are listed on the Models page."));
    window.setTimeout(() => setStartupNote(""), 6000);
  }
  function renderSupport() {
    return <section className="view-page">
      <div className="view-heading"><div><label>{t("SUPPORT")}</label><h2>{t("Support")}</h2><p>{t("Sponsor the project or send feedback.")}</p></div></div>
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
  function renderWelcome() {
    const serviceReady = health?.ollama === true || state === "ready";
    const hasModel = models.length > 0;
    const stepped = [
      { key: "service", title: t("Model service"), done: serviceReady || welcomeSkipped.includes("service"), detail: serviceReady ? t("Running") : t("Needed before a model can answer.") },
      { key: "model", title: t("A model"), done: hasModel || welcomeSkipped.includes("model"), detail: hasModel ? tf("{count} installed", { count: String(models.length) }) : t("Download one that fits this computer.") },
      { key: "hello", title: t("Say hello"), done: messages.length > 0 || welcomeSkipped.includes("hello"), detail: messages.length > 0 ? t("First message sent") : t("Send your first message.") },
    ];
    const nextStep = stepped.find((step) => !step.done);
    const skip = (key: string) => setWelcomeSkipped((current) => current.includes(key) ? current : [...current, key]);
    const gpu = stats?.vramTotal;
    const chooseCloud = () => { setSource("cloud"); setActive("Gateway"); setGatewayTab("Cloud API"); setWelcomeOpen(false); };
    const chooseFriend = () => { setActive("Gateway"); setGatewayTab("Connect"); setWelcomeOpen(false); };
    return <div className="welcome-mask" role="dialog" aria-modal="true" aria-label={t("Welcome")}>
      <div className="welcome-card onboarding">
        <div className="welcome-brand"><img src={brandIcon} alt="" /><div><strong>Hymnix Orbit</strong><small>{__APP_VERSION__}</small></div></div>
        <h2>{t("Welcome to Hymnix Orbit")}</h2>
        <p>{t("Everything stays on this device. Get set up in three steps.")}</p>

        <div className="welcome-setup">
          <div className="setting-row"><label>{t("Language")}</label><div className="controls segmented"><button className={lang === "en" ? "active" : ""} onClick={() => changeLang("en")}>English</button><button className={lang === "zh" ? "active" : ""} onClick={() => changeLang("zh")}>中文</button></div></div>
          <div className="setting-row"><label>{t("Theme")}<span className="hint">{tf("Live preview · {name}", { name: t(THEMES.find((item) => item.id === theme)?.label || "") })}</span></label><div className="controls theme-swatches">{THEMES.map((preset) => <button key={preset.id} type="button" className={"theme-swatch " + (theme === preset.id ? "selected" : "")} aria-label={t(preset.label)} aria-pressed={theme === preset.id} onMouseEnter={() => setPreviewTheme(preset.id)} onMouseLeave={() => setPreviewTheme(null)} onFocus={() => setPreviewTheme(preset.id)} onBlur={() => setPreviewTheme(null)} onClick={() => { changeTheme(preset.id); setPreviewTheme(null); }}><i style={{ background: preset.swatch }} /></button>)}</div></div>
        </div>

        <ol className="welcome-steps">{stepped.map((step, index) => <li key={step.key} className={step.done ? "done" : ""}>
          <span className="welcome-step-mark" aria-hidden="true">{step.done ? "✓" : index + 1}</span>
          <div className="welcome-step-copy"><strong>{step.title}</strong><small>{step.detail}</small>
            {step.key === "service" && !serviceReady && <button className="btn primary" onClick={() => void startOllama()} disabled={ollamaBusy}>{t(ollamaBusy ? "Starting Ollama..." : "Start Ollama")}</button>}
            {step.key === "model" && !hasModel && <div className="welcome-step-actions"><button className="btn primary" onClick={() => { setActive("Models"); setModelsTab("Discover"); setWelcomeOpen(false); }}>{t("Browse models")}</button>{gpu ? <span className="chip accent">{tf("Fits your {gb} GB GPU", { gb: String(gpu) })}</span> : null}</div>}
            {step.key === "model" && hasModel && <ModelCombobox value={model} options={models} gpuGb={gpu} onChange={setModel} />}
            {step.key === "hello" && <form className="welcome-hello" onSubmit={(event) => { event.preventDefault(); if (model || source === "cloud") { finishWelcome(); void send(); } }}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t("Say hello to your model")} aria-label={t("Say hello to your model")} /><button className="btn primary" type="submit" disabled={!draft.trim()}>{t("Send")}</button></form>}
          </div>
          {!step.done && <button className="btn ghost welcome-skip" onClick={() => skip(step.key)}>{t("Skip")}</button>}
        </li>)}</ol>

        {netError && <p className="error">{netError}</p>}
        <div className="welcome-actions">
          <button className="btn primary" onClick={() => { if (nextStep?.key === "service") { void startOllama(); return; } if (nextStep?.key === "model") { setActive("Models"); setModelsTab("Discover"); setWelcomeOpen(false); return; } finishWelcome(); }}>{nextStep?.key === "service" ? t("Start Ollama") : nextStep?.key === "model" ? t("Choose a model") : t("Start chatting")}</button>
          <button className="btn ghost" onClick={chooseCloud}>{t("Use a cloud model instead")}</button>
          <button className="btn ghost" onClick={chooseFriend}>{t("Connect to a friend's computer")}</button>
        </div>
      </div>
    </div>;
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
      changeAppearanceMode("auto");
      persistTheme("camellia-white"); persistTheme("graphite-gold");
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
    try { const root: any = await window.hymnix.workspace.choose(); if (root?.path) await setSetting("cacheDir", root.path); }
    catch { /* cancelled */ }
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
      setSource(info?.chat_source === "cloud" ? "cloud" : "local");
      setCloudStatus("");
    } catch (reason) { setCloudStatus(reason instanceof Error ? reason.message : String(reason)); }
  }
  async function saveCloud() {
    try {
      const info: any = await window.hymnix.cloud.save({ base_url: cloudBase.trim(), model: cloudModel.trim(), api_key: cloudKey.trim(), chat_source: source, cloud_enabled: source === "cloud" });
      setCloudMasked(String(info?.api_key_masked || ""));
      setCloudKey("");
      setCloudStatus(t("Cloud settings saved."));
    } catch (reason) { setCloudStatus(reason instanceof Error ? reason.message : String(reason)); }
  }
  async function testCloud() {
    const started = performance.now();
    try {
      const result: any = await window.hymnix.cloud.test();
      const ms = Math.round(performance.now() - started);
      if (result?.ok) {
        const names = Array.isArray(result.models) ? result.models.slice(0, 6).join(", ") : "";
        setCloudStatus(`${ms} ms · ${t("Cloud reachable, models:")} ${result.count ?? 0}${names ? " · " + names : ""}`);
      } else {
        setCloudStatus(String(result?.detail || result?.error || "failed"));
      }
    } catch (reason) { setCloudStatus(reason instanceof Error ? reason.message : String(reason)); }
  }
  async function loadNetwork() {
    try { const info: any = await window.hymnix.network.info(); setHostName(String(info?.host_name || "")); setHostPassword(String(info?.host_password || "")); setTunnelUrl(String(info?.tunnel || "")); }
    catch (reason) { setNetError(reason instanceof Error ? reason.message : String(reason)); }
  }
  function applyTunnel(payload: any) {
    setTunnelState(String(payload?.state || "off"));
    setTunnelUrl(String(payload?.url || ""));
    const nextLog: string[] = Array.isArray(payload?.log) ? payload.log.slice(-12) : [];
    setTunnelLog((previous) => {
      const fresh = nextLog.filter((line) => !previous.includes(line));
      if (fresh.length) setTermEntries((current) => [...current, ...fresh.map((line) => ({ time: stamp(), tag: "sys" as const, text: "[tunnel] " + line }))]);
      return nextLog;
    });
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
    const matches = (value: string) => !settingsQuery.trim() || `${t(value)} ${value}`.toLowerCase().includes(settingsQuery.trim().toLowerCase());
    const sw = (key: keyof typeof DEFAULT_UI_SETTINGS, label: string, hint: string, disabled = false, restart = false) => <div className={disabled ? "setting-row disabled" : "setting-row"} aria-disabled={disabled}>
      <label>{t(label)}{restart && <span className="chip warning">{t("Restart needed")}</span>}<span className="hint">{t(hint)}</span></label>
      <div className="controls"><button type="button" className={"switch" + (uiSettings[key] ? " on" : "")} aria-pressed={!!uiSettings[key]} aria-label={t(label)} disabled={disabled} onClick={() => void setSetting(key, !uiSettings[key])}><span /></button></div>
    </div>;
    const head = (title: string, section: string) => <div className="card-head"><h3 className="card-title">{t(title)}</h3><button type="button" className="btn ghost reset-button" onClick={() => void resetSection(section)}>{t("Reset to default")}</button></div>;
    const themePrefs = readAppearance();
    const themeCards = (mode: "light" | "dark") => THEMES.filter((preset) => preset.mode === mode).map((preset) => {
      const selected = mode === "light" ? themePrefs.lightTheme === preset.id : themePrefs.darkTheme === preset.id;
      return <button type="button" key={preset.id} className={"theme-card " + (selected ? "selected" : "")} onMouseEnter={() => setPreviewTheme(preset.id)} onMouseLeave={() => setPreviewTheme(null)} onFocus={() => setPreviewTheme(preset.id)} onBlur={() => setPreviewTheme(null)} onClick={() => { changeTheme(preset.id); setPreviewTheme(null); setToast({ message: t("Saved") }); window.setTimeout(() => setToast(null), 1800); }} aria-pressed={selected}>
        <span className={"theme-preview " + preset.id}><i /><i /><i /></span><span className="theme-card-copy"><strong>{t(preset.label)}</strong><small>{mode === "light" ? t("Light theme") : t("Dark theme")}</small></span><span className="theme-swatches"><i /><i /></span>{selected && <span className="theme-check">✓</span>}
      </button>;
    });
    const filteredSections = sections.filter(matches);
    return <section className="view-page">
      <div className="view-heading"><div><label>{t("APPLICATION")}</label><h2>{t("Settings")}</h2><p>{t("Workspace and connection preferences.")}</p></div><label className="settings-search"><span>⌕</span><input type="search" value={settingsQuery} onChange={(event) => setSettingsQuery(event.target.value)} placeholder={t("Search settings")} /></label></div>
      <div className="settings-layout"><nav className="settings-nav" aria-label={t("Settings sections")}>{filteredSections.map((section) => <button className={settingsSection === section ? "active" : ""} key={section} onClick={() => setSettingsSection(section)}>{t(section)}</button>)}</nav><div className="settings-content">
        {restartKeys.length > 0 && <div className="restart-bar" role="status"><span>{tf("{count} changes need a restart", { count: String(restartKeys.length) })}</span><button type="button" className="btn primary" onClick={() => void window.hymnix.window.control("restart")}>{t("Restart now")}</button><button type="button" className="btn ghost" onClick={() => setRestartKeys([])}>{t("Later")}</button></div>}
        {settingsSection === "General" && <div className="card">{head("General", "General")}
          <div className="setting-row"><label>{t("Language")}<span className="hint">English / 中文</span></label><div className="controls segmented"><button className={lang === "en" ? "active" : ""} onClick={() => changeLang("en")}>English</button><button className={lang === "zh" ? "active" : ""} onClick={() => changeLang("zh")}>中文</button></div></div>
          <div className="setting-row"><label>{t("Workspace")}</label><div className="controls"><input value={workspace} onChange={(event) => setWorkspace(event.target.value)} aria-label={t("Workspace name")} /></div></div>
        </div>}
        {settingsSection === "Appearance" && <><div className="card">{head("Appearance", "Appearance")}<div className="setting-row"><label>{t("Appearance mode")}<span className="hint">{t("Choose a light or dark appearance, or follow Windows.")}</span></label><div className="controls segmented">{(["light", "dark", "auto"] as const).map((value) => <button className={appearanceMode === value ? "active" : ""} key={value} onClick={() => changeAppearanceMode(value)}>{t(value === "auto" ? "Auto" : value === "light" ? "Light" : "Dark")}</button>)}</div></div>
          <div className="theme-gallery-section"><div className="gallery-heading"><strong>{t("Light themes")}</strong><small>4</small></div><div className="theme-gallery">{themeCards("light")}</div></div><div className="theme-gallery-section"><div className="gallery-heading"><strong>{t("Dark themes")}</strong><small>5</small></div><div className="theme-gallery">{themeCards("dark")}</div></div>
          <div className="setting-row"><label>{t("Density")}<span className="hint">{t("Choose the spacing of rows and controls.")}</span></label><div className="controls segmented"><button className={density === "comfortable" ? "active" : ""} onClick={() => setDensityPreference("comfortable")}>{t("Comfortable")}</button><button className={density === "compact" ? "active" : ""} onClick={() => setDensityPreference("compact")}>{t("Compact")}</button></div></div>
          <div className="setting-row"><label>{t("Text size")}<span className="hint">{textScale}%</span></label><div className="controls scale-control"><input type="range" min="90" max="200" step="5" value={textScale} onChange={(event) => setTextScalePreference(Number(event.target.value))} aria-label={t("Text size")} /><output>{textScale}%</output></div></div>
          <div className="setting-row"><label>{t("Reduce motion")}<span className="hint">{t("Use fades instead of movement.")}</span></label><div className="controls"><button className={"switch" + (reduceMotion ? " on" : "")} aria-label={t("Reduce motion")} aria-pressed={reduceMotion} onClick={() => setMotionPreference(!reduceMotion)}><span /></button></div></div>
          {(theme.startsWith("neon") || theme.startsWith("cyan")) && <div className="setting-row"><label>{t("Soften accent")}<span className="hint">{t("Lower the accent intensity for long sessions.")}</span></label><div className="controls"><button className={"switch" + (softenAccent ? " on" : "")} aria-label={t("Soften accent")} aria-pressed={softenAccent} onClick={() => setSoftenAccent((value) => !value)}><span /></button></div></div>}
        </div><p className={"settings-saved" + (savedFlash ? " flash" : "")} role="status">{savedFlash ? "✓ " + t("Saved") : "✓ " + t("Changes are saved automatically")}</p></>}
        {settingsSection === "Startup and runtime" && <div className="card">{head("Startup and runtime", "Startup and runtime")}{sw("betaChannel", "Join client beta", "Pre-release builds, may be unstable")}{sw("runAtStartup", "Run at system startup", "Start minimized in the tray")}{sw("startFullscreen", "Start in fullscreen", "Open the window fullscreen")}{sw("dpiScaling", "Scale text and icons for this display (Beta)", "Uses display scale factor", false, true)}{sw("smoothScroll", "Enable smooth scrolling", "Animated scroll in long pages")}{sw("gpuAcceleration", "Enable GPU accelerated rendering", "Disable only if you see flicker", false, true)}{sw("autoUpdate", "Update automatically when a new version is available", "Managed by the installer", true)}<p className="subtitle">{t("GPU acceleration and the cache folder take effect after a restart.")}</p></div>}
        {settingsSection === "Models and storage" && <div className="card">{head("Models and storage", "Models and storage")}<div className="setting-row"><label>{t("Cache storage location")}</label><div className="controls"><input readOnly value={uiSettings.cacheDir || t("Default location")} /><button className="btn" onClick={() => void chooseCacheDir()}>{t("Choose folder")}</button><button className="btn ghost" onClick={() => void setSetting("cacheDir", "")}>{t("Reset")}</button></div></div><div className="setting-row"><label>{t("How to open previews")}</label><div className="controls segmented"><button className={uiSettings.previewMode === "inapp" ? "active" : ""} onClick={() => void setSetting("previewMode", "inapp")}>{t("In-app preview")}</button><button className={uiSettings.previewMode === "browser" ? "active" : ""} onClick={() => void setSetting("previewMode", "browser")}>{t("Default browser")}</button></div></div><div className="setting-row"><label>{t("Data folder")}</label><div className="controls"><input readOnly value={filesRoot || "%LOCALAPPDATA%\\Hymnix"} /><button className="btn" onClick={() => void chooseWorkspace()}>{t("Choose folder")}</button></div></div></div>}
        {settingsSection === "Sharing and security" && <div className="card settings-link-card">{head("Sharing and security", "Sharing and security")}<p className="subtitle">{t("Configure host sharing, connections and cloud provider credentials.")}</p><button className="btn primary" onClick={() => { setActive("Gateway"); setGatewayTab("Host"); }}>{t("Open sharing settings")}</button></div>}
                {settingsSection === "Shortcuts" && <div className="card">{head("Shortcuts", "Shortcuts")}<div className="setting-row"><label>{t("Send with Shift+Enter")}<span className="hint">{t("Swap the Enter and Shift+Enter behaviour.")}</span></label><div className="controls"><button type="button" className={"switch" + (enterSwaps ? " on" : "")} aria-pressed={enterSwaps} aria-label={t("Send with Shift+Enter")} onClick={() => setEnterSwaps((value) => !value)}><span /></button></div></div><div className="shortcut-list">{[["Ctrl+K", "Open command palette"], ["Ctrl+N", "New session"], ["Ctrl+L", "Focus message composer"], ["Ctrl+B", "Toggle sidebar"], ["Ctrl+.", "Toggle inspector"], ["Ctrl+,", "Open settings"], ["Ctrl+/", "Open the shortcut sheet"], ["Ctrl+1–5", "Navigate primary pages"], ["Ctrl+Shift+C", "Copy last reply"], ["Ctrl+Shift+E", "Export chat"], [enterSwaps ? "Shift+Enter" : "Enter", "Send message"], [enterSwaps ? "Enter" : "Shift+Enter", "New line"], ["↑", "Edit the last message"], ["Esc", "Close or stop"]].map(([shortcut, action]) => <div key={shortcut}><kbd>{shortcut}</kbd><span>{t(action)}</span></div>)}</div></div>}
        {settingsSection === "About" && <div className="card">{head("About", "About")}<div className="about-brand"><img src={brandIcon} alt="" /><span><strong>Hymnix Orbit</strong><small>{__APP_VERSION__} · Hymnix Studio</small></span></div><div className="setting-row"><label>{t("Updates")}</label><div className="controls"><button className="btn" onClick={() => void window.hymnix.system.openExternal("https://github.com/CarrisFlynn/hymnix-ai-server/releases")}>{t("View releases")}</button></div></div><div className="setting-row"><label>{t("Help")}</label><div className="controls"><button className="btn" onClick={() => setActive("Support")}>{t("Help & sponsor")}</button><button className="btn ghost" onClick={() => setActive("Changelog")}>{t("Changelog")}</button><button className="btn ghost" onClick={() => setActive("DesignLab")}>{t("Component gallery")}</button></div></div></div>}
        {!filteredSections.includes(settingsSection) && <div className="card empty-state"><strong>{t("No matching settings")}</strong><span>{t("Try a different search term.")}</span></div>}
      </div></div>
    </section>;
  }
  function renderView() {
    if (active === "Chat") return renderChat();
    if (active === "Models") return renderModels();
    if (active === "Files") return renderFiles();
    if (active === "Logs") return renderLogs();
    if (active === "Tools") return renderTools();
    if (active === "Plugins") return renderPlugins();
    if (active === "Approvals") return renderApprovals();
    if (active === "Terminal") return renderTerminal();
    if (active === "History") return renderHistory();
    if (active === "Gateway") return renderGateway();
    if (active === "Monitor") return renderMonitor();
    if (active === "Changelog") return renderChangelog();
    if (active === "Settings") return renderSettings();
    if (active === "Support") return renderSupport();
    if (active === "DesignLab") return <DesignLab lang={lang} mode={appearanceMode === "auto" ? systemMode() : appearanceMode} onLang={changeLang} onMode={changeAppearanceMode} onTheme={changeTheme} themes={THEMES} />;
    return <section className="view-page"><div className="view-heading"><div><label>{t("GATEWAY CAPABILITY")}</label><h2>{t(active)}</h2><p>{t(capabilityCopy[active] || "")}</p></div></div><div className="card empty-state"><strong>{t(active)}</strong><span>{t("This capability is not wired to a real workflow yet.")}</span></div></section>;
  }

  const palettePages = [...navGroups.flatMap((group) => group.items), "History", "Settings", "Changelog", "Support"];
  const paletteBase: Array<{ label: string; detail: string; icon: string; run: () => void; keywords?: string }> = [
    { label: t("New chat"), detail: t("Start a new conversation"), icon: "＋", run: createSession },
    { label: t("Component gallery"), detail: t("Developer tool"), icon: "◆", run: () => setActive("DesignLab"), keywords: "design lab components tokens theme states" },
    ...Array.from(new Set(palettePages)).map((page) => ({ label: t(page), detail: t("Open page"), icon: "↗", run: () => setActive(page) })),
    ...["General", "Appearance", "Startup and runtime", "Models and storage", "Sharing and security", "Shortcuts", "About"].map((section) => ({ label: t(section), detail: `${t("Settings")} · ${t("Open page")}`, icon: "⚙", run: () => { setActive("Settings"); setSettingsSection(section); }, keywords: `settings ${section} theme dark light auto` })),
    { label: t("Dark appearance"), detail: t("Set appearance mode"), icon: "◐", run: () => { changeAppearanceMode("dark"); setActive("Settings"); setSettingsSection("Appearance"); }, keywords: "dark theme" },
    { label: t("Start sharing"), detail: t("Open page"), icon: "↗", run: () => { setActive("Gateway"); setGatewayTab("Host"); }, keywords: "host tunnel public link" },
    ...(health?.ollama === false ? [{ label: t("Start Ollama"), detail: t("Start the model service"), icon: "▶", run: () => { void startOllama(); }, keywords: "start service model" }] : []),
    ...savedSessions.slice(0, 40).map((item) => ({ label: item.name, detail: `${t("Conversation")} · ${item.model || t("No model")}`, icon: "◷", run: () => openSession(item.id), keywords: item.messages.map((message) => message.content).join(" ") })),
    ...models.slice(0, 40).map((item) => ({ label: item.name, detail: t(item.loaded ? "Select model" : "Load model"), icon: "M", run: () => { setModel(item.name); setActive("Chat"); if (!item.loaded) void modelAction("start", item.name); }, keywords: `model ${item.loaded ? "select" : "load"}` }))
  ];
  const paletteItems = paletteBase.filter((item) => fuzzyMatch(paletteQuery, `${item.label} ${item.detail} ${item.keywords || ""}`)).slice(0, 12);
  function runPaletteItem(run: () => void) { run(); setPaletteOpen(false); setPaletteQuery(""); }
  useEffect(() => {
    if (!paletteOpen) return;
    const onPaletteKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") { event.preventDefault(); setPaletteIndex((value) => paletteItems.length ? (value + 1) % paletteItems.length : 0); }
      else if (event.key === "ArrowUp") { event.preventDefault(); setPaletteIndex((value) => paletteItems.length ? (value - 1 + paletteItems.length) % paletteItems.length : 0); }
      else if (event.key === "Enter" && paletteItems.length) { event.preventDefault(); runPaletteItem(paletteItems[Math.min(paletteIndex, paletteItems.length - 1)].run); }
    };
    window.addEventListener("keydown", onPaletteKey);
    return () => window.removeEventListener("keydown", onPaletteKey);
  }, [paletteOpen, paletteItems.length, paletteIndex, paletteQuery, savedSessions, models]);

  const terminalView = active === "Terminal";
  const chatView = active === "Chat";
  return <div className={(terminalView ? "shell terminal-mode" : chatView ? "shell chat-mode" : "shell plain-mode") + (previewOpen ? " preview-open" : "") + (sidebarCollapsed ? " sidebar-collapsed" : "") + (chatView && inspectorOpen ? " inspector-open" : "")} data-lang={lang}>
    <div className="titlebar">
      <span className="titlebar-brand"><img src={brandIcon} alt="" /><strong>Hymnix Orbit</strong></span>
      <button type="button" className="title-search" onClick={() => { setPaletteOpen(true); setPaletteQuery(""); setPaletteIndex(0); }} aria-label={t("Search or jump to...")}><span>⌕</span><span>{t("Search or jump to...")}</span><kbd>Ctrl K</kbd></button>
      <span className="titlebar-drag" />
      <div className="titlebar-actions">
        {previewOpen && <button type="button" className="preview-close" onClick={() => void closePreview()}>{t("Close preview")}</button>}
        <button type="button" onClick={() => void window.hymnix.window.control("minimize")} aria-label={t("Minimize")}>–</button>
        <button type="button" onClick={() => void window.hymnix.window.control("maximize")} aria-label={t("Maximize")}>▢</button>
        <button type="button" className="close" onClick={requestClose} aria-label={t("Close")}>✕</button>
      </div>
    </div>
    <aside className="side">
      <div className="brand"><img src={brandIcon} alt="" /><span>Hymnix Orbit<small>ORBIT</small></span><button className="collapse-sidebar" type="button" onClick={() => setSidebarCollapsed(true)} aria-label={t("Collapse sidebar")}>‹</button></div>
      <button className="new" onClick={createSession}><span aria-hidden="true">＋</span>{t("New chat")}<kbd>Ctrl N</kbd></button>
      <button type="button" className="side-search" onClick={() => { setPaletteOpen(true); setPaletteQuery(""); setPaletteIndex(0); }}><span aria-hidden="true">⌕</span>{t("Search")}<kbd>Ctrl K</kbd></button>
      <div className="side-section"><span className="side-label">{t("WORKSPACE")}</span><button className="workspace active" onClick={() => void chooseWorkspace()} title={filesRoot || t("Choose a workspace to browse files.")}><span className="dot" /><span>{filesRoot ? filesRoot.split(/[\\/]/).filter(Boolean).pop() : t(workspace)}</span><span className="workspace-caret">▾</span></button></div>
      <div className="side-section session-section"><div className="side-section-heading"><span className="side-label">{t("RECENT SESSIONS")}</span><button type="button" className="side-text-action" onClick={() => setActive("History")}>{t("See all")}</button></div>
        {sessions.length === 0 ? <span className="side-empty">{t("No sessions yet")}</span> : <div className="session-list">
          {[{ label: "Pinned", items: pinnedSessions }, { label: "Today", items: todaySessions }, { label: "Yesterday", items: yesterdaySessions }, { label: "Earlier", items: olderSessions }].filter((section) => section.items.length > 0).map((section) => <div className="session-group" key={section.label}><span className="session-group-label">{t(section.label)}</span>{section.items.slice(0, 12).map((item) => <button className={item.id === currentSessionId ? "session-item active" : "session-item"} key={item.id} onClick={() => openSession(item.id)} title={`${item.name} · ${item.count} ${t("messages")}`} aria-current={item.id === currentSessionId ? "true" : undefined}><span className="session-item-title">{item.name || t("New chat")}</span>{item.pinned && <span className="session-item-pin" aria-hidden="true">✦</span>}</button>)}</div>)}
        </div>}
      </div>
      {navGroups.map((group) => <nav className="nav-group" aria-label={t(group.title)} data-group={group.title} key={group.title}>{group.title === "DEVELOPER" ? <button type="button" className="developer-toggle" aria-expanded={developerExpanded} onClick={() => setDeveloperExpanded((value) => !value)}><span className="side-label">{t(group.title)}</span><span>{developerExpanded ? "⌄" : "›"}</span></button> : <span className="side-label">{t(group.title === "WORKSPACE" ? "NAVIGATION" : group.title)}</span>}{(group.title !== "DEVELOPER" || developerExpanded) && group.items.map((item) => <button className={active === item ? "nav active" : "nav"} key={item} onClick={() => setActive(item)} aria-current={active === item ? "page" : undefined}><Icon name={item} /><span className="nav-text">{t(item === "Gateway" ? "Sharing & connections" : item)}</span>{item === "Approvals" && approvals.length > 0 && <span className="nav-count">{approvals.length}</span>}</button>)}</nav>)}
      <div className="side-footer"><button className={active === "Settings" ? "nav active" : "nav"} onClick={() => setActive("Settings")} aria-current={active === "Settings" ? "page" : undefined}><Icon name="Settings" /><span className="nav-text">{t("Settings")}</span></button><div className="help-menu-wrap"><button type="button" className="nav" aria-expanded={helpMenuOpen} onClick={() => setHelpMenuOpen((value) => !value)}><Icon name="Support" /><span className="nav-text">{t("Help")}</span><span className="workspace-caret">▾</span></button>{helpMenuOpen && <div className="help-menu"><button onClick={() => { setActive("Changelog"); setHelpMenuOpen(false); }}>{t("Changelog")}</button><button onClick={() => { setActive("Support"); setHelpMenuOpen(false); }}>{t("Support")}</button><button onClick={() => { setActive("Settings"); setSettingsSection("Shortcuts"); setHelpMenuOpen(false); }}>{t("Keyboard shortcuts")}</button></div>}</div>
        <button className="account" onClick={() => setWelcomeOpen(true)}><span className="avatar">{mode === "remote" ? "R" : "L"}</span><span><strong>{t("Connection")}</strong><small>{mode === "local" ? t("Local mode") : t("Friend's server")}</small></span></button>
        {downloadOccupied && <button type="button" className="download-ring-wrap" onClick={() => { setActive("Models"); setModelsTab("Downloads"); }} aria-label={t("Model download progress")}><span className="download-ring" style={{ background: `conic-gradient(var(--accent-fill) ${download?.completed != null && download?.total ? Math.floor(100 * download.completed / download.total) : 0}%, var(--sunken) 0)` }}><i /></span><small>{download?.model}</small></button>}
        <div className="status-popover-wrap"><button type="button" className="side-status" aria-expanded={statusPopoverOpen} onClick={() => setStatusPopoverOpen((value) => !value)}><span className="dot" data-state={state} aria-hidden="true" />{t(state)}</button>{statusPopoverOpen && <div className="status-popover"><strong>{t(state)}</strong><span>{health?.gateway || t("Gateway")}</span><button onClick={() => { setActive("Monitor"); setStatusPopoverOpen(false); }}>{t("View monitor")}</button></div>}</div>
      </div>
    </aside>
    <main className={terminalView ? "main terminal-main" : "main"}>
      {chatView && <header className="workspace-header chat-workspace-header">
        <div className="chat-header-title">{renamingSession ? <form className="rename-session" onSubmit={(event) => { event.preventDefault(); commitRenameSession(); }}><input autoFocus value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setRenamingSession(false); }} aria-label={t("Conversation name")} /><button className="btn primary" type="submit">{t("Save name")}</button></form> : <h1 title={t("Double-click to rename")} onDoubleClick={beginRenameSession}>{sessionName}</h1>}<span className="chat-readiness"><span className={"status-pill " + (state === "ready" ? "success" : state === "error" ? "danger" : "neutral")}><span className="status-dot" />{t(state === "ready" ? "Ready" : state === "starting" ? "Starting" : state === "error" ? "Error" : "Limited")}</span>{model || (source === "cloud" ? t("Cloud API") : t("Choose a model"))}</span></div>
        <div className="header-actions chat-header-actions"><button type="button" className="btn ghost" onClick={() => setInspectorOpen((value) => !value)} aria-expanded={inspectorOpen}>{t(inspectorOpen ? "Hide settings" : "Chat settings")}</button><button type="button" className="btn ghost icon-button" onClick={() => { setPaletteOpen(true); setPaletteIndex(0); }} aria-label={t("Search or jump to...")}>⌕</button><div className="conversation-menu-wrap" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setConversationMenuOpen(false); }}><button type="button" className="btn ghost icon-button" aria-label={t("Conversation actions")} aria-haspopup="menu" aria-expanded={conversationMenuOpen} onClick={() => setConversationMenuOpen((value) => !value)}>⋯</button>{conversationMenuOpen && <div className="conversation-menu" role="menu"><button type="button" role="menuitem" onClick={beginRenameSession}>{t("Rename conversation")}</button><button type="button" role="menuitem" onClick={() => { toggleCurrentPin(); setConversationMenuOpen(false); }}>{t(savedSessions.find((item) => item.id === currentSessionId)?.pinned ? "Unpin conversation" : "Pin conversation")}</button><button type="button" role="menuitem" onClick={() => { exportChat(); setConversationMenuOpen(false); }}>{t("Export chat")}</button><hr /><button type="button" role="menuitem" className="danger" onClick={() => { clearCurrentConversation(); setConversationMenuOpen(false); }}>{t("Clear conversation")}</button></div>}</div></div>
      </header>}
      {renderView()}
      {startupNote && !terminalView && <div className="notice" role="status">{startupNote}</div>}
      {(error || connectionError) && !terminalView && <div className="error" role="alert">{error || connectionError}</div>}
    </main>
    {!terminalView && chatView && <aside className={"inspect" + (inspectorOpen ? "" : " collapsed")}>
      <details className="inspector-section" open><summary>{t("Model source")}</summary><div className="panel-card">
        <div className="segmented">
          <button className={source === "local" ? "active" : ""} onClick={() => setSource("local")}>{t("Local model")}</button>
          <button className={source === "cloud" ? "active" : ""} onClick={() => setSource("cloud")}>{t("Cloud API")}</button>
        </div>
        {source === "cloud" && <div className="cloud-fields">
          <input value={cloudBase} onChange={(event) => setCloudBase(event.target.value)} placeholder="https://api.deepseek.com" />
          <input value={cloudModel} onChange={(event) => setCloudModel(event.target.value)} placeholder="deepseek-chat" />
          <input type="password" value={cloudKey} onChange={(event) => setCloudKey(event.target.value)} placeholder={cloudMasked || t("API key")} />
          <div className="panel-actions">
            <button className="btn" onClick={() => void saveCloud()}>{t("Save")}</button>
            <button className="btn" onClick={() => void testCloud()}>{t("Test")}</button>
          </div>
          {cloudStatus && <p className="panel-note">{cloudStatus}</p>}
        </div>}
      </div></details>
      <details className="inspector-section" open><summary>{t("Model")}</summary><div className="panel-card">
        <select className="panel-select" value={model} onChange={(event) => setModel(event.target.value)}>
          {models.length === 0 && <option value="">{t("No model list loaded")}</option>}
          {models.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
        </select>
        <div className="panel-actions">
          <button className={selectedLocalModel?.loaded ? "btn" : "btn primary"} onClick={() => void modelAction(selectedLocalModel?.loaded ? "stop" : "start", model)} disabled={!model || modelBusy === model}>{modelBusy === model ? t("Loading...") : selectedLocalModel?.loaded ? t("Unload model") : t("Load model")}</button>
          <button className="btn" onClick={() => void loadModels()} aria-label={t("Refresh models")}>{t("Refresh")}</button>
        </div>
        <button type="button" className="panel-link" onClick={() => setActive("Models")}>{t("Get more models...")}</button>
        {modelNote && <p className="panel-note">{modelNote}</p>}
      </div></details>
      <details className="inspector-section" open><summary>{t("Reasoning")}</summary><div className="panel-card">
        <div className="segmented">
          {[["low", t("Low")], ["medium", t("Medium")], ["high", t("High")]].map(([value, label]) => <button key={value} className={effort === value ? "active" : ""} onClick={() => setEffort(value)}>{label}</button>)}
        </div>
        <p className="panel-note">{t("Higher effort uses more tokens per reply.")}</p>
      </div></details>
      <details className="inspector-section" open><summary>{t("Telemetry")}</summary><div className="panel-card telemetry-grid">
        {[{ label: "GPU", value: stats?.gpu }, { label: "AI", value: stats?.ai }, { label: "VRAM", value: stats?.vramTotal ? stats.vramUsed == null ? null : stats.vramUsed / stats.vramTotal * 100 : null, text: stats?.vramUsed != null && stats?.vramTotal != null ? `${stats.vramUsed}/${stats.vramTotal} GB` : undefined }, { label: "RAM", value: stats?.ramTotal ? stats.ramUsed / stats.ramTotal * 100 : null, text: stats ? `${(stats.ramUsed / 1024).toFixed(1)}/${(stats.ramTotal / 1024).toFixed(1)} GB` : undefined }].map((item) => <div className="telemetry-item" key={item.label}><div><span>{item.label}</span><strong>{item.text || (item.value != null ? Math.round(item.value) + "%" : "—")}</strong></div><div className="telemetry-track"><i style={{ width: `${Math.max(0, Math.min(100, item.value || 0))}%` }} /></div></div>)}
      </div></details>
    </aside>}
    {paletteOpen && <div className="palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setPaletteOpen(false); setPaletteQuery(""); } }}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-label={t("Command palette")}>
        <div className="palette-search"><span aria-hidden="true">⌕</span><input ref={paletteInputRef} type="search" value={paletteQuery} onChange={(event) => { setPaletteQuery(event.target.value); setPaletteIndex(0); }} placeholder={t("Search pages, conversations and models...")} /><kbd>ESC</kbd></div>
        <div className="palette-results" role="listbox" aria-label={t("Search results")}>
          {paletteItems.length ? paletteItems.map((item, index) => <button type="button" role="option" aria-selected={index === paletteIndex} className={index === paletteIndex ? "selected" : ""} key={`${item.label}-${item.detail}`} onMouseEnter={() => setPaletteIndex(index)} onClick={() => runPaletteItem(item.run)}><span className="palette-icon">{item.icon}</span><span><strong>{item.label}</strong><small>{item.detail}</small></span><kbd>↵</kbd></button>) : <div className="palette-empty">{t("No matching results")}</div>}
        </div>
        <footer><span>{t("Navigate")}: <kbd>↑</kbd> <kbd>↓</kbd></span><span>{t("Open")}: <kbd>Enter</kbd></span><span>{t("Close")}: <kbd>Esc</kbd></span></footer>
      </section>
    </div>}
    {clearAllConfirm && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setClearAllConfirm(false); }}><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="clear-history-title"><div className="dialog-icon">!</div><h2 id="clear-history-title">{tf("Delete {count} conversations?", { count: String(sessions.length) })}</h2><p>{t("All saved conversations will be removed. You can undo this for 10 seconds.")}</p><div className="dialog-actions"><button type="button" className="btn" autoFocus onClick={() => setClearAllConfirm(false)}>{t("Cancel")}</button><button type="button" className="btn danger" onClick={clearAllSessions}>{tf("Delete {count} conversations", { count: String(sessions.length) })}</button></div></section></div>}
    {modelDeleteTarget && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModelDeleteTarget(null); }}><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-model-title"><div className="dialog-icon danger">!</div><h2 id="delete-model-title">{t("Delete model")}</h2><p>{tf("Delete model {model} from this device? This cannot be undone.", { model: modelDeleteTarget })}</p><div className="dialog-actions"><button type="button" className="btn" autoFocus onClick={() => setModelDeleteTarget(null)}>{t("Cancel")}</button><button type="button" className="btn danger" onClick={() => { void modelAction("delete", modelDeleteTarget); setModelDeleteTarget(null); }}>{t("Delete model")}</button></div></section></div>}
    {pluginDeleteTarget && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPluginDeleteTarget(null); }}><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="uninstall-plugin-title"><div className="dialog-icon danger">!</div><h2 id="uninstall-plugin-title">{tf("Uninstall {name}?", { name: pluginDeleteTarget.name })}</h2><p>{t("Uninstall moves the plugin to its local recovery folder.")}</p><div className="dialog-actions"><button type="button" className="btn" autoFocus onClick={() => setPluginDeleteTarget(null)}>{t("Cancel")}</button><button type="button" className="btn danger" disabled={!!pluginActionBusy} onClick={() => void uninstallPlugin()}>{t("Uninstall")}</button></div></section></div>}
    {sidebarCollapsed && <button className="expand-sidebar" type="button" onClick={() => setSidebarCollapsed(false)} aria-label={t("Expand sidebar")}>›</button>}
    {toast && <div className="toast" role="status"><span>{toast.message}</span>{toast.action && toast.undo && <button type="button" onClick={toast.undo}>{toast.action}</button>}<button type="button" className="toast-close" onClick={() => setToast(null)} aria-label={t("Dismiss")}>×</button></div>}
    {download && <ModelDownloadFooter download={download} lang={lang} remote={remoteActive()}
      onPause={() => stopModelDownload("pause")} onResume={resumeModelDownload}
      onCancel={() => stopModelDownload("cancel")} onDismiss={() => setDownload(null)} />}
    {welcomeOpen && renderWelcome()}
    {whatsNewOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setWhatsNewOpen(false); try { localStorage.setItem("hymnix.whatsNew", __APP_VERSION__); } catch { /* private mode */ } } }}>
      <section className="confirm-dialog whats-new" role="dialog" aria-modal="true" aria-labelledby="whats-new-title">
        <div className="dialog-icon">✦</div>
        <h2 id="whats-new-title">{tf("What's new in {version}", { version: __APP_VERSION__ })}</h2>
        <ul className="md-li">
          <li>{t("Nine themes with Auto following Windows, and a preview gallery in Settings.")}</li>
          <li>{t("Command palette (Ctrl+K), new shortcuts, and a shortcut sheet.")}</li>
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
