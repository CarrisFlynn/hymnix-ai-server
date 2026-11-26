# Hymnix Orbit 1.4.0

## English

### Highlights
- **Plan tab.** Orbit publishes its steps through a `todo_write` tool call and the fourth conversation tab renders them with live status, per-step duration and the evidence behind each step.
- **Approval inbox.** A title-bar badge (Ctrl+Shift+A) opens a drawer with risk-sorted requests, redacted arguments, batch decisions and per-tool "always allow".
- **Automation.** A new page schedules prompts — once, every N minutes, daily or weekly — and opens a conversation to send them when they fall due.
- **Four provider dialects.** Native Ollama, OpenAI-compatible, Anthropic Messages and OpenClaw, all carrying tool calls, with the dialect recognised from the pasted address.
- **Three security review rounds closed.** Sandbox escape, encoded-path bypass, request smuggling and the approval execution chain are fixed and re-tested.

### Added
- **Plan tab**: live step status, per-step duration, evidence per step, manual done/skip, and a `done/total` badge.
- **Approval inbox**: risk ordering, redacted arguments, batch allow/deny, "always allow" (persisted) and "allow this session", an archive of decisions, and an OS notification while the window is in the background.
- **Background jobs**: long commands, model downloads and gateway restarts in one page with streamed output, elapsed time, exit code and a cancel that kills the process tree.
- **Editable shortcuts**: Ctrl+/ reference sheet, inline recording, duplicate detection including fixed keys, and only the changes are stored.
- **Automation**: once / interval / daily / weekly rules, pause, run now, edit and delete, with next and last run times in the list.
- **Providers**: native Ollama `/api/chat` (frame-by-frame streaming, structured `tool_calls`, no key), OpenAI `/v1/chat/completions`, Anthropic `/v1/messages` with `tool_use`/`tool_result` blocks, and OpenClaw with its agent header.
- **Risk acknowledgement dialogs** before full access or a tool-wide "always allow".
- **Sharing carries the monitor**: service details, connected clients and recent activity moved into the Sharing page; the rail drops to eight entries.

### Changed
- **The gateway is optional.** Health, model list, load/unload/delete, Ollama start and a local chat turn talk to Ollama directly.
- **"Always allow" answers the request.** It approves the pending call and remembers the preference in one action, and the row disables while the answer is in flight.
- **Language switching is reversible.** The DOM-rewriting translator is gone; every string goes through `t()`.
- **Signing is documented honestly.** README and `docs/SIGNING.md` state that the builds are unsigned.

### Fixed
- **A 1.4.0 build could not start its own gateway.** The readiness gate only accepted 1.3.x; fixed with a regression test.
- **Approving a tool call never worked.** The verdict word and the response shape disagreed with the gateway, and `fs.write` was missing `import tempfile`, so approved writes raised an exception.
- **The gateway's auto-approve branch was `if True:`**, so every tool ran unattended.
- **Local turns sent `reasoning_effort`; a picked model had to be preloaded; a tool call written as text was not recognised.**
- **Starting Ollama when it is not installed** no longer takes the main process down.
- **An English session sent the literal `CODE_MODE_PROMPT` key** instead of a system prompt.
- **The approval window was 90 s against a 60 s gateway TTL**; it is 55 s now.
- **Shortcut conflicts ignored fixed keys; an empty batch selection approved everything; a stopped reply showed no marker; restart skipped cleanup.**
- **The legacy Tk console listens on `127.0.0.1`**, not `0.0.0.0`.

### Security
- Plugin sandbox escape through exception tracebacks is blocked, and `type`/`object` are no longer reachable inside the sandbox.
- Admin API bypass through encoded paths (`/api/%70ull`, `/api/%2570ull`, `//api/pull`) is closed; paths are decoded repeatedly and the normalised path is forwarded.
- Chunked requests and OPTIONS with a body can no longer smuggle a second request; both close the connection.
- Error responses close the connection so an unread body cannot be parsed as the next request.
- cloudflared is hashed over the whole file, and a reused binary is verified.
- Forwarded headers are trusted only while a tunnel runs, and stripped when proxying.
- Admin keys are no longer accepted from the query string on the admin API.
- MCP commands reject shell metacharacters and only launch known runtimes.
- The preview view is limited to the workspace, cache and app data folders.
- A token is never sent over plain http to a remote host.
- `terminal.unsubscribe` no longer cancels the running process.
- File writes use a unique temp file and an atomic replace.

## 中文

### 重点
- **计划标签页。** Orbit 通过 `todo_write` 工具调用发布步骤，对话的第四个标签显示实时状态、每步耗时与每一步背后的证据。
- **审批收件箱。** 标题栏徽标（Ctrl+Shift+A）打开抽屉，按危险等级排序，可展开脱敏参数、批量决策，并对单个工具「总是允许」。
- **自动化。** 新页面可创建定时提示：一次、每隔 N 分钟、每天、每周；到点自动新开对话并发送提示词。
- **四套模型接口。** Ollama 原生、OpenAI 兼容、Anthropic Messages、OpenClaw，都支持工具调用，粘贴地址会按形态自动识别。
- **三轮安全审计全部关闭。** 沙箱逃逸、编码路径绕过、请求走私与审批执行链均已修复并复测。

### 新增
- **计划标签页**：步骤实时状态、每步耗时、逐步证据、手动完成/跳过，以及 `完成/总数` 徽标。
- **审批收件箱**：按风险排序、脱敏参数、批量允许/拒绝、「总是允许」（持久化）与「本次会话允许」、决策归档，窗口在后台时发系统通知。
- **后台任务**：长命令、模型下载、网关重启统一一页，实时输出、耗时、退出码，取消会清掉进程树。
- **可改快捷键**：Ctrl+/ 参考表、就地录制、重复检测（含固定键），只保存改动。
- **自动化**：一次 / 间隔 / 每天 / 每周，支持暂停、立即运行、编辑、删除，列表显示下次与上次触发时间。
- **四套接口**：Ollama 原生 `/api/chat`（逐帧流式、结构化 `tool_calls`、无需 Key）、OpenAI `/v1/chat/completions`、Anthropic `/v1/messages`（`tool_use`/`tool_result` 块）、OpenClaw（带 agent 头）。
- **风险确认对话框**：开启完全权限或对工具「总是允许」前先说明影响面。
- **监控并入共享**：服务详情、已连接客户端、最近活动移到共享页；导航从 9 项减为 8 项。

### 变更
- **网关变成可选项。** 健康检查、模型列表、加载/卸载/删除、启动 Ollama、本地聊天全部直连 Ollama。
- **「总是允许」改为对当前请求的一次回答。** 同时批准待审调用并记住偏好，处理期间该行按钮禁用。
- **语言切换可逆。** 删除了改写 DOM 的翻译器，所有文案走 `t()`。
- **如实说明签名状态。** README 与 `docs/SIGNING.md` 写明当前构建未签名。

### 修复
- **1.4.0 的构建起不来自己的网关。** 就绪闸门只认 1.3.x；已修并加回归测试。
- **桌面端审批从未真正生效。** 判定词与返回体形状和网关不一致，且 `fs.write` 缺 `import tempfile`，批准后的写入必抛异常。
- **网关的自动放行分支写成 `if True:`**，所有工具不问就执行。
- **本地模型被误发 `reasoning_effort`、选中的模型必须先预加载、文本形式的工具调用不被识别。**
- **未安装 Ollama 时点「启动」**会让主进程闪退。
- **英文界面把 `CODE_MODE_PROMPT` 这个字面键当系统提示词**发出去。
- **审批等待窗口 90 秒，网关 TTL 只有 60 秒**；改为 55 秒。
- **快捷键冲突忽略固定键；批量审批空选择等于全部批准；停止回复没有标记；重启跳过清理。**
- **遗留 Tk 控制台**改回监听 `127.0.0.1`。

### 安全
- 插件沙箱经异常回溯逃逸已封堵，沙箱内也不再提供 `type`/`object`。
- 管理端点经编码路径绕过（`/api/%70ull`、`/api/%2570ull`、`//api/pull`）已关闭；路径循环解码，并以归一化路径转发。
- 分块请求与带 body 的 OPTIONS 不再能走私第二条请求，两者都会关闭连接。
- 错误响应关闭连接，未读的请求体不会被当成下一条请求。
- cloudflared 按整文件哈希校验，复用已有二进制也会校验。
- 转发头只在隧道运行期间被信任，代理时剥离。
- 管理接口不再接受 URL 查询串里的 admin key。
- MCP 命令拒绝 shell 元字符，只允许已知运行时。
- 预览视图限制在工作区、缓存与应用数据目录内。
- token 不会通过明文 http 发往远端。
- `terminal.unsubscribe` 不再取消正在运行的进程。
- 文件写入使用唯一临时文件并原子替换。
