export const PROTOCOL_VERSION = 1 as const;

export type GatewayHealth = {
  ok?: boolean;
  gateway?: string;
  tunnel?: string;
  ollama?: boolean;
  models?: number;
  uptime_s?: number;
  clients_online?: number;
};

export type GatewayModel = {
  name?: string;
  model?: string;
};

export type GatewayModelsResponse = {
  models?: GatewayModel[];
};

export type AdminModel = { name: string; size: number; loaded: boolean };
export type AdminModelsResponse = { models: AdminModel[] };
export type AdminModelActionResponse = { ok: boolean; model: string; status?: string; result?: unknown };

export type GatewayMessageRole = "system" | "user" | "assistant" | "tool";

export type GatewayToolCall = {
  id: string;
  type?: string;
  function: { name: string; arguments: string };
};

export type GatewayMessage = {
  role: GatewayMessageRole;
  content: string;
  /** assistant turns: the calls the model asked for. */
  tool_calls?: GatewayToolCall[];
  /** tool turns: which call this answers. */
  tool_call_id?: string;
  /** tool turns: the tool name, for dialects that match by name. */
  name?: string;
};

export type GatewayError = {
  status?: number;
  code?: string;
  message?: string;
};

export type GatewayRequestError = GatewayError & {
  requestId?: string;
};

export type ChatToolCallDelta = {
  index?: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

export type ChatUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
    audio_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
    audio_tokens?: number;
    accepted_prediction_tokens?: number;
    rejected_prediction_tokens?: number;
  };
};

export type ChatDelta = {
  id?: string;
  model?: string;
  choices?: Array<{
    delta?: {
      role?: GatewayMessageRole;
      content?: string | null;
      /** Reasoning traces: DeepSeek spells it `reasoning_content`, others `reasoning`. */
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: ChatToolCallDelta[];
    };
    finish_reason?: string | null;
  }>;
  usage?: ChatUsage;
  error?: Pick<GatewayError, "message" | "code">;
};

export type AdminHistoryQuery = {
  limit?: number;
  days?: number;
};

export type AdminHistoryRecord = {
  t?: string;
  ip?: string;
  ua?: string;
  model?: string;
  model_requested?: string;
  provider?: string;
  path?: string;
  stream?: boolean;
  profile?: string;
  compat?: boolean;
  injected_notes?: string[];
  tools?: string[];
  tools_chars?: number;
  num_ctx?: number;
  options?: Record<string, unknown>;
  messages?: GatewayMessage[];
  message_count?: number;
  thinking?: string;
  reply?: string;
  prompt_tokens?: number;
  reply_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  elapsed_ms?: number;
  estimated?: boolean;
  status?: number;
  success?: boolean;
  error?: string;
};

export type AdminHistoryResponse = {
  count?: number;
  items?: AdminHistoryRecord[];
};

export type AdminStatusGateway = {
  version?: string;
  started?: string;
  uptime_s?: number;
  listen?: string;
};

export type AdminStatusOllama = {
  online?: boolean;
  version?: string;
  models?: string[];
  loaded?: string[];
};

export type AdminStatusClient = {
  ip?: string;
  ua?: string;
  first_seen?: string;
  last_seen?: string;
  online?: boolean;
  requests?: number;
  conversations?: number;
  last_model?: string;
  last_prompt?: string;
  last_reply?: string;
};

export type AdminStatusStats = {
  requests?: number;
  conversations?: number;
  conversations_total?: number;
  errors?: number;
  auth_fail?: number;
  started_at?: string;
  last_error?: string;
};

export type AdminStatus = {
  gateway?: AdminStatusGateway;
  ollama?: AdminStatusOllama;
  tunnel?: string;
  clients?: AdminStatusClient[];
  online?: number;
  stats?: AdminStatusStats;
  recent?: AdminHistoryRecord[];
};

export type AdminErrorRecord = {
  ts?: string;
  code?: string;
  status?: number;
  upstream_url?: string;
  message?: string;
};

export type AdminClientRecord = {
  ip?: string;
  ua?: string;
  first_seen?: string;
  last_seen?: string;
  online?: boolean;
  requests?: number;
  conversations?: number;
  last_model?: string;
  last_prompt?: string;
  last_reply?: string;
};

export type AdminClientsResponse = {
  clients?: AdminClientRecord[];
};

/**
 * The three upstream dialects Hymnix can speak. `anthropic` is the Messages API
 * Claude Code uses; `openclaw` is an OpenClaw gateway, which routes by agent.
 */
/** Every dialect the desktop can speak. `ollama` is the native /api/chat API. */
export type ProviderKind = "ollama" | "openai" | "anthropic" | "openclaw";

export type ProviderConfig = {
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** OpenClaw: gateway agent id (`main`, `research`). */
  agentId?: string;
  /** Anthropic: max_tokens for the turn. */
  maxTokens?: number;
  reasoningEffort?: string;
  /** OpenAI-compatible dialects: advertised function definitions. */
  tools?: unknown[];
};

export type ProviderProbeResult = {
  ok: boolean;
  kind: ProviderKind;
  latencyMs: number;
  models: string[];
  message: string;
};

export type ProviderApi = {
  probe: (config: ProviderConfig) => Promise<ProviderProbeResult>;
  models: (config: ProviderConfig) => Promise<{ ok: boolean; models: string[]; message: string }>;
};

export type StreamChatInput = {
  reasoningEffort?: string;
  requestId: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Omitted or "openai" keeps the original Chat Completions path. */
  kind?: ProviderKind;
  agentId?: string;
  maxTokens?: number;
  messages: GatewayMessage[];
  /** OpenAI-style tool definitions; the adapters forward them verbatim. */
  tools?: ChatToolSpec[];
  onDelta: (delta: ChatDelta) => void;
};

/** One advertised function: what the model may call when a turn needs it. */
export type ChatToolSpec = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type GatewayApi = {
  health: () => Promise<GatewayHealth>;
  models: (apiKey: string) => Promise<GatewayModelsResponse>;
  streamChat: (input: StreamChatInput) => Promise<void>;
  /** One non-streaming completion, used by delegated subagents. */
  complete: (input: { requestId?: string; baseUrl: string; apiKey?: string; model: string; kind?: string; agentId?: string; maxTokens?: number; system?: string; prompt?: string; messages?: { role: string; content: string }[] }) => Promise<{ ok: boolean; text?: string; error?: string }>;
  /** Stop one delegated completion by the requestId it was started with. */
  completeCancel: (requestId: string) => void;
  cancelChat: (requestId: string) => void;
  adminStatus?: (adminKey: string) => Promise<AdminStatus>;
  adminErrors?: (adminKey: string, limit?: number) => Promise<AdminErrorRecord[]>;
  adminClients?: (adminKey: string) => Promise<AdminClientsResponse>;
  modelsAdmin?: (adminKey: string) => Promise<AdminModelsResponse>;
  pullModel?: (adminKey: string, model: string) => Promise<AdminModelActionResponse>;
  deleteModel?: (adminKey: string, model: string) => Promise<AdminModelActionResponse>;
  startModel?: (adminKey: string, model: string) => Promise<AdminModelActionResponse>;
  stopModel?: (adminKey: string, model: string) => Promise<AdminModelActionResponse>;
};

export type WorkspaceRoot = {
  selected: boolean;
  path: string | null;
};

export type FileEntry = {
  name: string;
  rel: string;
  isDir: boolean;
  size: number;
  mtime: number;
  ext: string;
};

export type FileTreeRequest = {
  path?: string;
  depth?: number;
  limit?: number;
};

export type FileSearchRequest = {
  query: string;
  path?: string;
  include?: string;
  limit?: number;
};

export type FileReadRequest = {
  path: string;
  start?: number;
  lines?: number;
};

export type FileTreeResponse = {
  ok: boolean;
  results: FileEntry[];
  count: number;
};

export type FileSearchResult = {
  rel: string;
  line: number;
  text: string;
};

export type FileSearchResponse = {
  ok: boolean;
  results: FileSearchResult[];
  count: number;
};

export type FileReadResponse = {
  ok: boolean;
  path: string;
  start: number;
  end: number;
  total: number;
  text: string;
};

export type WorkspaceApi = {
  choose: () => Promise<WorkspaceRoot | null>;
  current: () => Promise<WorkspaceRoot | null>;
  /** Pick a folder for the download cache without touching the workspace root. */
  chooseCacheDir: () => Promise<{ selected: boolean; path: string }>;
};

export type FileStatResponse = { ok: boolean; path: string; absolute: string; isDir: boolean; size: number; mtime: number };

export type FilesApi = {
  stat: (path: string) => Promise<FileStatResponse>;
  tree: (request: FileTreeRequest) => Promise<FileTreeResponse>;
  search: (request: FileSearchRequest) => Promise<FileSearchResponse>;
  read: (request: FileReadRequest) => Promise<FileReadResponse>;
};

export type TerminalPolicy = "workspace" | "restricted";

export type TerminalErrorCode =
  | "invalid_request"
  | "policy_denied"
  | "not_found"
  | "busy"
  | "spawn_failed"
  | "cancelled"
  | "exit_failed"
  | "unknown";

export type TerminalCommandRequest = {
  command: string;
  cwd?: string;
  policy?: TerminalPolicy;
};

export type TerminalCommandResult = {
  id: string;
};

export type TerminalOutputEvent = {
  id: string;
  stream: "stdout" | "stderr";
  text: string;
};

export type TerminalCompletion = {
  id: string;
  code: number | null;
  signal?: string | null;
  error?: { code: TerminalErrorCode; message: string };
};

export type TerminalBridgeCommand = "on" | "off" | "status" | "inbox";
export type TerminalBridgeReply = { provider: "gpt" | "gemini" | "other"; text: string; receivedAt: string };
export type TerminalBridgeResult = { enabled: boolean; endpoint?: string; pending?: number; token?: string; replies?: TerminalBridgeReply[] };

export type TerminalApi = {
  bridge: (command: TerminalBridgeCommand) => Promise<TerminalBridgeResult>;
  start: (request: TerminalCommandRequest) => Promise<TerminalCommandResult>;
  cancel: (id: string) => void;
  onOutput: (listener: (event: TerminalOutputEvent) => void) => () => void;
  onComplete: (listener: (event: TerminalCompletion) => void) => () => void;
  unsubscribe: (id: string) => void;
};

export type ToolDescriptor = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  danger: boolean;
  permission: string | null;
};

export type ToolsResponse = {
  ok: true;
  tools: ToolDescriptor[];
  count: number;
};

export type ToolCallRequest = {
  requestId: string;
  tool: string;
  args: Record<string, unknown>;
};

export type ApprovalRecord = {
  id: string;
  requestId: string;
  tool: string;
  argsRedacted: Record<string, unknown>;
  risk: string;
  reasons: string[];
  createdAt: string;
  expiresAt: string;
};

export type ApprovalListResponse = {
  ok: boolean;
  approvals: ApprovalRecord[];
  count: number;
};

export type ToolCallResponse = {
  ok: boolean;
  approval_required?: ApprovalRecord;
  result?: unknown;
  error?: { code?: string; message: string };
};

export type ApprovalDecisionResponse = {
  ok: boolean;
  id: string;
  decision: "approved" | "denied";
  /** Set when the gateway ran the tool as part of the approval. */
  executed?: boolean;
  result?: unknown;
  error?: { code?: string; message: string };
};

export type ToolsApi = {
  list: (apiKey?: string) => Promise<ToolsResponse>;
  call: (request: ToolCallRequest) => Promise<ToolCallResponse>;
  pending: () => Promise<ApprovalListResponse>;
  approve: (id: string) => Promise<ApprovalDecisionResponse>;
  deny: (id: string) => Promise<ApprovalDecisionResponse>;
};

export type PluginDescriptor = {
  id: string; name: string; version: string; apiVersion: string; author: string; description: string;
  permissions: string[]; granted: string[]; capabilities: string[]; enabled: boolean; loaded: boolean;
  source: string; error: string;
};
export type PluginsResponse = { ok: boolean; count: number; enabled: number; loaded: number; plugins: PluginDescriptor[] };
export type PluginActionResult = { ok: boolean; action?: string; id?: string; permission?: string; enabled?: boolean; loaded?: boolean; error?: string; detail?: string; canceled?: boolean };
export type PluginsApi = {
  list: () => Promise<PluginsResponse>;
  install: () => Promise<PluginActionResult>;
  action: (request: { action: "grant" | "revoke" | "enable" | "disable" | "load" | "unload" | "reload" | "uninstall"; id: string; permission?: string }) => Promise<PluginActionResult>;
};

export type LocalModel = { name: string; size?: number; loaded?: boolean };

export type PullProgress = { status: string; digest?: string; total?: number; completed?: number };
export type PullInput = { requestId: string; model: string; onProgress: (progress: PullProgress) => void };

export type ModelsApi = {
  pullStream: (input: PullInput) => Promise<{ cancelled: boolean }>;
  cancelPull: (requestId: string) => void;
  list: () => Promise<{ models: LocalModel[] }>;
  pull: (model: string) => Promise<Record<string, unknown>>;
  remove: (model: string) => Promise<Record<string, unknown>>;
  start: (model: string) => Promise<Record<string, unknown>>;
  stop: (model: string) => Promise<Record<string, unknown>>;
};

export type SystemStats = { gpu: number | null; vramUsed: number | null; vramTotal: number | null; ramUsed: number; ramTotal: number; ai: number | null };

export type WindowApi = {
  control: (action: "minimize" | "maximize" | "close" | "hide" | "restart") => Promise<{ ok: boolean; maximized?: boolean; hidden?: boolean }>;
  setAppearance: (mode: "light" | "dark" | "auto", backgroundColor: string) => Promise<{ ok: boolean }>;
};

export type AppSettings = {
  betaChannel: boolean; runAtStartup: boolean; dpiScaling: boolean; startFullscreen: boolean;
  autoUpdate: boolean; smoothScroll: boolean; gpuAcceleration: boolean; cacheDir: string;
  previewMode: "inapp" | "browser";
};

export type GatewayLifecycleState = "idle" | "starting" | "ready" | "failed" | "stopping" | "stopped";
export type AppBootstrap = { base: string; port: number; external: boolean; error?: string; ready: boolean; state: GatewayLifecycleState };
export type GatewayRestartResult = AppBootstrap & { ok: boolean };

export type SettingsApi = {
  get: () => Promise<AppSettings>;
  set: (patch: Partial<AppSettings>) => Promise<AppSettings>;
};

export type PreviewApi = {
  open: (target: string) => Promise<{ ok: boolean; reused?: boolean }>;
  close: () => Promise<{ ok: boolean }>;
  resize: () => Promise<{ ok: boolean }>;
};

export type OllamaControlResult = { ok: boolean; online: boolean; ready: boolean; models?: number; code?: string; error?: string; detail?: string };
export type OllamaApi = { control: (action: "start" | "stop" | "status") => Promise<OllamaControlResult> };

export type ConfigApi = {
  get: () => Promise<Record<string, unknown>>;
  set: (values: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

export type CloudApi = {
  get: () => Promise<Record<string, unknown>>;
  save: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  test: () => Promise<Record<string, unknown>>;
};

/** A saved cloud provider profile; the key itself never leaves the gateway. */
export type ProviderProfile = {
  id: string;
  label: string;
  kind: string;
  base_url: string;
  models: string[];
  agent_id: string;
  max_tokens: number;
  max_effort: boolean;
  has_key: boolean;
  api_key_masked: string;
  api_key: string;
};

export type ProvidersResponse = {
  ok: boolean;
  providers: ProviderProfile[];
  active: string;
  chat_source: string;
  current_model: string;
  auto_approve_tools: boolean;
  fetched?: string[];
  error?: string;
  detail?: string;
};

export type ProvidersApi = {
  list: () => Promise<ProvidersResponse>;
  save: (payload: Record<string, unknown>) => Promise<ProvidersResponse>;
};

export type DiskInfo = { path: string; free: number; total: number; ok: boolean };

export type NotifyInput = { title: string; body: string };

/** Real folders on this machine, so the settings page never shows a placeholder. */
export type SystemPaths = {
  /** Where Electron caches right now: the chosen folder, or the OS default. */
  cache: string;
  cacheDefault: string;
  appData: string;
  workspace: string;
};

export type SystemApi = {
  stats: () => Promise<SystemStats>;
  openExternal: (url: string) => Promise<{ ok: boolean }>;
  disk: (target: string) => Promise<DiskInfo>;
  notify: (input: NotifyInput) => Promise<{ ok: boolean }>;
  paths: () => Promise<SystemPaths>;
  /** Open one of the folders reported by `paths` in Explorer. */
  reveal: (target: string) => Promise<{ ok: boolean }>;
};

/** Secrets never leave the main process in plaintext; values are sealed with safeStorage. */
export type CredentialsApi = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<{ ok: boolean; encrypted: boolean }>;
  remove: (key: string) => Promise<{ ok: boolean }>;
};

export type NetworkClient = {
  ip: string;
  ua: string;
  requests: number;
  conversations: number;
  online: boolean;
  last_seen: string;
  last_model: string;
};

export type NetworkConnectResult = { ok: boolean; name?: string; token?: string; gateway?: string };

export type NetworkApi = {
  connect: (baseUrl: string, name: string, password: string) => Promise<NetworkConnectResult>;
  info: () => Promise<Record<string, unknown>>;
  tunnel: (action: "start" | "stop" | "restart") => Promise<Record<string, unknown>>;
  tunnelStatus: () => Promise<Record<string, unknown>>;
  saveIdentity: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  get: (baseUrl: string, path: string, token?: string) => Promise<Record<string, unknown>>;
  clients: () => Promise<{ ok: boolean; clients: NetworkClient[]; total?: number; error?: string }>;
  disconnect: (ip: string) => Promise<{ ok: boolean; ip?: string; error?: string }>;
};

export type JobKind = "shell" | "model" | "gateway" | "plugin" | "chat";
export type JobStatus = "running" | "done" | "failed" | "cancelled";

/** One background job as the main process tracks it. */
export type JobView = {
  id: string;
  kind: JobKind;
  title: string;
  command?: string;
  status: JobStatus;
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  error: string;
  output: string;
};

export type JobStartRequest = { command: string; cwd?: string; title?: string };

export type JobsApi = {
  list: () => Promise<{ ok: boolean; jobs: JobView[] }>;
  start: (request: JobStartRequest) => Promise<{ ok: boolean; job?: JobView; error?: string }>;
  stop: (id: string) => Promise<{ ok: boolean; id: string }>;
  /** One job with its output tail, for a single lookup. */
  read: (id: string) => Promise<{ ok: boolean; job?: JobView }>;
  clear: () => Promise<{ ok: boolean }>;
  /** One job changed status. */
  onUpdate: (listener: (job: JobView) => void) => () => void;
  /** Streamed output for one job. */
  onData: (listener: (event: { id: string; stream: string; text: string }) => void) => () => void;
};

/** Automation rules mirror the DSH schedule model. */
export type ScheduleRule =
  | { kind: "at"; at: number }
  | { kind: "every"; seconds: number }
  | { kind: "daily"; time: string }
  | { kind: "weekly"; time: string; weekdays: number[] };

export type AutomationTask = {
  id: string;
  title: string;
  prompt: string;
  rule: ScheduleRule;
  enabled: boolean;
  createdAt: number;
  nextAt: number | null;
  lastAt: number | null;
};

export type AutomationApi = {
  list: () => Promise<{ ok: boolean; tasks: AutomationTask[] }>;
  create: (input: { title: string; prompt: string; rule: ScheduleRule }) => Promise<{ ok: boolean; task?: AutomationTask; error?: string }>;
  update: (id: string, patch: Partial<Pick<AutomationTask, "title" | "prompt" | "enabled">> & { rule?: ScheduleRule }) => Promise<{ ok: boolean; task?: AutomationTask; error?: string }>;
  remove: (id: string) => Promise<{ ok: boolean }>;
  runNow: (id: string) => Promise<{ ok: boolean }>;
  /** A task fired: the renderer opens a conversation and runs the prompt. */
  onFire: (listener: (task: AutomationTask) => void) => () => void;
  onUpdate: (listener: (task: AutomationTask) => void) => () => void;
};

export type SkillEntry = { id: string; name: string; description: string; path: string };

export type SkillsApi = {
  list: () => Promise<{ ok: boolean; skills: SkillEntry[] }>;
  read: (id: string) => Promise<{ ok: boolean; id?: string; content?: string; error?: string }>;
};

export type SymbolHit = { name: string; kind: string; file: string; line: number; preview: string };

export type CodeNavApi = {
  outline: (path: string) => Promise<{ ok: boolean; root?: string; symbols?: SymbolHit[]; error?: string }>;
  definition: (symbol: string) => Promise<{ ok: boolean; root?: string; hits?: SymbolHit[]; error?: string }>;
  references: (symbol: string) => Promise<{ ok: boolean; root?: string; hits?: SymbolHit[]; error?: string }>;
};

/** One organic search result. */
export type WebSearchHit = { title: string; url: string; snippet: string };

export type WebSearchApi = {
  search: (input: { query: string; count?: number; provider?: "auto" | "bing" | "baidu" }) => Promise<{ ok: boolean; provider?: string; query?: string; hits?: WebSearchHit[]; error?: string }>;
};

export type WorktreeRow = { path: string; branch: string; head: string; bare: boolean; current: boolean };

export type WorktreeApi = {
  list: () => Promise<{ ok: boolean; worktrees?: WorktreeRow[]; error?: string }>;
  create: (input: { name?: string; from?: string }) => Promise<{ ok: boolean; path?: string; branch?: string; base?: string; error?: string }>;
  remove: (input: { path: string }) => Promise<{ ok: boolean; error?: string }>;
};
export type DesktopApi = {
  code: CodeNavApi;
  skills: SkillsApi;
  automation: AutomationApi;
  jobs: JobsApi;
  web: WebSearchApi;
  worktree: WorktreeApi;
  gateway: GatewayApi;
  workspace: WorkspaceApi;
  files: FilesApi;
  terminal: TerminalApi;
  models: ModelsApi;
  network: NetworkApi;
  system: SystemApi;
  credentials: CredentialsApi;
  github: { stars: () => Promise<{ ok: boolean; stars: number | null }> };
  changelog: { get: (lang?: "zh" | "en") => Promise<{ ok: boolean; text: string }> };
  updates: { check: () => Promise<{ ok: boolean; current?: string; version?: string; url?: string; newer?: boolean; error?: string }> };
  cloud: CloudApi;
  providers: ProvidersApi;
  provider: ProviderApi;
  config: ConfigApi;
  bootstrap: () => Promise<AppBootstrap>;
  log: (message: string) => Promise<boolean>;
  restartGateway: () => Promise<GatewayRestartResult>;
  settings: SettingsApi;
  preview: PreviewApi;
  ollama: OllamaApi;
  window: WindowApi;
  tools: ToolsApi;
  plugins: PluginsApi;
};