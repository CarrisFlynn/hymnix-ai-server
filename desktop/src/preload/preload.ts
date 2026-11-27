import { contextBridge, ipcRenderer } from "electron";
import type { AutomationTask, NetworkApi, AdminClientsResponse, AdminErrorRecord, AdminHistoryQuery, AdminHistoryResponse, AdminStatus, ChatDelta, DesktopApi, FileReadRequest, FileReadResponse, FileSearchRequest, FileStatResponse, FileSearchResponse, FileTreeRequest, FileTreeResponse, JobView, LocalModel, ProvidersResponse, StreamChatInput, TerminalCommandRequest, TerminalCommandResult, TerminalCompletion, TerminalOutputEvent, ToolCallRequest, ToolCallResponse, ToolsResponse, ApprovalListResponse, ApprovalDecisionResponse, WorkspaceRoot } from "../shared/protocol";

// Main owns AbortController, api/tags, v1/chat/completions, and Authorization handling; preload only forwards typed IPC events.
const channels = { toolsList: "tools:list", toolsCall: "tools:call", toolsPending: "tools:pending", toolsApprove: "tools:approve", toolsDeny: "tools:deny", health: "gateway:health", models: "gateway:models", stream: "gateway:stream", cancel: "gateway:cancel", delta: "gateway:delta", complete: "gateway:complete", adminHistory: "gateway:admin-history", adminStatus: "gateway:admin-status", adminErrors: "gateway:admin-errors", adminClients: "gateway:admin-clients" } as const;
const api: DesktopApi & { adminHistory: (adminKey: string, query?: AdminHistoryQuery) => Promise<AdminHistoryResponse>; gateway: DesktopApi["gateway"] & { adminErrors: (adminKey: string, limit?: number) => Promise<AdminErrorRecord[]>; adminClients: (adminKey: string) => Promise<AdminClientsResponse> } } = {
  adminHistory: (adminKey, query) => ipcRenderer.invoke(channels.adminHistory, adminKey, query),
  workspace: {
    choose: (): Promise<WorkspaceRoot | null> => ipcRenderer.invoke("files:choose-root"),
    current: (): Promise<WorkspaceRoot | null> => ipcRenderer.invoke("files:current"),
    chooseCacheDir: (): Promise<{ selected: boolean; path: string }> => ipcRenderer.invoke("files:choose-cache-dir"),
  },
  window: {
    control: (action: "minimize" | "maximize" | "close" | "hide" | "restart") => ipcRenderer.invoke("window:control", action),
    setAppearance: (mode: "light" | "dark" | "auto", backgroundColor: string) => ipcRenderer.invoke("window:appearance", { mode, backgroundColor }),
  },
  github: { stars: () => ipcRenderer.invoke("github:stars") },
  changelog: { get: (lang?: "zh" | "en"): Promise<{ ok: boolean; text: string }> => ipcRenderer.invoke("changelog:get", lang) },
  updates: { check: () => ipcRenderer.invoke("update:check") },
  bootstrap: () => ipcRenderer.invoke("app:bootstrap"),
  log: (message: string) => ipcRenderer.invoke("app:log", message),
  restartGateway: () => ipcRenderer.invoke("gateway:restart"),
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (patch: Record<string, unknown>) => ipcRenderer.invoke("settings:set", patch),
  },
  preview: {
    open: (target: string) => ipcRenderer.invoke("preview:open", { target }),
    close: () => ipcRenderer.invoke("preview:close"),
    resize: () => ipcRenderer.invoke("preview:resize"),
  },
  ollama: { control: (action: "start" | "stop" | "status") => ipcRenderer.invoke("ollama:control", action) },
  config: {
    get: () => ipcRenderer.invoke("config:get"),
    set: (values: Record<string, unknown>) => ipcRenderer.invoke("config:set", values),
  },
  providers: {
    list: (): Promise<ProvidersResponse> => ipcRenderer.invoke("providers:list"),
    save: (payload: Record<string, unknown>): Promise<ProvidersResponse> => ipcRenderer.invoke("providers:save", payload),
  },
  cloud: {
    get: () => ipcRenderer.invoke("cloud:get"),
    save: (payload: Record<string, unknown>) => ipcRenderer.invoke("cloud:save", payload),
    test: () => ipcRenderer.invoke("cloud:test"),
  },
  provider: {
    probe: (config) => ipcRenderer.invoke("provider:probe", config),
    models: (config) => ipcRenderer.invoke("provider:models", config),
  },
  system: {
    stats: () => ipcRenderer.invoke("system:stats"),
    openExternal: (url: string) => ipcRenderer.invoke("shell:open", url),
    disk: (target: string) => ipcRenderer.invoke("system:disk", target),
    notify: (input: { title: string; body: string }) => ipcRenderer.invoke("system:notify", input),
    paths: () => ipcRenderer.invoke("system:paths"),
    reveal: (target: string) => ipcRenderer.invoke("shell:reveal", target),
  },
  credentials: {
    get: (key: string) => ipcRenderer.invoke("credentials:get", key),
    set: (key: string, value: string) => ipcRenderer.invoke("credentials:set", key, value),
    remove: (key: string) => ipcRenderer.invoke("credentials:remove", key),
  },
  network: {
    connect: (baseUrl: string, name: string, password: string) => ipcRenderer.invoke("network:connect", { baseUrl, name, password }),
    info: () => ipcRenderer.invoke("network:info"),
    tunnel: (action: "start" | "stop" | "restart") => ipcRenderer.invoke("network:tunnel", action),
    tunnelStatus: () => ipcRenderer.invoke("network:tunnelStatus"),
    saveIdentity: (payload: Record<string, unknown>) => ipcRenderer.invoke("network:save", payload),
    get: (baseUrl: string, path: string, token?: string) => ipcRenderer.invoke("network:get", { baseUrl, path, token }),
    clients: () => ipcRenderer.invoke("network:clients"),
    disconnect: (ip: string) => ipcRenderer.invoke("network:disconnect", ip),
  } as NetworkApi,
  models: {
    async pullStream({ requestId, model, onProgress }) {
      const listener = (_event: Electron.IpcRendererEvent, id: string, progress: import("../shared/protocol").PullProgress) => {
        if (id === requestId) onProgress(progress);
      };
      ipcRenderer.on("models:pull-progress", listener);
      try { return await ipcRenderer.invoke("models:pull-stream", { requestId, model }); }
      finally { ipcRenderer.removeListener("models:pull-progress", listener); }
    },
    cancelPull: (requestId) => { ipcRenderer.send("models:pull-cancel", requestId); },
    list: (): Promise<{ models: LocalModel[] }> => ipcRenderer.invoke("models:list"),
    pull: (model: string) => ipcRenderer.invoke("models:pull", model),
    remove: (model: string) => ipcRenderer.invoke("models:delete", model),
    start: (model: string) => ipcRenderer.invoke("models:start", model),
    stop: (model: string) => ipcRenderer.invoke("models:stop", model),
  },
  terminal: {
    bridge: (command) => ipcRenderer.invoke("terminal:bridge", command),
    start: (request: TerminalCommandRequest): Promise<TerminalCommandResult> => ipcRenderer.invoke("terminal:start", request),
    cancel: (id: string) => { ipcRenderer.send("terminal:cancel", id); },
    // Detaching a view is not cancelling the process; the old send killed it.
    unsubscribe: (id: string) => { ipcRenderer.send("terminal:unsubscribe", id); },
    onOutput: (listener: (event: TerminalOutputEvent) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, payload: TerminalOutputEvent) => listener(payload);
      ipcRenderer.on("terminal:output", handler);
      return () => { ipcRenderer.removeListener("terminal:output", handler); };
    },
    onComplete: (listener: (event: TerminalCompletion) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, payload: TerminalCompletion) => listener(payload);
      ipcRenderer.on("terminal:complete", handler);
      return () => { ipcRenderer.removeListener("terminal:complete", handler); };
    },
  },
  tools: {
    list: (apiKey?: string): Promise<ToolsResponse> => ipcRenderer.invoke(channels.toolsList, apiKey),
    call: (request: ToolCallRequest): Promise<ToolCallResponse> => ipcRenderer.invoke(channels.toolsCall, request),
    pending: (): Promise<ApprovalListResponse> => ipcRenderer.invoke(channels.toolsPending),
    approve: (id: string): Promise<ApprovalDecisionResponse> => ipcRenderer.invoke(channels.toolsApprove, id),
    deny: (id: string): Promise<ApprovalDecisionResponse> => ipcRenderer.invoke(channels.toolsDeny, id),
  },
  plugins: {
    list: () => ipcRenderer.invoke("plugins:list"),
    install: () => ipcRenderer.invoke("plugins:install"),
    action: (request) => ipcRenderer.invoke("plugins:action", request),
  },
  files: {
    image: (path: string): Promise<{ ok: boolean; mime?: string; data?: string; bytes?: number; path?: string; error?: string }> => ipcRenderer.invoke("files:image", { path }),
    stat: (path: string): Promise<FileStatResponse> => ipcRenderer.invoke("files:stat", { path }),
    tree: (request: FileTreeRequest): Promise<FileTreeResponse> => ipcRenderer.invoke("files:tree", request),
    search: (request: FileSearchRequest): Promise<FileSearchResponse> => ipcRenderer.invoke("files:search", request),
    read: (request: FileReadRequest): Promise<FileReadResponse> => ipcRenderer.invoke("files:read", request),
  },
  lsp: {
    query: (input: { operation: "definition" | "references" | "symbols"; file: string; line?: number; character?: number }) => ipcRenderer.invoke("lsp:query", input),
  },
  code: {
    outline: (path: string) => ipcRenderer.invoke("code:outline", { path }),
    definition: (symbol: string) => ipcRenderer.invoke("code:definition", { symbol }),
    references: (symbol: string) => ipcRenderer.invoke("code:references", { symbol }),
  },
  skills: {
    list: () => ipcRenderer.invoke("skills:list"),
    read: (id: string) => ipcRenderer.invoke("skills:read", id),
  },
  automation: {
    list: () => ipcRenderer.invoke("automation:list"),
    create: (input) => ipcRenderer.invoke("automation:create", input),
    update: (id, patch) => ipcRenderer.invoke("automation:update", id, patch),
    remove: (id) => ipcRenderer.invoke("automation:remove", id),
    runNow: (id) => ipcRenderer.invoke("automation:run-now", id),
    onFire: (listener: (task: AutomationTask) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, task: AutomationTask) => listener(task);
      ipcRenderer.on("automation:fire", handler);
      return () => { ipcRenderer.removeListener("automation:fire", handler); };
    },
    onUpdate: (listener: (task: AutomationTask) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, task: AutomationTask) => listener(task);
      ipcRenderer.on("automation:update", handler);
      return () => { ipcRenderer.removeListener("automation:update", handler); };
    },
  },
  worktree: {
    list: () => ipcRenderer.invoke("worktree:list"),
    create: (input: { name?: string; from?: string }) => ipcRenderer.invoke("worktree:create", input),
    remove: (input: { path: string }) => ipcRenderer.invoke("worktree:remove", input),
  },
  web: {
    search: (input) => ipcRenderer.invoke("web:search", input),
  },
  jobs: {
    list: (): Promise<{ ok: boolean; jobs: JobView[] }> => ipcRenderer.invoke("jobs:list"),
    start: (request) => ipcRenderer.invoke("jobs:start", request),
    stop: (id: string): Promise<{ ok: boolean; id: string }> => ipcRenderer.invoke("jobs:stop", id),
    read: (id: string): Promise<{ ok: boolean; job?: JobView }> => ipcRenderer.invoke("jobs:read", id),
    clear: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("jobs:clear"),
    onUpdate: (listener: (job: JobView) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, job: JobView) => listener(job);
      ipcRenderer.on("jobs:update", handler);
      return () => { ipcRenderer.removeListener("jobs:update", handler); };
    },
    onData: (listener: (event: { id: string; stream: string; text: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, payload: { id: string; stream: string; text: string }) => listener(payload);
      ipcRenderer.on("jobs:data", handler);
      return () => { ipcRenderer.removeListener("jobs:data", handler); };
    },
  },
  gateway: {
    adminStatus: (adminKey: string): Promise<AdminStatus> => ipcRenderer.invoke(channels.adminStatus, adminKey),
    adminErrors: (adminKey: string, limit?: number): Promise<AdminErrorRecord[]> => ipcRenderer.invoke(channels.adminErrors, adminKey, limit),
    adminClients: (adminKey: string): Promise<AdminClientsResponse> => ipcRenderer.invoke(channels.adminClients, adminKey),
  health: () => ipcRenderer.invoke(channels.health),
  models: (apiKey) => ipcRenderer.invoke(channels.models, apiKey),
  cancelChat: (requestId) => { ipcRenderer.send(channels.cancel, requestId); },
  streamChat(input: StreamChatInput) {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => { if (settled) return; settled = true; ipcRenderer.removeListener(channels.delta, onDelta); ipcRenderer.removeListener(channels.complete, onComplete); if (error) reject(error); else resolve(); };
      const onDelta = (_event: Electron.IpcRendererEvent, message: { requestId: string; delta: ChatDelta }) => { if (message.requestId === input.requestId) input.onDelta(message.delta); };
      const onComplete = (_event: Electron.IpcRendererEvent, message: { requestId: string; error?: {status?: number; code?: string; message: string} }) => { if (message.requestId === input.requestId) { if (message.error) { const error = new Error(message.error.message) as Error & {status?: number; code?: string}; error.status = message.error.status; error.code = message.error.code; finish(error); } else finish(); } };
      ipcRenderer.on(channels.delta, onDelta); ipcRenderer.on(channels.complete, onComplete);
      ipcRenderer.invoke(channels.stream, { requestId: input.requestId, baseUrl: input.baseUrl, apiKey: input.apiKey, model: input.model, messages: input.messages, kind: input.kind, agentId: input.agentId, maxTokens: input.maxTokens, reasoningEffort: input.reasoningEffort, tools: input.tools }).catch((reason: unknown) => finish(reason instanceof Error ? reason : new Error(String(reason))));
    });
  },
  complete: (input: unknown): Promise<{ ok: boolean; text?: string; error?: string }> => ipcRenderer.invoke("gateway:complete", input),
  completeCancel: (requestId: string): void => { ipcRenderer.send("gateway:complete-cancel", requestId); },
} };
contextBridge.exposeInMainWorld("hymnix", api);