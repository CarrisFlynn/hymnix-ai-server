import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ApprovalRecord, DesktopApi, ToolDescriptor } from "../shared/protocol";
import "./styles.css";
import brandIcon from "./assets/hymnix-red-white-star.png";
import { t, tf, getLang, setLang, translateDom, installAutoTranslate, type Lang } from "./i18n";
import { Bubble, type ChatMessage } from "./chat";

declare global { interface Window { hymnix: DesktopApi } }

type Message = ChatMessage;
type Entry = { time: string; tag: "sys" | "out" | "err"; text: string };
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
  { title: "WORKSPACE", items: ["Chat", "History"] },
  { title: "SERVER", items: ["Gateway", "Models", "Terminal", "Monitor"] },
  { title: "MORE", items: ["Changelog", "Support", "Settings"] }
];

const DEFAULT_UI_SETTINGS = { betaChannel: false, runAtStartup: false, dpiScaling: false, startFullscreen: false, autoUpdate: true, smoothScroll: true, gpuAcceleration: true, cacheDir: "", previewMode: "inapp" as "inapp" | "browser" };

const RECOMMENDED = [
  { name: "qwen3:0.6b", size: "0.5 GB", tag: "Tiny general" },
  { name: "qwen3:1.7b", size: "1.4 GB", tag: "Small general" },
  { name: "qwen3:4b", size: "2.6 GB", tag: "Fast general" },
  { name: "qwen3:8b", size: "5.2 GB", tag: "Balanced general chat" },
  { name: "qwen3:14b", size: "9.3 GB", tag: "Strong general chat" },
  { name: "qwen3:32b", size: "20 GB", tag: "Large general chat" },
  { name: "qwen2.5:3b", size: "1.9 GB", tag: "Fast Chinese chat" },
  { name: "qwen2.5:7b", size: "4.7 GB", tag: "Fast Chinese chat" },
  { name: "qwen2.5:14b", size: "9.0 GB", tag: "Strong Chinese chat" },
  { name: "qwen2.5-coder:1.5b", size: "1.0 GB", tag: "Lightweight coding" },
  { name: "qwen2.5-coder:7b", size: "4.7 GB", tag: "Coding" },
  { name: "qwen2.5-coder:14b", size: "9.0 GB", tag: "Strong coding" },
  { name: "deepseek-r1:1.5b", size: "1.1 GB", tag: "Reasoning" },
  { name: "deepseek-r1:7b", size: "4.7 GB", tag: "Reasoning" },
  { name: "deepseek-r1:8b", size: "5.2 GB", tag: "Reasoning" },
  { name: "deepseek-r1:14b", size: "9.0 GB", tag: "Strong reasoning" },
  { name: "deepseek-coder:1.3b", size: "0.8 GB", tag: "Lightweight coding" },
  { name: "deepseek-coder:6.7b", size: "3.8 GB", tag: "Coding" },
  { name: "llama3.1:8b", size: "4.9 GB", tag: "General English" },
  { name: "llama3.2:1b", size: "1.3 GB", tag: "Tiny general" },
  { name: "llama3.2:3b", size: "2.0 GB", tag: "Small general" },
  { name: "gemma3:1b", size: "0.8 GB", tag: "Tiny general" },
  { name: "gemma3:4b", size: "3.3 GB", tag: "Small and fast" },
  { name: "gemma3:12b", size: "8.1 GB", tag: "Strong general" },
  { name: "mistral:7b", size: "4.4 GB", tag: "General English" },
  { name: "phi4:14b", size: "9.1 GB", tag: "Reasoning" },
  { name: "phi3.5:3.8b", size: "2.2 GB", tag: "Small general" },
  { name: "codellama:7b", size: "3.8 GB", tag: "Coding" },
  { name: "starcoder2:3b", size: "1.7 GB", tag: "Coding" },
  { name: "nomic-embed-text:latest", size: "274 MB", tag: "Embeddings" },
  { name: "mxbai-embed-large:latest", size: "670 MB", tag: "Embeddings" },
  { name: "all-minilm:latest", size: "46 MB", tag: "Embeddings" }
];


const capabilityCopy: Record<string, string> = {
  Tools: "Inspect registered tools and recent tool calls.",
  Approvals: "Review and resolve pending permission requests.",
  Plugins: "Manage installed plugins and lifecycle status."
};

function stamp(): string { return new Date().toLocaleTimeString("zh-CN", { hour12: false }); }

function App() {
  const [state, setState] = useState("connecting");
  const [active, setActive] = useState("Chat");
  const [lang, setLangState] = useState<Lang>(getLang());
  const [theme, setThemeState] = useState<string>(() => { try { return localStorage.getItem("hymnix.theme") || "camellia-white"; } catch { return "camellia-white"; } });
  const [workspace, setWorkspace] = useState("Default workspace");
  const [sessionName, setSessionName] = useState("Untitled session");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [welcomeOpen, setWelcomeOpen] = useState<boolean>(() => { try { return localStorage.getItem("hymnix.welcome") !== "1"; } catch { return true; } });
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
  const [sessions, setSessions] = useState<Array<{ id: string; name: string; at: string; count: number; model: string }>>(() => {
    try { const raw = localStorage.getItem("hymnix.chat.history"); return raw ? JSON.parse(raw) : []; } catch { return []; }
  });
  const [stats, setStats] = useState<{ gpu: number | null; vramUsed: number | null; vramTotal: number | null; ramUsed: number; ramTotal: number; ai: number | null } | null>(null);
  const [netError, setNetError] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [adminKey, setAdminKey] = useState("");

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState("");
  const [modelBusy, setModelBusy] = useState("");
  const [pullName, setPullName] = useState("");
  const [modelNote, setModelNote] = useState("");
  const [modelQuery, setModelQuery] = useState("");

  const [draft, setDraft] = useState("");
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
    return [];
  });
  const [error, setError] = useState("");
  const requestRef = useRef<string | null>(null);

  const [health, setHealth] = useState<any>(null);
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
  async function loadHealth() {
    try {
      const h: any = remoteActive()
        ? await window.hymnix.network.get(serverBase.trim(), "/health", apiKey)
        : await window.hymnix.gateway.health();
      setHealth(h); setState(h?.ok ? "ready" : "degraded");
    } catch (reason) { setState("error"); setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  async function loadModels() {
    try {
      if (remoteActive()) {
        const remote: any = await window.hymnix.network.get(serverBase.trim(), "/api/tags", apiKey);
        const remoteList: ModelInfo[] = (remote?.models || []).map((item: any) => ({ name: String(item.name || item.model || ""), loaded: false })).filter((item: ModelInfo) => item.name);
        setModels(remoteList);
        setModel((current) => current || remoteList[0]?.name || "");
        return;
      }
      const result: any = await window.hymnix.models.list();
      const list: ModelInfo[] = (result?.models || []).map((item: any) => ({ name: String(item.name || item.model || ""), loaded: !!item.loaded })).filter((item: ModelInfo) => item.name);
      setModels(list);
      setModel((current) => current || list[0]?.name || "");
    } catch (reason) { setModelNote(reason instanceof Error ? reason.message : String(reason)); }
  }
  useEffect(() => { void window.hymnix.bootstrap().then((info) => { setGatewayBase(info.base); setServerBase((current) => current === "http://127.0.0.1:11435" ? info.base : current); }).catch(() => undefined); }, []);
  useEffect(() => { void loadHealth(); void loadModels(); void loadCloud(); void window.hymnix.settings.get().then((value) => setUiSettings({ ...DEFAULT_UI_SETTINGS, ...value })).catch(() => undefined); }, []);
  useEffect(() => { void window.hymnix.github.stars().then((value) => setStars(value?.stars ?? null)).catch(() => undefined); }, []);
  useEffect(() => { document.documentElement.style.scrollBehavior = uiSettings.smoothScroll ? "smooth" : "auto"; }, [uiSettings.smoothScroll]);
  useEffect(() => {
    if (active !== "Gateway" && active !== "Monitor") return;
    void pollTunnel();
    const timer = window.setInterval(() => void pollTunnel(), 2000);
    return () => window.clearInterval(timer);
  }, [active]);
  useEffect(() => {
    let alive = true;
    const tick = async () => { try { const next = await window.hymnix.system.stats(); if (alive) setStats(next); } catch { /* ignore */ } };
    void tick();
    const timer = window.setInterval(() => void tick(), 3000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
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
  function changeTheme(next: string) { setThemeState(next); try { localStorage.setItem("hymnix.theme", next); } catch { /* ignore */ } }

  async function send() {
    const text = draft.trim(); if (!text) return;
    const usingCloud = source === "cloud";
    const ready = usingCloud ? !!cloudModel.trim() : !!model;
    if (!ready) { setStartupNote(t("Pick a model, start Ollama, or switch to Cloud API.")); window.setTimeout(() => setStartupNote(""), 5000); return; }
    const next: Message[] = [...messages, { role: "user", content: text, at: stamp() }, { role: "assistant", content: "", at: stamp() }];
    setMessages(next); setDraft(""); setError("");
    const requestId = crypto.randomUUID(); requestRef.current = requestId;
    try {
      const cloudMode = source === "cloud";
      const chatBase = cloudMode ? cloudBase.trim().replace(/\/+$/, "").replace(/\/v1$/, "") : serverBase;
      const chatKey = cloudMode ? cloudKey.trim() : apiKey.trim();
      const chatModel = cloudMode ? (cloudModel.trim() || model) : model;
      await window.hymnix.gateway.streamChat({ requestId, baseUrl: chatBase, apiKey: chatKey, model: chatModel, reasoningEffort: effort, messages: next.slice(0, -1), onDelta: (part: any) => {
        const payload = part?.choices?.[0]?.delta || {};
        const content = payload.content || ""; const thinking = payload.reasoning_content || payload.reasoning || "";
        if (!content && !thinking) return;
        setMessages((current) => current.map((item, index) => index === current.length - 1 ? { ...item, content: item.content + content, reasoning: (item.reasoning || "") + thinking } : item));
      } });
    } catch (reason) {
      if (requestRef.current !== requestId) return;
      setState("degraded"); setError(reason instanceof Error ? reason.message : String(reason));
      setMessages((current) => current.filter((item, index) => !(index === current.length - 1 && item.role === "assistant" && !item.content)));
    } finally { if (requestRef.current === requestId) requestRef.current = null; }
  }
  function cancel() { if (requestRef.current) { window.hymnix.gateway.cancelChat(requestRef.current); requestRef.current = null; } }

  async function modelAction(action: "start" | "stop" | "delete", name: string) {
    setModelBusy(name); setModelNote("");
    try { if (action === "start") await window.hymnix.models.start(name); if (action === "stop") await window.hymnix.models.stop(name); if (action === "delete") await window.hymnix.models.remove(name); await loadModels(); }
    catch (reason) { setModelNote(reason instanceof Error ? reason.message : String(reason)); }
    finally { setModelBusy(""); }
  }
  async function pullModelByName(name: string) {
    setModelBusy(name); setModelNote(t("Pulling") + " " + name);
    try { await window.hymnix.models.pull(name); setModelNote(t("Pull complete") + ": " + name); await loadModels(); }
    catch (reason) { setModelNote(reason instanceof Error ? reason.message : String(reason)); }
    finally { setModelBusy(""); }
  }
  async function pullModel() {
    const name = pullName.trim(); if (!name) return;
    setModelBusy(name); setModelNote(t("Pulling") + " " + name);
    try { await window.hymnix.models.pull(name); setModelNote(t("Pull complete") + ": " + name); setPullName(""); await loadModels(); }
    catch (reason) { setModelNote(reason instanceof Error ? reason.message : String(reason)); }
    finally { setModelBusy(""); }
  }

  async function chooseWorkspace() {
    setFilesBusy(true); setFilesError("");
    try {
      const root: any = await window.hymnix.workspace.choose();
      if (!root?.path) { setFilesError(t("No workspace selected")); return; }
      setFilesRoot(root.path);
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

  async function runTerm() {
    const raw = termCmd.trim();
    if (!raw || termBusy) return;
    termOut("sys", "> " + raw);
    setTermCmd("");
    termHistory.current = [...termHistory.current, raw];
    termCursor.current = termHistory.current.length;
    const [cmd, ...args] = raw.split(/\s+/);
    const name = cmd.toLowerCase();
    try {
      switch (name) {
        case "help":
          termOut("sys", "help · status · version · models · model <name> · start <name> · stop <name> · pull <name>");
          termOut("sys", "tunnel on|off|restart|status · hardware · ps · dir · logtail · export · open <url>");
          termOut("sys", "config · get <key> · set <key> <value> · quota <n> · billing on|off · lang en|zh · clear");
          termOut("sys", "其它命令交给工作区 shell 执行");
          return;
        case "clear":
          setTermEntries([]);
          return;
        case "status":
          termOut("sys", "gateway=" + state + " models=" + models.length + " model=" + (model || "-") + " cwd=" + (filesRoot || "-"));
          termOut("sys", "tunnel=" + tunnelState + " url=" + (tunnelUrl || "-"));
          return;
        case "version":
          termOut("sys", "Hymnix Orbit 1.3.0 · gateway " + (health?.gateway || "-"));
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
          setPullName(args[0]);
          await pullModel();
          termOut("sys", "pull " + args[0] + " -> requested");
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
    try {
      const id = "s" + Date.now();
      const name = (messages.find((item) => item.role === "user")?.content || t("Untitled session")).slice(0, 40);
      const payload = { id, name, at: new Date().toISOString(), model, messages };
      localStorage.setItem("hymnix.chat.saved", JSON.stringify(payload));
      const next = [{ id, name, at: payload.at, count: messages.length, model }, ...sessions].slice(0, 50);
      setSessions(next);
      try { localStorage.setItem("hymnix.chat.history", JSON.stringify(next)); } catch { /* ignore */ }
      setStartupNote(t("Conversation saved locally."));
      window.setTimeout(() => setStartupNote(""), 3000);
    } catch { /* ignore */ }
  }
  function loadChat() {
    try {
      const raw = localStorage.getItem("hymnix.chat.saved");
      if (!raw) { setStartupNote(t("No saved conversation yet.")); window.setTimeout(() => setStartupNote(""), 3000); return; }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.messages)) setMessages(parsed.messages as Message[]);
      if (parsed?.model) setModel(String(parsed.model));
    } catch { /* ignore */ }
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
  function renderChat() {
    return <>
      <section className="canvas" aria-live="polite">
        {messages.length === 0 ? <div className="empty">
          <div className="star"><img src={brandIcon} alt="" /></div>
          <h2>{t("What are you working on?")}</h2>
          <p>{tf("Start with {workspace} or choose a prompt.", { workspace: t(workspace) })}</p>
          <div className="chips"><button className="btn" onClick={() => setDraft(t("Summarize the current workspace"))}>{t("Summarize workspace")}</button><button className="btn" onClick={() => setDraft(t("Help me inspect a model"))}>{t("Inspect a model")}</button></div>
        </div> : messages.map((message, index) => <Bubble key={index} message={message} />)}
      </section>
      <div className="telemetry-bar">
        <span>GPU {stats?.gpu != null ? stats.gpu + "%" : "-"}</span>
        <span>VRAM {stats?.vramUsed != null && stats?.vramTotal != null ? stats.vramUsed + "/" + stats.vramTotal + "G" : "-"}</span>
        <span>AI {stats?.ai != null ? stats.ai + "%" : "-"}</span>
        <span>RAM {(stats ? (stats.ramUsed / 1024).toFixed(1) : "-") + "/" + (stats ? (stats.ramTotal / 1024).toFixed(1) : "-")}G</span>
      </div>
      {messages.length > 0 && <div className="chat-tools">
        <button className="btn" onClick={() => void copyLastReply()}>{t("Copy last reply")}</button>
        <button className="btn" onClick={() => setMessages([])}>{t("Clear")}</button>
        <button className="btn" onClick={exportChat}>{t("Export chat")}</button>
        <span className="chat-stat">{model || "-"} · {messages.length} {t("messages")}</span>
      </div>}
      <form className="composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <textarea aria-label={t("Message")} rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} placeholder={t("Ask Hymnix anything...")} />
        <footer>
          <div>
            <select className="btn" value={model} onChange={(event) => setModel(event.target.value)} aria-label={t("Model")}>
              {models.length === 0 && <option value="">{t("No model list loaded")}</option>}
              {models.map((item) => <option key={item.name} value={item.name}>{item.name}{item.loaded ? " •" : ""}</option>)}
            </select>
            <button type="button" className="btn" onClick={() => void loadModels()}>{t("Refresh")}</button>
          </div>
          <div>
            <button type="button" className="btn" onClick={cancel}>{t("Stop")}</button>
            <button type="submit" className="btn primary" disabled={!draft.trim()}>{t("Send ↵")}</button>
          </div>
        </footer>
      </form>
    </>;
  }

  function renderModels() {
    const installedNames = new Set(models.map((item) => item.name));
    const query = modelQuery.trim().toLowerCase();
    const catalogAvailable = RECOMMENDED.filter((entry) => !installedNames.has(entry.name)).filter((entry) => !query || entry.name.toLowerCase().includes(query) || t(entry.tag).toLowerCase().includes(query));
    return <section className="view-page">
      <div className="view-heading"><div><label>{t("MODEL CATALOG")}</label><h2>{t("Models")}</h2><p>{t("Discover models served by the local gateway.")}</p></div><button className="btn primary" onClick={() => void loadModels()}>{t("Refresh models")}</button></div>
      {!health?.ollama && <div className="card offline-card"><div><strong>{t("Model service is offline")}</strong><span>{t("Start Ollama to list and run local models.")}</span></div><button className="btn primary" onClick={() => { setModelNote(t("Starting Ollama...")); void window.hymnix.ollama.control("start").then(() => { void loadHealth(); void loadModels(); }).catch((reason) => setModelNote(reason instanceof Error ? reason.message : String(reason))); }}>{t("Start Ollama")}</button></div>}
      <div className="card">
        <h3 className="card-title">{t("Installed models")} · {models.length}</h3>
        {models.length === 0 ? <p className="subtitle">{t("No model installed yet.")}</p> : <div className="catalog">{models.map((item) => <div className="catalog-row" key={item.name}>
          <span className="model-mark">AI</span>
          <span className="catalog-main"><strong>{item.name}</strong><small>{item.loaded ? t("Loaded") : t("Available model")}</small></span>
          <button className="btn" onClick={() => setModel(item.name)}>{model === item.name ? t("Selected") : t("Select")}</button>
          <button className="btn" onClick={() => void modelAction(item.loaded ? "stop" : "start", item.name)} disabled={modelBusy === item.name}>{item.loaded ? t("Stop") : t("Start")}</button>
          <button className="btn" onClick={() => void modelAction("delete", item.name)} disabled={modelBusy === item.name}>{t("Delete")}</button>
        </div>)}</div>}
      </div>
      <div className="card">
        <h3 className="card-title">{t("Downloadable models")} · {catalogAvailable.length}</h3>
        <div className="catalog-search-row"><input className="catalog-search" value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder={t("Search models…")} /><button className="btn" onClick={() => setModelQuery("")} disabled={!modelQuery}>{t("Clear")}</button></div>
        {catalogAvailable.length === 0 ? <p className="subtitle">{t("Everything in the catalog is already installed.")}</p> : <div className="catalog-scroll">{catalogAvailable.map((entry) => <div className="catalog-row" key={entry.name}>
          <span className="model-mark">AI</span>
          <span className="catalog-main"><strong>{entry.name}</strong><small>{entry.size} · {t(entry.tag)}</small></span>
          <button className="btn" disabled={!!modelBusy} onClick={() => void pullModelByName(entry.name)}>{modelBusy === entry.name ? t("Working...") : t("Download")}</button>
        </div>)}</div>}
        {modelNote && <p className="subtitle">{modelNote}</p>}
      </div>
    </section>;
  }
  function renderTerminal() {
    const hints = [t("↑ history"), "Tab " + t("complete"), t("scroll to inspect")].join(" · ");
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
      <div className="term-logbar"><span>SYS.LOG</span><span className="term-logactions"><button className="term-link" onClick={() => void navigator.clipboard?.writeText(termEntries.map((item) => item.time + "  " + item.tag.toUpperCase() + "  " + item.text).join("\n"))}>{t("Copy")}</button><button className="term-link" onClick={() => setTermEntries([])}>{t("Clear")}</button></span></div>
      <div className="term-body">
        {termEntries.length === 0 ? <div className="term-line"><span className="term-time">--:--:--.---</span><span className="term-tag sys">SYS</span><span className="term-text dim">{t("No output yet")}</span></div>
          : termEntries.map((item, index) => <div className="term-line" key={index}><span className="term-time">{item.time}</span><span className={"term-tag " + item.tag}>{item.tag.toUpperCase()}</span><span className="term-text">{item.text}</span></div>)}
      </div>
      <form className="term-input" onSubmit={(event) => { event.preventDefault(); void runTerm(); }}>
        <span className="term-caret">&gt;</span>
        <input value={termCmd} onChange={(event) => setTermCmd(event.target.value)} placeholder={t("Type a command…")}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" && termHistory.current.length) { event.preventDefault(); const next = Math.max(0, termCursor.current - 1); termCursor.current = next; setTermCmd(termHistory.current[next] || ""); }
            if (event.key === "ArrowDown" && termHistory.current.length) { event.preventDefault(); const next = Math.min(termHistory.current.length, termCursor.current + 1); termCursor.current = next; setTermCmd(termHistory.current[next] || ""); }
            if (event.key === "Tab") { event.preventDefault(); const builtins = ["help", "status", "models", "clear"]; const typed = termCmd.trim(); const match = typed ? builtins.find((name) => name.startsWith(typed)) : undefined; if (match) setTermCmd(match); }
          }} />
        <button className="term-exec" type="submit" disabled={termBusy}>EXEC</button>
      </form>
      <div className="term-foot"><span>UPTIME {health?.uptime_s ? health.uptime_s + "s" : "-"}   LOG N {termEntries.length}</span></div>
      <div className="term-hint">{t("Commands")}: status · models · model [name] · start/stop [name] · pull [name] · tunnel on|off · hardware · config · set [key] [value] · logtail · export · {hints}</div>
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
    return <section className="view-page">
      <div className="view-heading"><div><label>{t("CONVERSATIONS")}</label><h2>{t("History")}</h2><p>{t("Saved conversations on this machine.")}</p></div><button className="btn" onClick={() => { setSessions([]); try { localStorage.removeItem("hymnix.chat.history"); localStorage.removeItem("hymnix.chat.saved"); } catch { /* ignore */ } }}>{t("Clear all")}</button></div>
      {sessions.length === 0 ? <div className="card empty-state"><strong>{t("No saved conversations")}</strong><span>{t("Use Save in the chat panel to keep a conversation.")}</span></div> : <div className="list">{sessions.map((item) => <div className="list-row" key={item.id}>
        <span className="model-mark">C</span>
        <span><strong>{item.name}</strong><small>{item.model || "-"} · {item.count} {t("messages")} · {item.at.slice(0, 16).replace("T", " ")}</small></span>
        <span className="controls"><button className="btn" onClick={() => { try { const raw = localStorage.getItem("hymnix.chat.saved"); if (!raw) return; const parsed = JSON.parse(raw); if (Array.isArray(parsed?.messages)) { setMessages(parsed.messages as Message[]); setActive("Chat"); } } catch { /* ignore */ } }}>{t("Open")}</button></span>
      </div>)}</div>}
    </section>;
  }

  function renderGateway() {
    return <section className="view-page">
      <div className="view-heading"><div><label>{t("GATEWAY CONNECTION")}</label><h2>{t("Gateway")}</h2><p>{t("Host your hardware for friends, or connect to a friend's host. Both modes live here.")}</p></div><button className="btn" onClick={() => { void loadNetwork(); void loadCloud(); void loadHealth(); }}>{t("Refresh")}</button></div>

      <div className="card">
        <h3 className="card-title">{t("Host a server")}</h3>
        <div className="setting-row"><label>{t("Share name")}</label><div className="controls"><input value={hostName} onChange={(event) => setHostName(event.target.value)} /><button className="btn" onClick={() => void loadNetwork()}>{t("Refresh")}</button></div></div>
        <div className="setting-row"><label>{t("Share password")}<span className="hint">{t("required before the tunnel can start")}</span></label><div className="controls"><input value={hostPassword} onChange={(event) => setHostPassword(event.target.value)} placeholder={t("Set a password")} /><button className="btn" onClick={() => void saveIdentity()}>{t("Save")}</button><button className="btn" onClick={() => { const next = Math.random().toString(36).slice(2, 10); setHostPassword(next); void window.hymnix.network.saveIdentity({ host_password: next }); }}>{t("Generate")}</button><button className="btn" onClick={() => void navigator.clipboard?.writeText(hostPassword)} disabled={!hostPassword}>{t("Copy")}</button></div></div>
        <div className="setting-row"><label>{t("Tunnel state")}</label><div className="controls"><span className="inline-status"><span className="dot" data-state={tunnelState === "up" ? "ready" : tunnelState === "starting" ? "connecting" : tunnelState === "failed" || tunnelState === "lost" ? "error" : "idle"} aria-hidden="true" /><strong>{t({ off: "Not started", starting: "Starting", up: "Ready", lost: "Disconnected", failed: "Failed" }[tunnelState] || "Not started")}</strong></span><button className="btn primary" onClick={() => void toggleTunnel(tunnelState === "up" || tunnelState === "starting" ? "stop" : "start")} disabled={netBusy || !hostPassword.trim()}>{tunnelState === "up" || tunnelState === "starting" ? t("Stop tunnel") : t("Start tunnel")}</button><button className="btn" onClick={() => void toggleTunnel("restart")} disabled={netBusy || !hostPassword.trim()}>{t("Restart")}</button></div></div>
        <div className="setting-row"><label>{t("Public address")}</label><div className="controls"><input readOnly value={tunnelUrl || t("Not started")} /><button className="btn" onClick={() => void navigator.clipboard?.writeText(tunnelUrl)} disabled={!tunnelUrl}>{t("Copy")}</button></div></div>
        <p className="subtitle">{t("Friends connect with this address, name and password. Their chats run on your hardware.")}</p>
      </div>

      <div className="card">
        <h3 className="card-title">{t("Connect to a friend")}</h3>
        <div className="setting-row"><label>{t("Server address")}<span className="hint">{t("host shares this")}</span></label><div className="controls"><input value={serverBase} onChange={(event) => setServerBase(event.target.value)} placeholder="https://xxxx.trycloudflare.com" /></div></div>
        <div className="setting-row"><label>{t("Share name")}<span className="hint">{t("host name")}</span></label><div className="controls"><input value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="Hymnix Orbit" /></div></div>
        <div className="setting-row"><label>{t("Connection password")}<span className="hint">{t("given by the host")}</span></label><div className="controls"><input type="password" value={guestPassword} onChange={(event) => setGuestPassword(event.target.value)} /><button className="btn primary" onClick={() => void guestConnect().then((ok) => { if (ok) { setMode("remote"); void loadHealth(); void loadModels(); } })} disabled={netBusy}>{netBusy ? t("Working...") : t("Connect")}</button></div></div>
        <p className="subtitle">{mode === "remote" ? t("Connected: chats run on the friend's hardware.") : t("Not connected. Chats run locally.")}</p>
      </div>

      <div className="card">
        <h3 className="card-title">{t("Cloud API")}</h3>
        <div className="setting-row"><label>{t("CHAT SOURCE")}</label><div className="controls segmented"><button className={source === "local" ? "active" : ""} onClick={() => setSource("local")}>{t("Local model")}</button><button className={source === "cloud" ? "active" : ""} onClick={() => setSource("cloud")}>{t("Cloud API")}</button></div></div>
        <div className="setting-row"><label>{t("Server address")}</label><div className="controls"><input value={cloudBase} onChange={(event) => setCloudBase(event.target.value)} placeholder="https://api.deepseek.com" /></div></div>
        <div className="setting-row"><label>{t("Model")}</label><div className="controls"><input value={cloudModel} onChange={(event) => setCloudModel(event.target.value)} placeholder="deepseek-chat" /></div></div>
        <div className="setting-row"><label>{t("API key")}</label><div className="controls"><input type="password" value={cloudKey} onChange={(event) => setCloudKey(event.target.value)} placeholder={cloudMasked || t("API key")} /><button className="btn" onClick={() => void saveCloud()}>{t("Save")}</button><button className="btn" onClick={() => void testCloud()}>{t("Test")}</button></div></div>
        {cloudStatus && <p className="subtitle">{cloudStatus}</p>}
      </div>

    </section>;
  }

  function renderChangelog() {
    const entries = [
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
  function renderApprovals() {
    return <section className="view-page">
      <div className="view-heading"><div><label>{t("APPROVALS")}</label><h2>{t("Approvals")}</h2><p>{t("Review and resolve pending permission requests.")}</p></div><button className="btn primary" onClick={() => void refreshApprovals()} disabled={approvalsBusy}>{approvalsBusy ? t("Loading...") : t("Refresh")}</button></div>
      {approvalsError && <div className="error">{approvalsError}</div>}
      {approvals.length === 0 ? <div className="card empty-state"><strong>{t("No pending approvals")}</strong><span>{t("Approved and denied actions are recorded by the gateway.")}</span></div> : <div className="list">{approvals.map((approval) => <article className="list-row" key={approval.id}><span className="model-mark">!</span><span><strong>{approval.tool}</strong><small>{t("Risk")}: {approval.risk} · {approval.reasons.join("; ") || t("No reasons provided")}</small><pre>{JSON.stringify(approval.argsRedacted, null, 2)}</pre><small>{approval.createdAt} - {approval.expiresAt}</small><span className="controls"><button className="btn primary" onClick={() => void decideApproval(approval.id, "approve")} disabled={approvalsBusy}>{t("Approve")}</button><button className="btn" onClick={() => void decideApproval(approval.id, "deny")} disabled={approvalsBusy}>{t("Deny")}</button></span></span></article>)}</div>}
    </section>;
  }
  function renderMonitor() {
    return <section className="view-page">
      <div className="view-heading"><div><label>{t("GATEWAY MONITOR")}</label><h2>{t("Monitor")}</h2><p>{t("Review gateway health, usage and active operations.")}</p></div><button className="btn" onClick={() => { void loadHealth(); void loadStatus(); void pollTunnel(); }}>{t("Refresh")}</button></div>
      <div className="card">
        <div className="panel-row"><span>{t("Status")}</span><strong>{t(state)}</strong></div>
        <div className="panel-row"><span>{t("Version")}</span><strong>{health?.gateway || "-"}</strong></div>
        <div className="panel-row"><span>{t("Gateway address")}</span><strong className="small">{gatewayBase.replace("http://", "")}</strong></div>
        <div className="panel-row"><span>{t("Model service")}</span><strong>{health?.ollama ? t("Online") : t("Offline")}</strong></div>
        <div className="panel-row"><span>{t("Models")}</span><strong>{health?.models ?? models.length}</strong></div>
        <div className="panel-row"><span>{t("Clients online")}</span><strong>{health?.clients_online ?? "-"}</strong></div>
        <div className="panel-row"><span>{t("Uptime")}</span><strong>{health?.uptime_s ? health.uptime_s + "s" : "-"}</strong></div>
        <div className="panel-row"><span>{t("Tunnel")}</span><strong>{t({ off: "Not started", starting: "Starting", up: "Ready", lost: "Disconnected", failed: "Failed" }[tunnelState] || "Not started")}</strong></div>
        <div className="panel-row"><span>{t("Public address")}</span><strong className="small">{tunnelUrl || "-"}</strong></div>
      </div>
      <div className="card"><div className="setting-row"><label>{t("Admin key")}</label><div className="controls"><input type="password" value={adminKey} onChange={(event) => setAdminKey(event.target.value)} /><button className="btn" onClick={() => void loadStatus()}>{t("Load")}</button></div></div>{statusError && <p className="error">{statusError}</p>}{statusData && <p className="subtitle">{JSON.stringify(statusData).slice(0, 300)}</p>}</div>
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
    try { localStorage.setItem("hymnix.welcome", "1"); } catch { /* ignore */ }
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
    const finish = async () => { if (role === "guest") { const ok = await guestConnect(); if (!ok) return; window.setTimeout(() => { void loadHealth(); void loadModels(); }, 80); } finishWelcome(); };
    return <div className="welcome-mask" role="dialog" aria-modal="true" aria-label={t("Welcome")}>
      <div className="welcome-card">
        <div className="welcome-brand"><img src={brandIcon} alt="" /><div><strong>Hymnix Orbit</strong><small>1.3.0</small></div></div>
        <h2>{t("Welcome to Hymnix Orbit")}</h2>
        <p>{t("Share this machine's models with friends, or connect to a friend's machine.")}</p>
        <div className="setting-row"><label>{t("Language")}</label><div className="controls segmented"><button className={lang === "en" ? "active" : ""} onClick={() => changeLang("en")}>English</button><button className={lang === "zh" ? "active" : ""} onClick={() => changeLang("zh")}>中文</button></div></div>
        <div className="setting-row"><label>{t("This device")}</label><div className="controls segmented"><button className={role === "host" ? "active" : ""} onClick={() => setRole("host")}>{t("Host a server")}</button><button className={role === "guest" ? "active" : ""} onClick={() => setRole("guest")}>{t("Connect to a friend")}</button></div></div>
        {role === "host" ? <div className="card" style={{ margin: "0 0 12px" }}>
          <div className="setting-row"><label>{t("Share name")}</label><div className="controls"><input value={hostName} onChange={(event) => setHostName(event.target.value)} placeholder="Hymnix Orbit" /><button className="btn" onClick={() => void loadNetwork()}>{t("Refresh")}</button></div></div>
          <div className="setting-row"><label>{t("Share password")}<span className="hint">{t("required before the tunnel can start")}</span></label><div className="controls"><input value={hostPassword} onChange={(event) => setHostPassword(event.target.value)} placeholder={t("Set a password")} /><button className="btn" onClick={() => void saveIdentity()}>{t("Save")}</button><button className="btn" onClick={() => { const next = Math.random().toString(36).slice(2, 10); setHostPassword(next); void window.hymnix.network.saveIdentity({ host_password: next }); }}>{t("Generate")}</button><button className="btn" onClick={() => void navigator.clipboard?.writeText(hostPassword)} disabled={!hostPassword}>{t("Copy")}</button></div></div>
          <div className="setting-row"><label>{t("Tunnel state")}</label><div className="controls"><span className="inline-status"><span className="dot" data-state={tunnelState === "up" ? "ready" : tunnelState === "starting" ? "connecting" : tunnelState === "failed" || tunnelState === "lost" ? "error" : "idle"} aria-hidden="true" /><strong>{t({ off: "Not started", starting: "Starting", up: "Ready", lost: "Disconnected", failed: "Failed" }[tunnelState] || "Not started")}</strong></span><button className="btn primary" onClick={() => void toggleTunnel(tunnelState === "up" || tunnelState === "starting" ? "stop" : "start")} disabled={netBusy || !hostPassword.trim()}>{tunnelState === "up" || tunnelState === "starting" ? t("Stop tunnel") : t("Start tunnel")}</button><button className="btn" onClick={() => void toggleTunnel("restart")} disabled={netBusy || !hostPassword.trim()}>{t("Restart")}</button></div></div>
        <div className="setting-row"><label>{t("Public address")}</label><div className="controls"><input readOnly value={tunnelUrl || t("Not started")} /><button className="btn" onClick={() => void navigator.clipboard?.writeText(tunnelUrl)} disabled={!tunnelUrl}>{t("Copy")}</button></div></div>
          <p className="subtitle">{t("Friends connect with this address, name and password. Their chats run on your hardware.")}</p>
        </div> : <div className="card" style={{ margin: "0 0 12px" }}>
          <div className="setting-row"><label>{t("Server address")}<span className="hint">{t("host shares this")}</span></label><div className="controls"><input value={serverBase} onChange={(event) => setServerBase(event.target.value)} placeholder="https://xxxx.trycloudflare.com" /></div></div>
          <div className="setting-row"><label>{t("Share name")}<span className="hint">{t("host name")}</span></label><div className="controls"><input value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="Hymnix Orbit" /></div></div>
          <div className="setting-row"><label>{t("Connection password")}<span className="hint">{t("given by the host")}</span></label><div className="controls"><input type="password" value={guestPassword} onChange={(event) => setGuestPassword(event.target.value)} /></div></div>
          <p className="subtitle">{t("Your chats will run on the friend's hardware.")}</p>
        </div>}
        {netError && <p className="error">{netError}</p>}
        <div className="welcome-actions"><button className="btn primary" onClick={() => void finish()} disabled={netBusy}>{netBusy ? t("Working...") : role === "guest" ? t("Connect") : t("Start using Hymnix Orbit")}</button></div>
      </div>
    </div>;
  }
  async function setSetting(key: keyof typeof DEFAULT_UI_SETTINGS, value: unknown) {
    setUiSettings((current) => ({ ...current, [key]: value }) as typeof current);
    try { const saved = await window.hymnix.settings.set({ [key]: value }); setUiSettings({ ...DEFAULT_UI_SETTINGS, ...saved }); }
    catch (reason) { setStartupNote(reason instanceof Error ? reason.message : String(reason)); }
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
    try {
      const result: any = await window.hymnix.cloud.test();
      setCloudStatus(result?.ok ? t("Cloud reachable, models:") + " " + (result?.count ?? 0) : String(result?.error || "failed"));
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
  function renderSettings() {
    const sw = (key: keyof typeof DEFAULT_UI_SETTINGS, label: string, hint: string, disabled = false) => <div className={disabled ? "setting-row disabled" : "setting-row"} aria-disabled={disabled}>
      <label>{t(label)}<span className="hint">{t(hint)}</span></label>
      <div className="controls"><button type="button" className={"switch" + (uiSettings[key] ? " on" : "")} aria-pressed={!!uiSettings[key]} aria-label={t(label)} disabled={disabled} onClick={() => void setSetting(key, !uiSettings[key])}><span /></button></div>
    </div>;
    return <section className="view-page">
      <div className="view-heading"><div><label>{t("APPLICATION")}</label><h2>{t("Settings")}</h2><p>{t("Workspace and connection preferences.")}</p></div></div>
      <div className="card">
        <h3 className="card-title">{t("General")}</h3>
        <div className="setting-row"><label>{t("Language")}<span className="hint">English / 中文</span></label><div className="controls segmented"><button className={lang === "en" ? "active" : ""} onClick={() => changeLang("en")}>English</button><button className={lang === "zh" ? "active" : ""} onClick={() => changeLang("zh")}>中文</button></div></div>
        <div className="setting-row"><label>{t("Theme")}<span className="hint">5 presets</span></label><div className="controls"><select className="btn" value={theme} onChange={(event) => changeTheme(event.target.value)}>{[["camellia-white", t("Camellia white")], ["daylight", t("Daylight")], ["cyan-dark", t("Cyan dark")], ["orange-dark", t("Orange dark")], ["rog-red-black", t("ROG red black")]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div>
        <div className="setting-row"><label>{t("Workspace")}</label><div className="controls"><input value={workspace} onChange={(event) => setWorkspace(event.target.value)} aria-label={t("Workspace name")} /></div></div>
      </div>
      <div className="card">
        <h3 className="card-title">{t("Startup and runtime")}</h3>
        {sw("betaChannel", "Join client beta", "Pre-release builds, may be unstable")}
        {sw("runAtStartup", "Run at system startup", "Start minimized in the tray")}
        {sw("startFullscreen", "Start in fullscreen", "Open the window fullscreen")}
        {sw("dpiScaling", "Scale text and icons for this display (Beta)", "Uses display scale factor")}
        {sw("smoothScroll", "Enable smooth scrolling", "Animated scroll in long pages")}
        {sw("gpuAcceleration", "Enable GPU accelerated rendering", "Disable only if you see flicker")}
        {sw("autoUpdate", "Update automatically when a new version is available", "Managed by the installer", true)}
        <p className="subtitle">{t("GPU acceleration and the cache folder take effect after a restart.")}</p>
      </div>
      <div className="card">
        <h3 className="card-title">{t("Cache and preview")}</h3>
        <div className="setting-row"><label>{t("Cache storage location")}</label><div className="controls"><input readOnly value={uiSettings.cacheDir || t("Default location")} /><button className="btn" onClick={() => void chooseCacheDir()}>{t("Choose folder")}</button><button className="btn" onClick={() => void setSetting("cacheDir", "")}>{t("Reset")}</button></div></div>
        <div className="setting-row"><label>{t("How to open previews")}</label><div className="controls segmented"><button className={uiSettings.previewMode === "inapp" ? "active" : ""} onClick={() => void setSetting("previewMode", "inapp")}>{t("In-app preview")}</button><button className={uiSettings.previewMode === "browser" ? "active" : ""} onClick={() => void setSetting("previewMode", "browser")}>{t("Default browser")}</button></div></div>
      </div>
      <div className="card">
        <h3 className="card-title">{t("About")}</h3>
        <div className="setting-row"><label>{t("Data folder")}</label><div className="controls"><input readOnly value={filesRoot || "%LOCALAPPDATA%\\Hymnix"} /><button className="btn" onClick={() => void chooseWorkspace()}>{t("Choose workspace")}</button></div></div>
        <div className="setting-row"><label>{t("Updates")}</label><div className="controls"><button className="btn" onClick={() => setStartupNote(t("You are running Hymnix Orbit 1.3.0."))}>{t("Check for updates")}</button></div></div>
        <div className="setting-row"><label>{t("Version")}</label><div className="controls"><span className="hint">Hymnix Orbit 1.3.0 · Hymnix Studio</span><button className="btn" onClick={() => setActive("Support")}>{t("Help & sponsor")}</button></div></div>
      </div>
      <StarBanner />
    </section>;
  }
  function renderView() {
    if (active === "Chat") return renderChat();
    if (active === "Models") return renderModels();
    if (active === "Tools") return renderTools();
    if (active === "Approvals") return renderApprovals();
    if (active === "Terminal") return renderTerminal();
    if (active === "History") return renderHistory();
    if (active === "Gateway") return renderGateway();
    if (active === "Monitor") return renderMonitor();
    if (active === "Changelog") return renderChangelog();
    if (active === "Settings") return renderSettings();
    if (active === "Support") return renderSupport();
    return <section className="view-page"><div className="view-heading"><div><label>{t("GATEWAY CAPABILITY")}</label><h2>{t(active)}</h2><p>{t(capabilityCopy[active] || "")}</p></div></div><div className="card empty-state"><strong>{t(active)}</strong><span>{t("This capability is not wired to a real workflow yet.")}</span></div></section>;
  }

  const terminalView = active === "Terminal";
  const chatView = active === "Chat";
  return <div className={(terminalView ? "shell terminal-mode" : chatView ? "shell chat-mode" : "shell plain-mode") + (previewOpen ? " preview-open" : "")} data-lang={lang}>
    <div className="titlebar">
      <span className="titlebar-brand"><img src={brandIcon} alt="" /><strong>Hymnix Orbit</strong><small>1.3.0</small></span>
      <span className="titlebar-drag" />
      <div className="titlebar-actions">
        {previewOpen && <button type="button" className="preview-close" onClick={() => void closePreview()}>{t("Close preview")}</button>}
        <button type="button" onClick={() => void window.hymnix.window.control("minimize")} aria-label={t("Minimize")}>–</button>
        <button type="button" onClick={() => void window.hymnix.window.control("maximize")} aria-label={t("Maximize")}>▢</button>
        <button type="button" className="close" onClick={() => void window.hymnix.window.control("close")} aria-label={t("Close")}>✕</button>
      </div>
    </div>
    <aside className="side">
      <div className="brand"><img src={brandIcon} alt="" /><span>Hymnix Orbit<small>ORBIT · 1.3.0</small></span></div>
      <button className="new" onClick={() => { setActive("Chat"); setMessages([]); setSessionName("Untitled session"); }}>{t("+ New session")}</button>
      <div className="side-section"><span className="side-label">{t("WORKSPACE")}</span><button className="workspace active" onClick={() => setWorkspace("Default workspace")}><span className="dot" />{t(workspace)}</button></div>
      <div className="side-section"><span className="side-label">{t("RECENT SESSIONS")}</span>
        {sessions.length === 0 ? <span className="side-empty">{t("No sessions yet")}</span> : <div className="session-list">{sessions.map((item) => <button className="session-item" key={item.id} onClick={() => { try { const raw = localStorage.getItem("hymnix.chat.saved"); if (!raw) return; const parsed = JSON.parse(raw); if (Array.isArray(parsed?.messages)) { setMessages(parsed.messages as Message[]); setActive("Chat"); } } catch { /* ignore */ } }}><Icon name="Chat" /><span><strong>{item.name}</strong><small>{item.count} {t("messages")}</small></span></button>)}</div>}
      </div>
      {navGroups.map((group) => <nav className="nav-group" aria-label="Workspace navigation" data-group={group.title} key={group.title}><span className="side-label">{t(group.title)}</span>{group.items.map((item) => <button className={active === item ? "nav active" : "nav"} key={item} onClick={() => setActive(item)} aria-current={active === item ? "page" : undefined}><Icon name={item} />{t(item)}</button>)}</nav>)}
      <button className="account" onClick={() => setWelcomeOpen(true)}>
        <span className="avatar">{mode === "remote" ? "R" : "L"}</span>
        <span><strong>{t("Connection")}</strong><small>{mode === "local" ? t("Local mode") : t("Friend's server")}</small></span>
      </button>
      <div className="side-status"><span className="dot" data-state={state} aria-hidden="true" />{t(state)}</div>
    </aside>
    <main className={terminalView ? "main terminal-main" : "main"}>
      {!terminalView && <header>
        <div><label>{t(workspace)} / {t(active)}</label><h1>{t(active)}</h1><p className="subtitle">{t("A focused server workspace for building with Hymnix")}</p></div>
        {(active === "Chat" || active === "Gateway") && <div className="connbar">
          <span className={"conn-chip " + state}><span className="dot" data-state={state} aria-hidden="true" />{t(state)}</span>
          <span className="conn-chip">{t("Gateway")} <b>{health?.gateway || "-"}</b></span>
          <span className={"conn-chip " + (tunnelState === "up" ? "ready" : "")}>{t("Tunnel")} <b>{t({ off: "Not started", starting: "Starting", up: "Ready", lost: "Disconnected", failed: "Failed" }[tunnelState] || "Not started")}</b></span>
          <span className="conn-chip">{t("Models")} <b>{models.length}</b></span>
          <button className="btn" onClick={() => void toggleTunnel(tunnelState === "up" || tunnelState === "starting" ? "stop" : "start")}>{tunnelState === "up" || tunnelState === "starting" ? t("Stop tunnel") : t("Start tunnel")}</button>
          <button className="btn" onClick={() => { void navigator.clipboard?.writeText(tunnelUrl || "http://127.0.0.1:11435"); }} disabled={!tunnelUrl}>{t("Copy address")}</button>
          <button className="btn" onClick={() => setActive("Monitor")}>{t("Open monitor")}</button>
        </div>}
      </header>}
      {renderView()}
      {startupNote && !terminalView && <div className="notice" role="status">{startupNote}</div>}
      {error && !terminalView && <div className="error" role="alert">{error}</div>}
    </main>
    {!terminalView && chatView && <aside className="inspect">
      <label>{t("CHAT SOURCE")}</label>
      <div className="panel-card">
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
      </div>
      <label>{t("MODEL")}</label>
      <div className="panel-card">
        <select className="panel-select" value={model} onChange={(event) => setModel(event.target.value)}>
          {models.length === 0 && <option value="">{t("No model list loaded")}</option>}
          {models.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
        </select>
        <div className="panel-actions">
          <button className="btn" onClick={() => void modelAction("start", model)} disabled={!model}>{t("Load")}</button>
          <button className="btn" onClick={() => void modelAction("stop", model)} disabled={!model}>{t("Unload")}</button>
          <button className="btn" onClick={() => void loadModels()}>{t("Refresh")}</button>
          <button className="btn" onClick={() => void toggleTunnel(tunnelState === "up" || tunnelState === "starting" ? "stop" : "start")}>{tunnelState === "up" || tunnelState === "starting" ? t("Stop tunnel") : t("Share this host")}</button>
        </div>
        <div className="panel-pull">
          <input value={pullName} onChange={(event) => setPullName(event.target.value)} placeholder="qwen3:8b" />
          <button className="btn primary" onClick={() => void pullModel()} disabled={!pullName.trim() || !!modelBusy}>{t("Pull")}</button>
        </div>
        {modelNote && <p className="panel-note">{modelNote}</p>}
      </div>
      <label>{t("REASONING EFFORT")}</label>
      <div className="panel-card">
        <div className="segmented">
          {[["low", t("Low")], ["medium", t("Medium")], ["high", t("High")]].map(([value, label]) => <button key={value} className={effort === value ? "active" : ""} onClick={() => setEffort(value)}>{label}</button>)}
        </div>
        <p className="panel-note">{t("Higher effort uses more tokens per reply.")}</p>
      </div>
      <label>{t("CONVERSATION")}</label>
      <div className="panel-card">
        <div className="panel-actions">
          <button className="btn" onClick={saveChat}>{t("Save")}</button>
          <button className="btn" onClick={loadChat}>{t("Load")}</button>
          <button className="btn" onClick={exportChat}>{t("Export")}</button>
          <button className="btn" onClick={() => setMessages([])}>{t("Clear")}</button>
        </div>
      </div>
      <label>{t("TELEMETRY")}</label>
      <div className="panel-card">
        <div className="panel-row"><span>GPU</span><strong>{stats?.gpu != null ? stats.gpu + "%" : "-"}</strong></div>
        <div className="panel-row"><span>VRAM</span><strong>{stats?.vramUsed != null && stats?.vramTotal != null ? stats.vramUsed + "/" + stats.vramTotal + "G" : "-"}</strong></div>
        <div className="panel-row"><span>AI</span><strong>{stats?.ai != null ? stats.ai + "%" : "-"}</strong></div>
        <div className="panel-row"><span>RAM</span><strong>{(stats ? (stats.ramUsed / 1024).toFixed(1) : "-") + "/" + (stats ? (stats.ramTotal / 1024).toFixed(1) : "-")}G</strong></div>
      </div>
    </aside>}
    {welcomeOpen && renderWelcome()}
  </div>;
}

createRoot(document.getElementById("root")!).render(<App />);