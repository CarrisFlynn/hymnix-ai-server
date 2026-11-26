# Hymnix Orbit 1.4.0

## 中文

1.4.0 补上桌面端缺的六件事，把接口层扩展到四套方言，并关掉了三轮安全审计发现的全部问题。

**计划**
对话页新增第四个标签「计划」。Orbit 通过 `todo_write` 工具调用发布步骤，界面显示实时状态、每步耗时，以及每一步背后的证据（调用过哪些工具、等你审批了多久、计划被重写过几次）。任何一步也可以由你手动标记完成或跳过，标签上的徽标显示 `完成/总数`。

**审批收件箱**
标题栏的徽标（Ctrl+Shift+A）打开右侧抽屉：待审批按危险等级排序，每条都能展开脱敏参数，支持批量允许 / 拒绝，也可以对某个工具选择「总是允许」或「本次会话允许」。处理过的记录会归档；窗口在后台时新到的审批会发系统通知。开启「完全权限」或「总是允许」之前都会先弹风险确认，说明具体会少掉哪些拦截。

**后台任务**
长命令、模型下载、网关重启统一进「任务」页：实时输出、耗时、退出码，取消会清掉整棵进程树。终端里跑的命令同时出现在这里——它们本来就是同一个进程。

**可改快捷键**
Ctrl+/ 打开全部全局命令的参考表。设置 → 快捷键 可以就地录制新组合；重复的组合会告诉你已经被哪条命令占用（包括 Enter / Escape 这类固定键）；只保存改动。

**自动化任务**
新增「自动化」页：一次、每隔 N 分钟、每天、每周。到点自动新开一个对话并发送你写好的提示词；错过的任务只补最近一次，不会成串重放。任务可以暂停、立即运行、编辑和删除，列表里直接显示下次与上次触发时间。

**四套模型接口**
- Ollama 原生 `/api/chat`：逐帧流式、结构化 `tool_calls`、不需要 Key。
- OpenAI 兼容 `/v1/chat/completions`。
- Anthropic `/v1/messages`：`tool_use` / `tool_result` 内容块。
- OpenClaw：OpenAI 形状加 agent 头。
粘贴地址会按形态自动识别方言，四套都支持工具调用，且各有一组桩服务器测试。

**共享与监控**
「监控」并入「共享」页：服务详情、已连接客户端、最近活动与主机设置同页，导航从 9 项减为 8 项。

**安全审计**
三轮审计发现的问题全部关闭，其中真正影响边界的几条：
- 插件沙箱可经异常回溯（`__traceback__ → tb_frame → f_globals`）逃逸到主机；已封堵，并移除了 `type` / `object` 这类动态类型入口。
- 管理端点可被 `/api/%70ull`、`/api/%2570ull`、`//api/pull` 等编码变形绕过；现在先循环解码、折叠斜杠，并**用同一条归一化路径转发**。
- 分块请求与带 body 的 OPTIONS 可走私第二条请求；现在两者都在入口拒绝并关闭连接。
- 错误响应不读请求体会污染 keep-alive 上的下一条请求；现在所有 4xx/5xx 都关闭连接。
- cloudflared 只校验文件头，且哈希只算了前 4KB；现在按整文件流式校验。
- 转发头默认不再被信任（隧道运行期间才打开），代理也不再透传 `CF-*` / `X-Forwarded-*`。
- MCP 命令拒绝 shell 元字符，只允许已知运行时；预览视图限制在工作区、缓存与应用数据目录内。
- 审批执行链修复：`fs.write` 缺少 `import tempfile`，导致所有已批准的写入抛异常。

**修复**
- 1.4.0 的构建起不来自己的网关：就绪闸门只认 1.3.x，版本号一升就整体报废。已修并加回归测试。
- 本地能力不再依赖可选网关：健康检查、模型列表、加载/卸载/删除模型、启动 Ollama、本地聊天全部直连 Ollama；网关停掉也能正常聊天。
- 桌面端审批此前从未真正生效：发出的判定词和网关期望的不一致，返回体也按另一种形状解析。现在「允许」会直接执行工具并带回结果，「总是允许」同时批准当前请求并记住偏好。
- 本地模型被误发 `reasoning_effort`；选中模型必须先预加载才能发送；模型把工具调用写成文本时不被识别——三处都已修。
- 中文界面此前靠改写 DOM 实现，切回英文不还原；现在全部走 `t()`，语言切换可逆。
- Hymnix AI 不再显示成 Orbit：两个产品各有标记、首屏文案与提示任务。
- 英文界面会把 `CODE_MODE_PROMPT` 这个字面键当成系统提示词发出去，现在是真正的英文提示词。
- 未安装 Ollama 时点「启动」会让主进程闪退；已挂错误监听。
- 审批等待窗口从 90 秒改为 55 秒，落在网关 60 秒 TTL 内。
- 「总是允许」原先只按工具名放行任意参数，且不决策当前请求；现在按 DSH 的语义作答。
- 快捷键冲突检测遗漏固定键；批量审批在空选择时不再等于全部批准；停止回复会显示停止标记；重启应用会走与退出相同的清理流程。
- 遗留 Tk 控制台默认监听 `0.0.0.0`；改回 `127.0.0.1`。
- README 与 `docs/SIGNING.md` 的签名声明改为如实描述：当前产物**未签名**。

**布局**
- 计划、任务、快捷键的行改成固定列宽，耗时与按钮的右边缘逐行对齐。
- 快捷键面板居中显示并留出等距边距；可滚动列表显示细滚动条，不再切掉半行。

## English

1.4.0 closes the six gaps that kept the desktop shell a viewer, extends the provider layer to four dialects, and resolves every finding from three rounds of security review.

**Plan**
A fourth conversation tab. Orbit publishes its steps through a `todo_write` tool call; the shell shows live status, per-step duration and the evidence behind each step — which tools ran, how long an approval waited, how often the plan was rewritten. Any step can also be closed or skipped by hand, and the tab badge tracks `done/total`.

**Approval inbox**
The title-bar badge (Ctrl+Shift+A) opens a drawer: pending requests sorted by risk, each row expanding its redacted arguments, with batch allow/deny plus per-tool "always allow" or "allow this session". Decisions are archived, and a request that arrives while the window is in the background raises an OS notification. Turning on full access, or "always allow", now opens a risk dialog that names exactly what stops being intercepted.

**Background jobs**
Long commands, model downloads and gateway restarts share one Jobs page: streamed output, elapsed time, exit code, and a cancel that kills the whole process tree. Terminal commands show up here too — they are the same process.

**Editable shortcuts**
Ctrl+/ opens a reference sheet of every global command. Settings → Shortcuts records a new combination inline; a duplicate names the command that already owns it (including fixed keys such as Enter and Escape); only the changes are stored.

**Automation**
The new Automation page schedules prompts: once, every N minutes, daily or weekly. When a task is due the app opens a fresh conversation and sends its prompt; missed runs collapse into one catch-up delivery instead of replaying a backlog. Tasks can be paused, run now, edited and deleted, and the list shows the next and last run times.

**Four provider dialects**
- Ollama native `/api/chat`: frame-by-frame streaming, structured `tool_calls`, no key required.
- OpenAI-compatible `/v1/chat/completions`.
- Anthropic `/v1/messages`: `tool_use` / `tool_result` content blocks.
- OpenClaw: the OpenAI shape with its agent header.
A pasted address is recognised by shape, all four carry tool calls, and each has a stub-server test.

**Sharing and monitoring**
Monitor is part of Sharing now: service details, connected clients and recent activity sit beside the host settings, and the rail drops from nine entries to eight.

**Security review**
All findings from three review rounds are closed. The ones that mattered:
- The plugin sandbox could escape through exception tracebacks (`__traceback__ → tb_frame → f_globals`); closed, and `type` / `object` are no longer reachable inside the sandbox.
- The admin API could be reached through encoded paths (`/api/%70ull`, `/api/%2570ull`, `//api/pull`); paths are decoded repeatedly, slashes collapsed, and the normalised path is what gets forwarded.
- Chunked requests and OPTIONS with a body could smuggle a second request; both are rejected at the door and the connection is closed.
- An error response that left its request body unread corrupted the next request on the same connection; every 4xx/5xx now closes the connection.
- cloudflared was checked by magic bytes and its hash covered only the first 4 KB; the whole file is hashed now.
- Forwarded headers are no longer trusted by default (only while a tunnel runs), and the proxy strips `CF-*` / `X-Forwarded-*`.
- MCP commands reject shell metacharacters and only launch known runtimes; the preview view is limited to the workspace, cache and app data folders.
- The approval execution path was broken: `fs.write` was missing `import tempfile`, so every approved write raised an exception.

**Fixes**
- A 1.4.0 build could not start its own gateway (the readiness gate only accepted 1.3.x); fixed with a regression test.
- Local capability no longer needs the optional gateway: health, model list, load/unload/delete, Ollama start and a local chat turn all talk to Ollama directly.
- Approving a tool call from the desktop never worked: the shell sent a different verdict word than the gateway accepts and parsed its reply as another shape. "Allow" now runs the tool and returns its result; "always allow" approves the current request and remembers the preference.
- Local turns sent `reasoning_effort`; a picked model had to be preloaded before it could be used; a tool call written as text was not recognised.
- A Chinese interface used to rewrite the DOM and could not switch back; every string goes through `t()` now, so the switch is reversible.
- Hymnix AI no longer opens looking like Orbit: each surface has its own badge, hero copy and starter prompts.
- An English session used to send the literal `CODE_MODE_PROMPT` key as its system prompt.
- Starting Ollama when it is not installed no longer takes the main process down.
- The approval window is 55 s, inside the gateway's 60 s TTL.
- "Always allow" used to approve any arguments without deciding the current request; it now answers the request, the way DSH's approval card does.
- Shortcut conflict detection includes fixed keys; an empty batch selection no longer approves everything; a stopped reply is marked stopped; restart runs the same cleanup as quit.
- The legacy Tk console listens on `127.0.0.1`, not `0.0.0.0`.
- README and `docs/SIGNING.md` now state the truth: the builds are **unsigned**.

**Layout**
- Plan, job and shortcut rows share fixed column widths, so durations and buttons line up down the list.
- The shortcut sheet is centred with equal margins, and scrollable lists show a thin scrollbar instead of slicing the last row.

## 安装 / Install

- `Hymnix-Orbit-1.4.0-Setup.exe` — Windows x64 安装版（中英文安装界面）
- `Hymnix-Orbit-1.4.0-Portable.exe` — 免安装单文件
- 校验：`SHA256SUMS.txt`
