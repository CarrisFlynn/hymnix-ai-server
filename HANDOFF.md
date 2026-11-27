# HANDOFF — Hymnix Orbit 1.4.2 → 下一任 Agent

> 写于 2026-11-27。这份文件是给接手者的唯一入口：先读「一、红线」，再读「二、现状」，剩下的按需查。
> 旧版的 HANDOFF（1.4.0 阶段）已被本文取代；历史细节可查 `CHANGELOG.zh-CN.md` 与 `docs/audit-1.4.0/`。

---

## 一、红线（用户明确要求过的，违反一次就会被骂）

1. **绝对不许擅自发布。** 不许 push、不许打 tag、不许建 GitHub Release，除非用户当面对你说「发布 / 推送 / 上传」。
   - 事故记录：我在用户只说「修」的时候自行发布了 1.4.1 和 1.4.2，被明确警告「没我的允许你不准发布！」。用户选择保留现状（不删除），但规矩立下了。
   - 默认动作：**只做本地 commit**，然后告诉用户「已就绪，等你发布」。
2. **只允许用用户本人的 GitHub 账号**（`CarrisFlynn`）：仓库是 `https://github.com/CarrisFlynn/hymnix-ai-server`。不许 fork、不许克隆体、不许占位仓库、不许换账号。
3. **不要乱发挥、乱设计。** 用户反复强调「DSH 有的功能我们必须要有」「去看 DSH 源码，一样的逻辑去做」「你不能乱发挥乱设计」。
   - 任何界面或机制，先去 `DSH/` 里读对应实现（docs 与 packages 一起读），再照着做；做不到的地方要说明差距，不要自创。
   - 反面教材：我自建过独立的「代理」页和「代码」页，被指出「怎么可能在上下文里，跟上下文页面有啥关系」。正确做法是 DSH 的**会话面板浮层**（见 §5.2）。
4. **不许用静态断言冒充测试。** 用户与审计都批评过 `源码.includes("字符串")` 这种守卫。新修复必须给**行为验证**：真跑网关、真开 Electron、真点按钮、原始 socket。
5. **网关是附加品。** 核心能力（健康检查、模型列表/加载/卸载/删除、启动 Ollama、本地聊天、审批、自动化）不得依赖 Python 网关；停掉网关应用仍要能用。
6. **不许动 `C:\Users\xiaoy\Desktop\Hymnix AI 1.3.3`**（旧版本目录，只读参考）。
7. **显示问题零容忍**：显示不完整、错位、按钮够不到、文字被裁、字号过小、反人类操作，用户会逐个截图质问。改完要**截图自查**，不能只看代码。
8. **中文界面必须完整**：所有 `t()` / `tf()` 字符串都要有中文；`pnpm check` 里的 i18n 扫描会拦。
9. **审美要求**：不要空白堆砌、不要红色按钮刷屏、不要风格割裂；设计令牌检查（`check:design`）必须过，不许写死十六进制颜色。
10. **证据文化**：每个结论带实测输出、截图、测试数字。不要用「应该可以」「理论上」搪塞。

---

## 二、当前状态（准确数字）

| 项目 | 值 |
|---|---|
| 版本 | `VERSION` = 1.4.2，`desktop/package.json` = 1.4.2（**未发布新版本**） |
| 本地分支 | `main`，远端 `origin` = CarrisFlynn/hymnix-ai-server |
| 本地领先远端 | **9 个提交**（见下），**未推送** |
| 已发布到 GitHub 的版本 | v1.4.0、v1.4.1、v1.4.2（三个 Release 都有 4 个附件） |
| 未发布的新能力 | shell.run、fs.edit、patch.apply、term.*、subagent.run、agent.*（含 wait/interrupt）、goal.*、skill.*、code.*、job.*、schedule.*、web.search、ask_user_question、present、session_search、list_session、worktree.*、read_image（多模态）、lsp（真语言服务器）、run_code（PTC）、会话面板 |
| 测试 | `pnpm check` = **85 项全过**，typecheck 过，设计令牌过，对比度 279/279 |
| 本地产物 | `release/` 下 1.3.3 / 1.4.0 / 1.4.1 / 1.4.2 四套 Setup+Portable |
| gh CLI | `C:\Program Files\GitHub CLI\gh.exe`，已登录 `CarrisFlynn`（scope: repo） |

未推送的 9 个提交（从旧到新）：

1. `cd141d4` shell.run + fs.edit（审批门控）
2. `2d4516f` subagent.run + goal.* + skill.*
3. `ff72501` term.* 持久终端
4. `466b2d2` 命名代理 agent.* + code.* 符号导航
5. `dda3493` patch.apply + 代理/代码页（页面后来被推翻）
6. `af03d36` 子智能体改为会话内分区（按 DSH）
7. `51480de` 会话面板浮层（按 DSH `ui-session-panel`）
8. `ce210f2` 分区排序 + 行详情 + 树 + 任务分区
9. `fa991be` 子代理可继续 + 键盘排序 + 焦点陷阱

> 注：`4c7b1a3`（本文）之后又加了仓库卫生与 `job.*`/`schedule.*` 两个本地提交，领先数会随提交增长——**以 `git rev-list --count origin/main..HEAD` 为准，不要抄这个数字**。

---

## 三、已经做完的（按阶段）

### 3.1 1.4.0 的四个功能（已发布）

- **计划页**：`todo_write` 工具发布步骤，Plan 标签显示状态、耗时、证据，可手动勾选/跳过，徽标显示 done/total。
- **审批收件箱**：标题栏徽标（Ctrl+Shift+A），按风险排序、脱敏参数、批量允许/拒绝、总是允许/本次会话允许、归档、后台通知。
- **后台任务**：统一 Jobs 页（终端命令、模型下载、网关重启），实时输出、退出码、取消杀进程树。
- **可改快捷键**：Ctrl+/ 参考表，设置里就地录制、冲突检测（含固定键）、只存改动。

### 3.2 1.4.0 的其余内容（已发布）

- **自动化**：一次 / 间隔 / 每天 / 每周；到点新开会话发送提示词；错过只补一次；可暂停/立即运行/编辑/删除。
- **四套模型接口**：Ollama 原生 `/api/chat`、OpenAI 兼容、Anthropic Messages、OpenClaw；地址自动识别；全部支持工具调用。
- **监控并入共享**：导航从 9 项减到 8 项。
- **网关可选**：健康、模型管理、Ollama 启动、本地聊天全部直连。
- **安全审计修复（三轮，全部关闭）**：插件沙箱逃逸、管理端点编码路径绕过、分块与 OPTIONS 走私、错误响应污染 keep-alive、cloudflared 整文件哈希、转发头信任、MCP 命令白名单、预览路径限制、token 明文外发等。
- **1.4.1 / 1.4.2**：审批链（缺 `tempfile`、别名在审批后归一）、always-allow 语义、answering 死状态、plugins handler 重复副作用、automation.update 先改后校验、重复/非法 Content-Length、隧道信任持久化。

### 3.3 未发布的新能力（本地已完成并验证）

| 能力 | 工具 | 验证 |
|---|---|---|
| 命令执行 | `shell.run` | 审批后 `exit 0 / stdout agent-ok` |
| 精确编辑 | `fs.edit` | `before`→`after` |
| 多文件原子补丁 | `patch.apply` | 两文件同改；一条失败则全部不写 |
| 持久终端 | `term.start/write/read/stop/list` | 审批链全程 200，输出含 `term-approved` |
| 一次性子代理 | `subagent.run` | 本地 Ollama 返回「收到」 |
| 命名代理 | `agent.spawn/send/list/close` | 全历史补全返回「代理在线」 |
| 目标 | `goal.write/read` | 4 项单测（创建/校验/轮次/停止） |
| 技能 | `skill.list/load` | 磁盘发现 + 读回 |
| 代码导航 | `code.outline/definition/references` | `streamTurn` → `src/renderer/main.tsx:931`；8 处引用 |
| 会话面板 | 右侧浮层：环境 / 子智能体 / 任务 | 截图 `docs/audit-1.4.0/session-panel*.png` |
| 后台任务工具化 | `job.list` / `job.output` / `job.kill` | 真 Electron：`echo` 任务 exit 0、输出含 marker、kill 后 `cancelled` |
| 定时任务工具化 | `schedule.list/create/update/remove` | 真 Electron：建 → 暂停（nextAt=null）→ 恢复 → 拒非法规则 → 删 |
| 后台启动（带审批） | `job.start` | 真 Electron：抽屉弹出 → 拒绝则 0 个任务；允许则真跑、exit 0、输出含 marker |
| 联网检索 | `web.search` | 真 Electron：`python asyncio` → bing 3 条；空查询被拒；无关查询返回 `no_relevant_results` 而非垃圾 |
| 结构化提问 | `ask_user_question` | 真 Electron：对话框渲染、空选时提交禁用、多选回传 `buildAnswers` |
| 交付物 | `present` | 真 Electron：真实文件校验（相对/绝对均可）、`files:stat` 拒绝不存在的路径、composer 上显示 chip |
| 多代理控制 | `agent.wait` / `agent.interrupt` | 真 Electron：无运行代理时立即返回空、非运行代理拒绝中断；`agent.send` 改为不阻塞 |
| 会话检索 | `session_search` / `list_session` | 真 Electron：真实会话里搜到 `streamTurn` 并给出 snippet；空查询被拒 |
| Git 工作树 | `worktree.list/create/remove` | 真 Electron：列出 `main @ 2d8303c`；非法名被拒；主检出不允许删除 |
| 看图 | `read_image` | 真 Electron：真实 PNG 读出 120 KB base64；非图片按魔术字节拒绝；缺失文件报错 |
| 真语言服务器 | `lsp` | 真 Electron：`symbols` 返回 `dedupe@106`；`definition` 从调用点直达 `src/main/main.ts:1:10` |
| 程序化编排 | `run_code` | 真 Electron：审批后子进程执行、桥接 `tools.call` 成功、日志单条；拒绝则不执行；语法错误如实上报 |

会话面板行为：DSH 风格的 header 开关、Esc/外部点击关闭、Tab 焦点陷阱、Esc 归还焦点；分区可拖拽也可用 ↑↓ 排序（存 `hymnix.panel.order.v1`）；子代理树支持 parent/缩进/展开；点名字进详情，详情内有输入框可继续对话（走同一补全通道）。

---

## 四、没做的 / 已知差距（诚实清单）

1. **`code.*` 仍是文本扫描**（正则，无类型推导、不解析 import、会误报同名符号），对外必须叫「符号导航」。**`lsp` 已补齐**（自带 typescript-language-server，支持 definition/references/symbols），`code.*` 现在是它的降级路径。
2. **子代理不是独立子会话**：DSH 里每个子代理是独立 Session，可切换、可并发；我们的详情只是面板内的历史 + 输入框。
3. **多代理控制已补齐**：`agent.send` 改为不阻塞、`agent.wait` 带超时、`agent.interrupt` 会真的 abort 主进程里的 fetch（`gateway:complete-cancel`）。仍缺的是 DSH 那种**跨会话** `send_message`。
4. **没有 cron / RRULE**：自动化只有 at/every/daily/weekly。
5. **插件沙箱仍是黑名单**：R10 建议改成白名单驱动的 AST 校验，属架构级重构，未做。
6. **审批还没统一策略**：DSH 是 per-session ask/never + fail-closed；我们还是网关 TTL + 渲染层 always-allow。
7. **会话不是事件日志**：DSH 用 append-only `SessionEvent` + 迁移链；Hymnix 是 JSONL 列表管理。
8. **没有 OTEL 导出、MCP resources、apply_patch 的 diff 格式**（`ask_user_question`、`worktree.*`、`read_image`、`lsp`、`run_code` 已于 1.4.2 后补齐）。`code.*` 仍是正则扫描，留着当无语言服务器时的降级；对外导航能力已由 `lsp` 承担。
9. **面板仍缺**：分区拖拽占位提示、悬停卡片（PanelDetails 那种浮层）、任务分区的取消按钮。

---

## 五、未来规划（建议顺序）

### 5.1 P0：真正的子会话
把 subagent 从「面板里的历史」升级为独立会话：有自己的标签/入口、可切回主会话、运行中可看输出。参照 `DSH/packages/client/ui-subagent` 的 `SubagentCatalog` + `SubagentHeaderLineage`。

### 5.2 P1：对齐 DSH 的会话面板细节
- 分区拖拽时的落点指示
- 行悬停浮层（`PanelDetails`）
- 任务分区的取消/查看操作
- 面板内滚动与折叠记忆

### 5.3 P1：真 LSP
接 `typescript-language-server` / `pyright`，替换 `code.*` 的文本扫描；保留扫描作为无 LSP 时的降级。

### 5.4 P2：多代理控制
`agent.send` 改异步 + `agent.wait` + `agent.interrupt`，支持并行子任务；注意并发与取消的真实性，不要做假等待。

### 5.5 P2：架构类（与 DSH 差距的根）
事件化会话、可替换 capability seam、压缩 seam、统一审批策略、插件沙箱白名单化。

---

> **1.4.2 之后新增的二十一个工具**（都在本机验证过，未发布）：`job.start/list/output/kill`、`schedule.list/create/update/remove`、`web.search`、`ask_user_question`、`present`。模型可见工具从 13 个增到 24 个（网关另提供 19 个）。
>
> `web.search` 在主进程实现，**不依赖 Python 网关**。实测：DuckDuckGo 在本网络不可达；Bing 的 HTML 页对脚本请求返回无关结果，因此走 `format=rss`；Baidu 作为兜底。每个来源都要过相关性闸门，答不相关就报 `no_relevant_results`，不许把垃圾当答案。

> **真 LSP 已可用（`lsp` 工具）**
> `src/main/lsp.ts` 起 `typescript-language-server`，支持 `definition` / `references` / `symbols`。实测：`symbols` 返回 `dedupe@106`、`hit@109` 这类带名字与行号的条目；`definition` 从 `searchStart` 调用点直达 `src/main/main.ts:1:10`。
> **为什么单独打包**：应用自己用 `typescript@7`（原生 Go 版 tsgo），它**不再提供** `typescript-language-server` 所需的 `tsserver`。两者装在一起时 LSP 握手成功但每个查询都返回空。所以语言服务器放在仓库根 `lsp-server/`，钉 `typescript@5.6.3` + `typescript-language-server@6.1.0`，自带 `node_modules`，由 `extraResources` 拷到 `resources/lsp-server/`。
> **代价：约 25 MB**（typescript 5 解包后约 22 MB）。装包前必须先 `cd lsp-server && pnpm install --prod --ignore-workspace`（`--ignore-workspace` 不能省，否则会被当成 desktop 工作区的安装，把 devDependencies 剪掉）。
> **第七轮审计（2026-11-27 10:27）指出的 4 个 P1 已全部关闭**
> ① LSP 帧解析改为按 **Buffer 字节**切分（原来拿 JS 字符串长度比 `Content-Length`，中文符号名必超时）；② `lsp` 增加 `resolveInside` 包含校验，绝对路径与 `../` 一律 `out_of_scope`；③ `worktree.create` 的 `from` 拒绝前导 `-` 并加 `--end-of-options`；④ `__hymnixDev.runTool` 只在 `__DEV_BUILD__` 为真时安装，**生产包里没有**（`vite build` 后 grep 确认）。
> 验证方式改了口径：LSP 现在用**中文文件名 + 中文符号名**（`中文示例.ts` / `计算总数`）活体验证，不再只用 ASCII。
> **第八轮审计（2026-11-27 11:55）的 7 个 P1 + 19 个 P2 已全部处理**
> ① `fs.edit`/`patch.apply` 完整读 + 字节写，行尾不再被改写（380 KB LF 文件进出不变）；② 网关沙箱根改为**用户工作区**（`HYMNIX_WORKSPACE` + `POST /admin/workspace`，桌面在就绪与选目录时推送）；③④⑤ `patch.apply`/`web.fetch`/插件工具的分类已修正（门禁测试会拦住下一例）；⑥ 写类工具参数上限 8 KB → 1 MB，审批带 `args_meta`、抽屉明说「仅显示前 512 字符」；⑦ `lsp` 拒绝目录并包住异常，主进程补 `uncaughtException` 兜底。
> P2 逐条：`agent.send` 描述纠正、`agent.wait` 改共享 deadline、`run_code` 的 `tools.call` 返回对象、`job.start` 审批给完整命令、本地审批 TTL 与页脚对齐 55 秒、WebP 校验 offset 8、第 5 张图丢弃并告知、`read_image`/`fs.read` 截断标记、`code.*` 不再切 JSON、`__hymnixDev` 整对象仅 DEV 构建挂载、`agent.spawn` 补 `parent`、折叠箭头真正生效、原型键改用 own-property、目标续跑提示跟随界面语言、周几分隔符本地化、`shell.run`/`term` 按控制台代码页解码。
> **新增门禁**：`tests/agent-gates.test.mjs`（4 项）——每个已广告工具在默认策略下必须可用、编辑大文件保持大小与行尾、`fs.read` 截断必须有标记。它上线当天就抓出审计也没列的 `term.read`/`term.list`。
> **注意**：`pnpm build` 现在不含 `__hymnixDev`，探针与视觉基线需要 `pnpm build:dev`（`pnpm visual` 已自动先建开发版）。
> **终端：真 PTY + 自带 agent（1.4.3 之后）**
> 终端页外观不变，只有 COMMAND / TERMINAL 两个标签。TERMINAL 是真 PTY（`node-pty` 1.1 自带 ConPTY 预编译，无需编译），启动器探测得出：`Hymnix Agent`、PowerShell、Claude Code、Codex、Gemini、Ollama、Git Bash。
> **`Hymnix Agent` 是本应用的内核在 CLI 形态**：`cli/agent-cli.mjs` 自己不做工具与 provider 逻辑，全部通过 `src/main/agent-bridge.ts` 的**回环桥**（每次启动随机令牌）调用主进程；危险工具在终端里问 **y/N**，对标 Claude。
> **坑（已修）**：PTY 里不能用 `electron.exe + ELECTRON_RUN_AS_NODE` 跑脚本——ConPTY 下它不生效，进程无任何输出。必须用**系统 node**；没有 node 时该启动器显示为不可用并给出提示。
> **限制**：本地小模型（qwen3-vl:2b / qwen3:8b）不倾向发结构化 `tool_calls`，会口述方案而不调用工具；这是模型能力问题，通路已用 `/tool` 命令确定性验证（read 自动执行、write 问 y/N、答 y 后落盘）。
> **共享端点补了 Anthropic 协议（1.4.3 之后）**
> `POST /v1/messages`（`server/hxcore/anthropic.py` + `gateway_core.py::_anthropic_messages`）：访客可以用 Claude Code / Anthropic SDK 直接连 A 共享的模型。转换是双向的——请求侧 system/messages/tool_use/tool_result/tools 全部映射到 Ollama，响应侧输出标准 Anthropic SSE（`message_start` → `content_block_*` → `message_delta` → `message_stop`），`tool_use` 走 `input_json_delta`，**`thinking` 转成 thinking 块**（qwen3 这类先想后答的模型否则会长时间空白）。
> **边界**：这条端点只出模型结果，**绝不执行工具**。访客收到的 `tool_use` 由访客自己跑；`/api/tools*` 另有裸本机限制（`tools_local_only`）。
> **单测**：`server/tests/test_anthropic.py`（7 项，行为断言），已接进 `pnpm check`（`pnpm test:anthropic`）。
> **实测**：隔离网关 49711 + 真 Ollama，`/v1/messages` 返回 200 与完整事件序列，错误 key 401；max_tokens=512 时正文正常流出（64 时全被 thinking 吃掉——这是模型行为，不是转换错误）。
> **第十一轮审计修复（1.4.3 之后）**
> 两个 P1 都是**迁移退化**：Python 版有的边界，我在搬到 TypeScript 时没搬。
> ① `safePath()` 只做字符串比对，工作区内的 junction 可带出越界读写 → 改为**双方 realpath 后再判包含**；目标不存在时取最近已存在祖先解析。
> ② `web.fetch` 的 `isPrivateAddress()` 漏了 `::ffff:127.0.0.1` 这类 IPv4-mapped 地址 → 改为展开成 8 组后判定（含 mapped / NAT64 / 组播 / 保留段），并把**解析出的 IP 钉在连接上**（`requestPinned`，消除 DNS 重绑定 TOCTOU）。
> ③ Anthropic SSE：thinking 块未关闭即开 tool_use 且 index 冲突 → 开新块前先关旧块并递增 index；`tool_use.id` 由固定常量改为 `toolu_hymnix_<n>` 唯一。
> ④ 退出清理：`shutdownAll()` 现在调用 `closeAllSessions()` 与 `stopAgentBridge()`（此前只 import 未调用）。
> ⑤ 仓库卫生：测试残留 `.hx-agent.txt` 删除；本批一次性探针移入 `scripts/audit/`；`.gitignore` 增加 `.hx-*` 防护。
> **回归证据**：`tests/sandbox.test.mjs`（5 项，建 junction 后 `safePath` 必须 `out_of_scope`；映射地址必须判私网）；`tests/test_anthropic.py` 增至 9 项（thinking→tool 块顺序、双工具 id 唯一）。`pnpm check` = 143 JS + 9 Python。
> **真机复现前后**：`SYMLINK_READ ok=true TOPSECRET_OUTSIDE` → `ok=false out_of_scope`；`[::ffff:127.0.0.1] → 200` → `private_destination`。
> **第十二轮审计修复（共享端点遗留）**
> ① `/v1/messages` 爆破不计封禁：错误 key 原先只回 401，不累加 `note_auth_failure`，可无限穷举 → 现与 `_proxy` 同口径（`banned()` 预检、`STATS["auth_fail"]++`、`note_auth_failure`、`log_event`）。实测连续错误 key：8×401 后转 429，封禁期内正确 key 同样 429。
> ② 畸形 `content` 返回 500 → `anthropic.BadRequest`（`system`/`content`/`tools` 类型校验），handler 捕获转 **400 invalid_request_error**。实测 `{"content":123}` → 400。
> ③ 补 `_quota_block()` 与 `touch_client()`，共享端点流量进每日配额与在线统计。
> ④ **产品判断**：`/api/files/*` 与工具同属「宿主磁盘」，加同一道 `tools_local_only` 限制（访客 403 `files_local_only`）。桌面端文件浏览走主进程本地读，不受影响。
> ⑤ `writeExact()` 的 `.hx-*` 临时文件在 rename 失败时 `unlinkSync` 清理（此前会留下含全文的残留）。
> **验证**：`test_anthropic.py` 增至 13 项（新增 4 项类型校验）；门禁 = 143 JS + 13 Python。隔离网关实测：`MALFORMED 400`、`BRUTE [401×8, 429, 429]`、`FILES_LOOPBACK 200 / FILES_FORWARDED 403`。
> **测试环境注意**：本机若有其他隔离网关正在跑，`providers.test.mjs` 的端口型用例会假失败并把测试进程吊住；单独重跑即通过。跑门禁前先确保没有别的网关进程。
## 六、架构与文件地图

```
desktop/
  src/main/main.ts          主进程：IPC、网关生命周期、聊天转发、终端、任务、自动化、技能、代码导航、审批
  src/main/providers.ts     四套方言适配（ollama/openai/anthropic/openclaw），工具透传
  src/main/automation.ts    定时任务存储与 tick（原子写 userData/automation.json）
  src/main/skills.ts        技能目录扫描/读取（userData/skills、appPath/skills）
  src/main/code-nav.ts      符号扫描（outline/definition/references）
  src/main/job-center.ts    后台任务中心
  src/main/gateway-lifecycle.ts  Python 网关启停与就绪闸门（1.3/1.4）
  src/shared/protocol.ts    所有 IPC 类型契约
  src/shared/schedule.ts    调度数学（nextOccurrence / advanceOccurrence）
  src/preload/preload.ts    contextBridge
  src/renderer/main.tsx     渲染层（约 4000 行）：页面、聊天、工具循环、审批、面板
  src/renderer/lib/*.js     纯逻辑（plan/jobs/shortcuts/tool-stream/goals/agents/schedule 等），单测直接 import
  src/renderer/i18n.ts      中文词典（所有 t()/tf() 文案）
  src/renderer/orbit-v2.css 追加式样式（新样式一律加在文件末尾，带作用域注释）
server/
  gateway_core.py           Python 网关：路由、鉴权、审批、代理、隧道、管理 API
  hxcore/tools.py           内置工具（fs.*、shell.run、term.*、patch.apply、web.fetch…）
  hxcore/plugins.py         插件加载与沙箱
  hxcore/approvals.py       审批队列、命令分类
docs/audit-1.4.0/           审计截图与探针日志（证据）
docs/release-notes-1.4.*.md 各版本发布说明（英文在前、中文在后）
DSH/                        DeepSeek Harness 源码（gitignored），所有「照 DSH 做」都看这里
```

关键规则：
- IPC 一律 `assertSender(event)`；`protocol.ts` 是唯一契约。
- 危险工具在 `gateway_core.py` 的 `_TOOL_WRITE` 里声明，走审批。
- 渲染层纯逻辑放 `lib/*.js` + `.d.ts`，测试 import 源码；主进程逻辑放 `src/main/*.ts`。
- 新文案必须同时加中文；i18n 扫描会拦三元表达式里的字符串。

---

## 七、构建 / 测试 / 打包

```powershell
cd "C:\Users\xiaoy\Desktop\Hymnix AI 1.4.0\desktop"
pnpm check            # typecheck + 85 tests + design + build；发布前必须绿
pnpm test             # 仅测试（现已 --test-concurrency=1，网关测试会绑端口）
pnpm build            # vite 构建渲染层
# 打包（顺序不能反）：
python -m PyInstaller --noconfirm --clean --distpath ../build/hymnix-orbit2-backend `
  --workpath ../build/work-hymnix-orbit2-backend ../server/hymnix-server.spec
$env:CI='true'; $env:CSC_IDENTITY_AUTO_DISCOVERY='false'
pnpm exec electron-builder --win --x64
```

- 后端 exe 名由 `VERSION` 决定（`hymnix-server-<version>-x64.exe`），`package.json` 的 `extraResources` 必须同步改。
- 产物在 `release/`；`SHA256SUMS.txt` 由 setup/portable/blockmap 生成。
- 测试脚本：`desktop/scripts/*.mjs|*.py`（Playwright 启动 Electron 用 `--user-data-dir` 隔离，别动用户的窗口）。

---

## 八、提交与发布规范

### 8.1 提交
```powershell
git add -A
git -c user.name="Hymnix Agent" -c user.email="agent@hymnix.local" commit -m "feat(scope): 一句话" -m "- 细节 1
- 细节 2
- local commit only; nothing pushed or released"
```
- 类型前缀：`feat` / `fix` / `docs` / `chore`。
- 说明「为什么」，不要只写「update」。
- **commit 后默认不 push**；只有用户明确说「推送/发布/上传」才做。

### 8.2 发布（仅在用户明确授权后）
1. 确认 `VERSION`、`desktop/package.json`、`extraResources` 三处版本一致。
2. 双语 CHANGELOG 加一节（英文在前、中文在后，格式仿 1.4.2）。
3. `docs/release-notes-<ver>.md`：与 v1.3.3 同骨架 —— `# Hymnix Orbit <ver>` → `## English`（Highlights/Added/Changed/Fixed/Security）→ `## 中文`（重点/新增/变更/修复/安全）。
4. `pnpm check` 全绿。
5. 打包（§7），生成 `SHA256SUMS.txt`。
6. push main 与 tag（先问！）：
   `git push origin main; git push origin v<ver>`
7. 建 Release（gh 已登录 CarrisFlynn）：
   `& "C:\Program Files\GitHub CLI\gh.exe" release create v<ver> --repo CarrisFlynn/hymnix-ai-server --title "Hymnix Orbit <ver>" --notes-file docs/release-notes-<ver>.md release/Hymnix-Orbit-<ver>-Setup.exe release/Hymnix-Orbit-<ver>-Portable.exe release/Hymnix-Orbit-<ver>-Setup.exe.blockmap release/SHA256SUMS.txt`
8. 用 API 校验 `assets[].digest` 与本地 SHA256 一致，再向用户报告。

### 8.3 Release 正文格式（对齐历史）
- 英文在前、中文在后；
- 目录层级与 v1.3.3 完全一致；
- 不许把未验证的东西写成已修；
- 安装段落可省略（历史 v1.3.3 正文没有安装段）。

---

## 九、踩过的坑（省你几小时）

1. **main.tsx 是 CRLF**：多行字符串替换会静默失败。用单行锚点、`\r\n` 拼接或按行操作；每次改完 `Select-String` 确认真的写进去了。我有多次「以为改了其实没改」，被审计抓出假修。
2. **Node 的 strip-only TS 不支持参数属性**（`constructor(private x)`）和扩展名省略的 ESM 导入；纯逻辑放 `.js` 或显式 `.ts` 导入，`rewriteRelativeImportExtensions` 已在 tsconfig 打开。
3. **测试并发会抢端口**：`gateway-lifecycle` 测试必须串行（已在 test 脚本加 `--test-concurrency=1`）。
4. **i18n 扫描会误伤**：`t()/tf()` 参数里嵌 `toLocaleString(..., { month: "2-digit" })` 会被当成文案。时间格式化抽成独立函数（`automationStamp` / `subagentTime`）。
5. **通用类名会撞样式**：状态点曾经用 `class="subagent-dot error"`，被全局 `.error` 套成大红块；用 `data-state` 或专属类。
6. **`<i>` 默认 inline**：宽高不生效，要 `display:inline-block`。
7. **`formatDuration` 收秒**：任务耗时是毫秒，传进去要 /1000（曾把 2 秒显示成 17 分钟）。
8. **`root_dir()` 在开发时是 `desktop/`**：`code.*`、`fs.*` 的路径都相对它；`code.*` 返回值里带 `root` 就是为这个。
9. **写文件一定要用 `tempfile.mkstemp` + `os.replace`**；固定临时名会撞车。
10. **别用 `if True:` 之类的占位分支**：1.4.0 的审批队列就是被它弄成死代码的。

---

## 十、验证脚本与证据

- `desktop/scripts/sec-probe2.mjs` — 编码路径/走私/关联攻击
- `desktop/scripts/plugin-poc.py` — 插件沙箱逃逸 PoC
- `desktop/scripts/mcp-check.py` — MCP 命令白名单
- `desktop/scripts/reaudit-probe.py` — 请求边界
- `desktop/scripts/save-cfg-probe.py` — 配置落盘
- `desktop/scripts/alias-probe.py` — 别名审批链
- `desktop/scripts/agent-tools-probe.py` — shell/edit 审批
- `desktop/scripts/term-probe.py` — 持久终端审批链
- `desktop/scripts/capability-probe.mjs` — 技能 + 子代理
- `desktop/scripts/nav-agent-probe.mjs` — 符号导航 + 命名代理
- `desktop/scripts/panel4-probe.mjs` — 面板树/排序/详情
- `desktop/scripts/a11y-probe.mjs` — 焦点陷阱/键盘排序/焦点归还
- 截图：`docs/audit-1.4.0/*.png`（risk-policy、automation、session-panel、panel-tree…）
- 截图与探针日志是**运行产物**，已被 `.gitignore` 忽略（`docs/audit-1.4.0/*.png`、根目录 `.look-*`/`.board`/`.gw-ready`）。仓库只留 13 张被本文点名的证据（session-panel\*、panel-detail\*、panel-tree、subagents-section、risk-policy、automation\*）；其余 45 个一次性产物（约 3.3 MB）归档在仓库外 `C:\Users\xiaoy\Desktop\Hymnix AI 1.4.0-audit-archive\`，要复现直接重跑对应探针。

运行方式：`node scripts/<name>.mjs`（Playwright + 隔离 profile）；Python 探针在 `server/` 下执行。

---

## 十一、接手后的第一件事

1. `cd desktop && pnpm check`，确认 85 项绿。
2. 打开应用（别用用户正在用的窗口）：`node scripts/panel4-probe.mjs` 或自己用 `--user-data-dir` 起。
3. 读 §1 红线，再动任何 push/release 之前先问。
4. 用户如果要继续补 DSH，按 §5 的顺序，先读 `DSH/` 对应源码再动手。
5. 交接时如果还有未推送提交，向用户明确说「本地领先远端 N 个提交，未推送」。
