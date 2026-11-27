# Hymnix Orbit 1.4.3

> This release merges two bodies of work: **[1] the conversational agent and session panel** (21 items, the first half of 1.4.3) and **[2] tool reachability plus high-risk repairs** (21 tools and four classes of serious defect). The second half exists so that what the product announces is what it actually does.

## English

### Overview

1.4.3 is the release where the agent stops being a chat window that describes work and becomes one that performs it — and where the tooling around it stops promising more than it delivers.

The first body of work gave the agent hands: commands in the workspace, surgical file edits, multi-file patches that validate before writing, persistent terminals, delegable subagents, named agents, goals that continue themselves, on-demand skills, and symbol navigation. It also gave the conversation a real side panel.

The second half is the part this release is named for. It put every tool the model can see onto the **real call path** — not the unit-test path — and closed what it found: files that were silently truncated, a packaged build whose file tools could only reach the install directory, tools that were advertised and then permanently refused, a language-server call that could take the main process down, and several places where an approval showed less than it executed.

### [1] Conversational agent and session panel

| # | Capability | What it does |
|---|---|---|
| 1 | Run commands in the workspace | Ask the agent to run a command from the conversation. A timeout terminates it together with everything it spawned, so nothing keeps running in the background. |
| 2 | Surgical text replacement | Replace one exact occurrence, or every occurrence, without rewriting the whole file for a one-line change. |
| 3 | Validate-then-write multi-file patches | Submit several edits at once; every one is checked before anything is written. One mismatch and no file is touched. |
| 4 | Persistent terminal sessions | Close and reopen the terminal and the session is still there. Each read returns only new output; at most four sessions at a time. |
| 5 | Delegated subagents | Hand a self-contained task to a separate context and get the result back, without stretching the main conversation. |
| 6 | Named agents | Up to six named agents, each with its own transcript, surviving a restart so the conversation can continue. |
| 7 | Goals that continue | Set an objective and a round budget; the agent carries on at the end of a turn and says when it is done. |
| 8 | On-demand skills | House rules live in a skill directory and are read only when a task mentions them, so they cost nothing in the prompt until used. |
| 9 | Symbol navigation | Ask where a name is defined or used and get files and line numbers. Workspace-scoped; no type inference. |
| 10 | Session panel | A floating panel beside the conversation showing the working folder, the model, active subagents and running jobs. Toggle it, close it with Escape or a click outside. |
| 11 | Panel section reordering | Drag the sections, or move them with the arrow keys; the order is remembered. |
| 12 | Hover details | Hovering a row reveals when it was last updated or its most recent error, without opening it. |
| 13 | Subagent tree | Subagents indent by parent and expand to show their own transcript, with a main/sub path. |
| 14 | Reply inside a subagent | Continue a subagent from its transcript in the panel instead of going back through the main conversation. |
| 15 | Focus loop and close | Opening the panel moves focus inside, Tab cycles within it, Escape closes it and returns focus to the toggle. |
| 16 | Fixed: garbled message counts | Subagent message counts rendered as mojibake; they now show real numbers. |
| 17 | Fixed: job duration units | A two-second job displayed as over ten minutes; durations now match reality. |
| 18 | Fixed: back-button wording | The back control carried an internal view name; it now says Back. |
| 19 | Fixed: failed status dot | The failure dot had no size and rendered as a large block; it now draws at the correct size. |
| 20 | Removed: standalone agent and code pages | Agent and code navigation are folded back into the conversation; fewer pages, not more. |
| 21 | Subagents moved into the panel | Subagents left the context tab for the session panel, whose header shows how many are running. |

### [2] Tools the model can actually reach

Twenty-one model-facing tools, each verified in a running application rather than in a unit harness:

| Area | Tools | Notes |
|---|---|---|
| Background jobs | `job.start`, `job.list`, `job.output`, `job.kill` | `job.start` is approval-gated; output is a bounded tail; a job can be cancelled with its process tree. |
| Scheduled tasks | `schedule.list`, `schedule.create`, `schedule.update`, `schedule.remove` | Rules, the five-year cap and rejected-patch semantics all come from the existing store. |
| Web search | `web.search` | Bing first, Baidu as fallback, with a relevance gate: an unrelated page is reported as no result instead of being presented as an answer. |
| Interaction | `ask_user_question`, `present` | Up to four questions with options and free text; deliverables appear above the composer and can be opened or located. |
| Vision | `read_image` | Reads a picture and attaches it to the next turn. Attached images now reach the model in each dialect's own shape instead of arriving as a file name. |
| Language server | `lsp` | Real definitions, references and outlines from typescript-language-server, which ships inside the app. |
| Programmatic use | `run_code` | Runs a Node program in a separate process whose only reach is a `tools.call` bridge back through the approval queue. |
| Multi-agent | `agent.wait`, `agent.interrupt` | `agent.send` no longer blocks; waiting uses one shared deadline; interrupting aborts the real request. |
| History | `session_search`, `list_session` | Search the text of every saved conversation and jump back to it. |
| Git | `worktree.list`, `worktree.create`, `worktree.remove` | Sibling worktrees on a new branch; the main checkout cannot be removed. |

### Security and high-risk fixes

These are the defects this release exists for. Each was reproduced on the real path before it was fixed, and each carries a regression check.

**Data integrity — files could be destroyed.**
`fs.edit` and `patch.apply` read the first 256 KB of a file and wrote that truncation back over the original, while text mode turned every LF into CRLF. A 380,000-byte file came back 270,882 bytes with its tail gone and its line endings rewritten — reported to the caller as success. Both now read the whole file, write exact bytes, and report before/after sizes.

**Scope — the packaged build could not touch user files at all.**
In a packaged installation the gateway's tool root was `resources/`, so `fs.*`, `shell.run`, `term.*` and `repo.*` could only ever reach the application itself. The desktop now publishes the chosen workspace to the gateway over an authenticated admin call, and the tools work where the user works.

**Policy — tools were offered and then permanently refused.**
`patch.apply`, `web.fetch`, `term.read` and `term.list` were unclassified, which the default policy denies, so every call returned `policy_denied`. Plugin tools were invisible to the policy entirely. Classification now answers whether every advertised name may run, and a gate fails the build if an advertised tool would be refused.

**Consent — approvals showed less than they ran.**
`run_code` displayed 600 characters of a program that could be 20,000; `job.start` displayed 600 of a command that may be 4,000; the gateway clipped argument payloads to 512 characters with no indication. Approvals now carry the full payload with its true length, and the drawer states how many characters are withheld.

**Containment — the language server read outside the workspace.**
The `lsp` tool resolved any path, so an absolute path escaped the workspace and its contents were handed to the language server. Paths are now resolved inside the workspace root, and anything outside returns `out_of_scope`.

**Robustness — two ways to take the main process down.**
`lsp` on a folder threw `EISDIR` inside a stream callback with no handler; it now refuses anything that is not a regular file, and the main process logs uncaught exceptions instead of dying silently. An agent named `__proto__` with a child crashed the session panel, because a plain object keyed by parent resolved the name through the prototype chain; lookups use own properties and the tree uses a null-prototype map.

**Injection — a ref could pose as a git option.**
`worktree.create` accepted a `from` value beginning with a dash, which git reads as an option. The shape is validated, `--end-of-options` is passed, and the check is a pure function with tests.

**Development surface — a hook could drive tools without a model.**
`window.__hymnixDev.runTool` could invoke any tool from page script, bypassing the model entirely. The whole hook is now compiled out of release builds, and a smoke test asserts its absence in the shipped bundle.

**Encoding and limits.**
Chinese output from `shell.run` and the terminal was decoded as UTF-8 on a CP936 system and arrived unreadable; it now uses the console code page. Web search reads response bodies with a 2 MB budget, and content-carrying tool arguments are accepted up to 1 MB instead of being refused at 8 KB while the tool advertised 256 KB.

### Verification

- `pnpm check`: 138/138 tests, TypeScript typecheck, design tokens, 279/279 contrast pairs across nine themes, production build.
- `pnpm smoke:prod`: the packaged bundle boots, carries no development hook and renders its shell. The same check fails a development build, so it is a real gate rather than a log line.
- `tests/agent-gates.test.mjs`: every advertised tool is passed to the gateway's real policy function; a 300 KB LF file must survive an edit byte for byte; `fs.read` must mark truncation. The first of these found two more misclassified tools on the day it was added.
- Language server verified with Chinese file and symbol names (`中文示例.ts`, `计算总数`), after a Unicode frame-splitting defect that turned every such request into a timeout.
- Packaged build launched and inspected: the window opens, the bundled backend starts, and `resources/app.asar.unpacked/lsp-server` is present.

### Upgrade notes

- The bundled language server adds roughly 25 MB unpacked and ships under `resources/app.asar.unpacked/lsp-server`.
- Distribution builds no longer expose `window.__hymnixDev`; probes and visual baselines build with `pnpm build:dev`.
- `fs.read` now returns a structured body (`path`, `text`, `truncated`, `bytes`) instead of raw text.

---

## 中文

### 概述

1.4.3 是这样一个版本：代理不再只是「描述要做什么」的对话框，而是真的去做；同时，围绕它的工具不再承诺得比兑现的多。

本版合并了两批工作。第一批给了代理一双手：在工作区执行命令、精确改文件、多处改动先校验后写入、跨回合的终端、可委派的子智能体、命名代理、自动续跑的目标、按需加载的技能、符号导航；并给对话加了一个真正可操作的面板。

后半程是本版命名的原因：把模型能看到的每一个工具放到**真实调用路径**（而不是单元测试路径）上过一遍，然后补上发现的问题——被静默截断的文件、打包版里只能碰安装目录的文件工具、宣布了却永久被拒的工具、能把主进程打挂的语言服务器调用，以及多处「审批看到的比执行的少」。

### [1] 对话式代理与会话面板

| # | 能力 | 说明 |
|---|---|---|
| 1 | 在工作区执行命令 | 在主对话里直接让代理跑一条命令；超时自动掐断，连它拉起的子进程一起清掉，不会在后台空跑。 |
| 2 | 精确替换文件内容 | 只改指定的一处文字，或一次改掉全部相同文字，不再为了改一行把整个文件重写一遍。 |
| 3 | 多处改动先校验后写入 | 一次提交多处改动；先逐条确认都能对上再统一写入，只要有一处对不上就一个文件都不动。 |
| 4 | 终端会话跨回合保持 | 终端关掉再打开，之前跑着的东西还在；读输出只给新出来的部分，最多同时开四个。 |
| 5 | 子智能体承接独立任务 | 把一件能独立完成的小事交给另一个上下文去做，做完把结果交回主对话，主对话不被拖长。 |
| 6 | 命名代理保留独立对话 | 最多六个有名字的代理，各自保留自己的对话；重开应用也还在，可以继续跟它聊。 |
| 7 | 对话目标自动续跑 | 给这段对话设一个目标和最多几轮，回合结束后它自己接着往下做，做完了自己说完成。 |
| 8 | 技能按需加载 | 把常用规矩放在技能目录里，只有任务提到时才读进来，平时不占提示词。 |
| 9 | 符号定义与引用查找 | 问某个名字在哪定义、哪些地方用到，直接列出文件和行号；只扫工作区，不做类型推断。 |
| 10 | 会话面板 | 对话页右侧多一个浮层，放当前目录、模型、正在干活的子代理和跑着的任务；点开关打开，按 Esc 或点外面关掉。 |
| 11 | 分区拖拽排序 | 面板里几块内容可以拖着换位置，也能用上下方向键移动，换完的位置会记住。 |
| 12 | 悬停显示详情 | 鼠标停在某一行上，就能看到它上次更新时间或最近的错误，不用点进去。 |
| 13 | 子代理树形展开 | 子代理按从属关系缩进显示，展开就能看它自己的对话，路径显示成主代理与子代理两层。 |
| 14 | 子代理对话内可继续发送 | 在面板里看完子代理的对话，可以直接在下面输入框接着说，不用回主对话绕一圈。 |
| 15 | 焦点循环与关闭 | 打开面板后键盘焦点进入面板，Tab 在面板内循环，按 Esc 关闭并把焦点还给原来的按钮。 |
| 16 | 修复：消息数乱码 | 面板里子代理的消息数显示成一串乱码，现在显示正常数字。 |
| 17 | 修复：任务耗时单位 | 两秒的任务显示成十几分钟，现在按真实时长显示。 |
| 18 | 修复：返回按钮文案 | 返回按钮上写的是英文界面名，现在改成正常的「返回」。 |
| 19 | 修复：失败状态点 | 失败状态的圆点没有尺寸，会渲染成一大块色块，现在按正常大小显示。 |
| 20 | 移除独立代理页与代码页 | 不再单独开页面展示代理和代码导航，都并回对话里的能力，页面更少。 |
| 21 | 子智能体移入会话面板 | 子智能体从上下文标签里挪出来，改到会话面板里，标题上显示有几个在跑。 |

### [2] 模型真正能调到的工具

二十一个面向模型的工具，全部在**真实运行的应用**里验证过，而不是在单元测试里：

| 领域 | 工具 | 要点 |
|---|---|---|
| 后台任务 | `job.start` / `job.list` / `job.output` / `job.kill` | `job.start` 先过审批；输出只给有界尾部；可连同进程树一起取消。 |
| 定时任务 | `schedule.list` / `schedule.create` / `schedule.update` / `schedule.remove` | 规则、五年上限、以及「拒绝的改动不留痕」语义都复用既有存储。 |
| 联网检索 | `web.search` | Bing 优先、Baidu 兜底，带相关性闸门：不相关就报无结果，不把垃圾当答案。 |
| 交互 | `ask_user_question` / `present` | 最多四个问题，带选项与自由输入；交付文件显示在输入框上方，可打开或定位。 |
| 看图 | `read_image` | 从磁盘读图并附到下一轮。贴进去的图片现在按各家方言的形状真的送给模型，不再只是一个文件名。 |
| 语言服务器 | `lsp` | 由 typescript-language-server 提供真实的定义、引用与结构，服务器随应用发布。 |
| 程序化编排 | `run_code` | 在独立进程里跑 Node 程序，唯一出口是回到审批队列的 `tools.call` 桥。 |
| 多代理 | `agent.wait` / `agent.interrupt` | `agent.send` 不再阻塞；等待共用一个 deadline；中断是真的中断。 |
| 历史检索 | `session_search` / `list_session` | 检索所有已保存对话的正文，并跳回那一段。 |
| Git | `worktree.list` / `worktree.create` / `worktree.remove` | 在新分支上开同级工作树；主检出不允许删除。 |

### 安全与高危修复

以下是本版存在的原因。每一条都在**真实路径**上复现过才修，并且都配了回归检查。

**数据完整性——文件可能被毁。**
`fs.edit` 与 `patch.apply` 只读文件前 256 KB，再把这段截断内容写回覆盖原文件；文本模式还把每个 LF 变成 CRLF。380,000 字节的文件变回 270,882 字节，尾部丢失、行尾被改写，**却向调用方报告成功**。现在整份读、按字节写，并返回 before/after。

**作用域——打包版根本碰不到用户文件。**
安装版里网关的工具根是 `resources/`，`fs.*`、`shell.run`、`term.*`、`repo.*` 只能作用于应用自身。桌面端现在通过带鉴权的管理调用把用户选的工作区告知网关，工具就工作在用户工作的地方。

**策略——工具被宣布、然后被永久拒绝。**
`patch.apply`、`web.fetch`、`term.read`、`term.list` 未归类，被默认策略判为 exec 并拒绝，每次调用都返回 `policy_denied`；插件工具对策略完全不可见。现在分类对每个已广告的名字都能回答「能不能跑」，并且有门禁：**已广告的工具若会被拒，构建直接失败**。

**知情同意——审批看到的比执行的少。**
`run_code` 只显示 20,000 字符程序里的 600；`job.start` 只显示 4,000 字符命令里的 600；网关把参数载荷裁到 512 字符且不作任何提示。现在审批携带完整载荷与真实长度，抽屉明确写出「还有多少字符未显示」。

**隔离——语言服务器读到了工作区之外。**
`lsp` 对路径不做包含校验，绝对路径可逃出工作区，内容被交给语言服务器。现在路径必须在工作区根内解析，越界返回 `out_of_scope`。

**健壮性——两条能打挂主进程的路径。**
`lsp` 传目录会在流回调里抛 `EISDIR`，无人接管；现在拒绝一切非普通文件，并给主进程补上未捕获异常日志，不再无声退出。一个叫 `__proto__` 的代理带上子节点就会崩掉会话面板：以父名为键的普通对象把该名字解析到了原型链上；现在改用自有属性判断与无原型映射。

**注入——引用可以伪装成 git 选项。**
`worktree.create` 接受以短横线开头的 `from`，git 会把它当开关解析。现在校验形状、传入 `--end-of-options`，并且这段校验是带测试的纯函数。

**开发面——一个可以绕过模型驱动工具的钩子。**
`window.__hymnixDev.runTool` 能让页面脚本直接调用任意工具，完全不经过模型。现在整个钩子从发布构建里编译掉，并用冒烟测试断言发布包中不存在。

**编码与上限。**
中文 Windows 上 `shell.run` 与终端的中文输出按 UTF-8 解码，收到的是乱码；现在按控制台代码页解码。联网检索的响应体按 2 MB 预算读取；携带内容的工具参数上限提到 1 MB，不再出现「工具声称 256 KB、实际 8 KB 就拒」的矛盾。

### 验证

- `pnpm check`：138/138 测试、TypeScript 类型检查、设计令牌、九套主题 279/279 对比度、生产构建。
- `pnpm smoke:prod`：发布包能启动、不含开发钩子、界面正常渲染；同一项检查对开发构建会失败，所以它是真门禁而不是一行日志。
- `tests/agent-gates.test.mjs`：每个已广告工具都交给网关真实的策略函数判定；300 KB 的 LF 文件必须逐字节挺过一次编辑；`fs.read` 必须标记截断。第一条上线当天就抓出两个额外错分类的工具。
- 语言服务器用**中文文件名与中文符号名**（`中文示例.ts`、`计算总数`）验证——此前正是一个 Unicode 分帧缺陷让这类请求全部超时。
- 打包版实际启动并检查：窗口打开、随包后端启动、`resources/app.asar.unpacked/lsp-server` 就位。

### 升级说明

- 随包的语言服务器解包后约 25 MB，位于 `resources/app.asar.unpacked/lsp-server`。
- 发布构建不再暴露 `window.__hymnixDev`；探针与视觉基线需使用 `pnpm build:dev`。
- `fs.read` 现在返回结构化结果（`path`、`text`、`truncated`、`bytes`），不再是裸文本。
