# HANDOFF — Hymnix Orbit 1.4.0

写给下一个接手的人。读完这一页就能直接开工，不需要回看聊天记录。

## 1. 工作区（唯一允许改的地方）

- 路径：`C:\Users\xiaoy\Desktop\Hymnix AI 1.4.0`
- 仓库：`https://github.com/CarrisFlynn/hymnix-ai-server`（分支 `main`）
- `VERSION` 与 `desktop/package.json` 已是 **1.4.0**，后端产物名同步为 `hymnix-server-1.4.0-x64.exe`
- **`C:\Users\xiaoy\Desktop\Hymnix AI 1.3.3` 已归档，禁止再动一个字节。**

## 2. 构建与门禁

```powershell
cd 'C:\Users\xiaoy\Desktop\Hymnix AI 1.4.0\desktop'
$env:CI='true'                 # 不加会报 ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY
pnpm install                   # 首次或 node_modules 缺失时
pnpm check                     # typecheck + 单测 + 设计门禁 + build
pnpm build                     # 只构建
```

打包（需要后端 exe 与 engine jar 存在，见第 5 节）：

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
pnpm exec electron-builder --win --x64
```

## 3. 1.4.0 已完成（都已实测，不要重做）

| 项 | 位置 | 验证方式 |
|---|---|---|
| 计划视图（模型驱动） | `main.tsx` 计划标签页 + `lib/plan.js` + `todo_write` 工具 | 4 步、50% 进度、标签徽标 2/4；手动「完成」后 `done` + 1.1s + 徽标 3/4 |
| 工具循环 | `main.tsx` `streamTurn`/`runToolCall`；`main.ts` 转发 `tools`；`providers.ts` 透传 | 只读工具 + `todo_write`，最多 6 轮，审批会暂停回合并等待 |
| 审批收件箱 | 标题栏徽标 + `approvals-drawer`；`lib/*` 无关 | 危险优先排序、展开参数、批量按钮、「总是允许」写入 `hymnix.approvals.always.v1`、Esc 关闭 |
| 后台任务 | `src/main/job-center.ts` + `jobs:start|stop|list|clear` + `jobs:update|data` | 30 秒命令实时输出；取消后状态 `cancelled` 且输出冻结（进程树已杀） |
| 可改快捷键 | `lib/shortcuts.js` + 设置页编辑器 + Ctrl+/ 参考表 | 21 条命令 / 4 组；冲突提示「命令面板 已经在用这个组合键」；改为 CtrlShiftN 后持久化；重置回 CtrlN |
| 审批链路修复 | `main.ts` `tools:approve/deny` | 发 `allow`/`deny`、回传执行结果（旧代码发的判定词网关不认，从未成功过） |
| 启动闸门修复 | `gateway-lifecycle.ts` `compatibleVersion` | 旧代码只认 `1.3.x`，1.4.0 一升版本就整体报废；已改为 1.3/1.4 + 回归测试 |
| 本地能力直连 Ollama | `main.ts` `ollamaBase/ollamaModels/ollamaLoad` | 健康、模型列表/加载/卸载/删除、启动 Ollama、本地聊天不再经过网关；**杀网关进程后仍能列出 6 个模型并聊出 "pong"** |
| 两个产品真的不同 | `main.tsx` 空状态 + `surface-chip` | AI：AI 标记 / 「想让我帮你做什么？」/ 通用提示；Orbit：ORBIT 标记 / 「你在做什么？」/ 编码提示 |
| 四套接口方言 | `providers.ts` + `protocol.ts` | `ollama`/`openai`/`anthropic`/`openclaw` 全部支持工具；27 项供应商测试（含桩服务器）全绿；本地聊天走原生 `/api/chat` |
| 监控并入共享 | `main.tsx` `renderGateway` | 导航只剩 8 项；共享页内含「共享 / 监控」两段；`/v1` 视觉基线同步移除 Monitor |
| 风险确认对话框 | `main.tsx` `policyConfirm`/`alwaysAllowConfirm` | 切「完全权限」或点「总是允许」都会先弹确认（勾选后才能确认）；文案自写，未照抄参考实现 |
| #7 重启不清理 | `main.ts` `shutdownAll()` | 退出与重启共用一条清理链；重启先关网关/终端/流再 relaunch |
| #15 cloudflared 无校验 | `hymnix_main.py` | 必须配置 `cloudflared_sha256`，下载后先比 SHA-256，不匹配即放弃 |
| #17 转发头可信 | `gateway_core.py` `_ip()` | 默认不信任 CF/XFF，需显式 `trust_proxy_headers=true`（隧道用户要自己打开） |
| #18 查询串取 admin key | `_admin_key()` | 只允许 loopback 的 GET HTML 页；`/admin/*` 一律不接受 URL 里的 key |
| #19 代理头透传 | `_proxy` | 剥离 CF-*/X-Forwarded-*/Forwarded，Host 由网关自己写 |
| #25 MCP 命令注入 | `hxcore/mcp.py` | 拒绝 shell 元字符，只允许 node/npx/python/uvx 等已知运行时（6 例实测） |
| P2 加固（本轮） | 见下 | 唯一临时文件、原子写审批模式、危险命令变体、git 凭据主机校验、token 不走明文远host、预览限目录、unsubscribe 不再杀进程 |
| 更新日志本地化 | `main.ts` `changelog:get(lang)` | 中文界面读 `CHANGELOG.zh-CN.md`，正文限宽 74ch |
| 英文系统提示词修复 | `main.tsx` `CODE_MODE_PROMPT` | 英文会话不再发送字面键 |

布局修正（用户验收时提出的「显示不完整 / 错位」）：

| 问题 | 修法 |
|---|---|
| 快捷键面板贴住窗口底边、看不出还能滚 | 独立的 `.sheet-backdrop`（grid 居中 + 24px 上下留白），`max-height: min(86vh, 820px)` |
| 卡片内长列表把最后一行切一半 | 这些容器显示细滚动条（`scrollbar-width: thin` + `::-webkit-scrollbar`） |
| 计划行右侧耗时/运行中边缘逐行漂移 | 行改成 4 列固定宽 grid（22 / 1fr / 88 / 104），meta 从按钮里移出成独立列 |
| 任务行 0:03 与 exit 0 挤在一起 | 时间 44px、退出码 58px、停止 52px 固定宽右对齐 |
| 快捷键行「改键」「重置」不齐 | 列宽固定 1fr / 132 / 108 / 60，按钮宽度 100% |
| 标题栏审批徽标浮在拖拽区、点不动 | 移到窗口按钮左侧，并加 `-webkit-app-region: no-drag` |

复测脚本（Playwright 启动真实 Electron）：

```powershell
cd desktop
node scripts/verify-1.4.mjs      # 四项 UI 端到端，输出 PLAN/JOB/SHORTCUT 等断言行
node scripts/probe-align.mjs     # 行内列对齐测量（每类行的右边缘必须只有 1 个值）
node scripts/probe-clip.mjs      # 900/700/640 三档高度下，弹层是否越界
node scripts/probe-badges.mjs    # 标题栏徽标位置与可点击性
node scripts/smoke-packaged.mjs  # 打包后的 exe 冒烟（版本/任务页/计划页）
```

截图产物：`.verify-plan.png`、`.verify-plan-zoom.png`、`.verify-approvals.png`、`.verify-jobs.png`、`.verify-shortcuts.png`、`.verify-shortcut-editor.png`（仓库根目录，属临时验证物，可删）。

## 3.5 安全审计修复（2026-11-26 审计报告）

已修并实测（复现脚本在 `desktop/scripts/sec-probe2.mjs`、`plugin-poc.py`）：

| # | 问题 | 修法 | 验证 |
|---|---|---|---|
| P0-1 | 插件经 `__traceback__→tb_frame→f_globals` 逃逸 | `_FORBIDDEN_ATTRS` 补 traceback/frame/generator 帧属性 | PoC 返回 `plugin_sandbox_escape: __traceback__`，未写出文件 |
| P0-2 | `/api/%70ull`、`/api//pull` 绕过管理拦截 | 新增 `normalized_path()`（unquote+normpath），拦截用归一化路径 | 三种写法均 403 admin_only |
| P0-3 | 分块请求走私 | `_dispatch` 直接拒绝任何 `Transfer-Encoding` 并关连接 | 原始 socket 走私只得到 1 个 400 |
| P0-3b | 错误响应不读 body → 残留污染下一条 keep-alive 请求（本轮新发现） | `_json` 在 `code >= 400` 时强制 `Connection: close` | 编码路径不再出现 501 错位 |
| P0-4 | 插件工具收不到参数 | `lambda args:handler(args)` | 静态断言 + 代码审查 |
| P1-5 | 一次异常发两份 500 | 删除重复块 | 断言 `gateway internal error` 只出现 1 次 |
| P1-6 | 未装 Ollama 时点启动会崩主进程 | spawn 后挂 `error` 监听 | typecheck + 代码审查 |
| P1-8 | 空选择批量按钮 = 全批 | 空选择禁用按钮，且函数不再回退到全部 | 组件测试改写成分支断言 |
| P1-10 | 审批等 90s、网关 60s 过期 | 改 55s | 代码审查 |
| P1-11 | 中文模式改写 DOM 且不可逆 | 移除 `installAutoTranslate()` 调用，全部走 t() | 语言切换实测 |
| P1-12 | 停止回复无标记 | 无条件 `stopped: true` | 代码审查 |
| P1-13 | 固定键不参与冲突检测 | `findConflicts` 纳入 fixed；测试改为断言 Enter/Escape 冲突 | 测试通过 |
| P1-14 | 遗留 Tk 控制台绑 0.0.0.0 | 改回 127.0.0.1 | 语法检查 |
| P1-16 | README 虚假签名声明 | 改为"未签名，SmartScreen 会提示" | 文案审查 |

产物名/哈希见第 5 节。剩余 P1/P2 与 UI 语义问题（审批批量、总是允许、90 秒、停止标记、快捷键固定键、DOM 改写、重启清理、Ollama spawn 崩溃、签名声明）尚未修，见审计报告第 5-16 条。

## 4. 剩余任务（1.5 候选）

- 桌面端仍然没有 **文件 / 工具 / 日志 / OCR / Git / diff** 页面；网关接口都在（`/api/files/*`、`/api/tools`、`/admin/*`），缺的是页面。
- 工具循环目前只广告**只读**工具。写文件、跑命令要先进审批策略与沙箱设计，别直接开。
- 审批是网关侧 60 秒 TTL 的一次性授权；桌面端的「总是允许」是渲染层自动代批，不是网关持久规则。若要做成网关级策略，改 `server/hxcore/approvals.py` 的 mode，并在 UI 里说明影响面。
- 任务列表只在内存里；重开应用后历史清空。要留档就落 `app.getPath("userData")`。

## 5. 打包前检查

- `build/hymnix-orbit2-backend/hymnix-server-1.4.0-x64.exe`（PyInstaller，`pnpm build:backend`，读根目录 `VERSION` 命名）
- `engine-java/build/hymnix-engine.jar`、`cloudflared.exe`、`server/assets/hymnix-red-white-star.ico`
- 产物落在 `..\release\`（本轮已出，未签名）：
  - `Hymnix-Orbit-1.4.0-Setup.exe` — 168,179,981 B · `035cb713…c2473ba`
  - `Hymnix-Orbit-1.4.0-Portable.exe` — 155,291,265 B · `4711c047…61bc23b`
  - 校验：`release/SHA256SUMS.txt`

## 6. 设计约束（踩过的坑，别重犯）

1. **不要"只调样式"**：550C 皮肤插件的原则是 *只覆盖令牌、不重画盒子*。布局崩过多次都是因为叠加式覆盖 CSS。新样式加在文件末尾并写明作用域（1.4.0 的四个卡片就是这么加的）。
2. **主题不换**：Orbit 与 Hymnix 的差异靠功能（任务、运行、证据、工作台），不靠配色。
3. **核心能力不许依赖网关**：网关是可选的（共享、插件、工具、任务台）。健康检查、模型列表/加载、本地聊天、启动 Ollama 必须直连 Ollama（`ollamaBase()`）。任何让网关挂了就整体不可用的改动都算回退。
4. **多列表行必须用固定列宽的 grid**：每一行各自成 grid 时，列宽由该行内容决定，右边缘就会一行一个样（1.4.0 被打回两次就是这个问题）。测量方式见 `probe-align.mjs`：每类行的右边缘应该只有一个值。
5. **所有 `t()` 字符串必须有中文**，否则 `tests/components.test.mjs` 直接失败。扫描器已升级：三元分支里的文案也算（`t(a ? "Always allow" : "Always allowed")`），比较用的字面量（`"danger"`）不算。
6. **窗口尺寸断言**：`tests/protocol.test.mjs` 要求 `Math.min(1294` / `Math.min(830` 与 `minWidth: 800, minHeight: 560`。
7. **不要恢复 `renderApprovals()` 页面**：`protocol.test.mjs` 明确要求 Approvals 页保持移除，审批走抽屉。
8. 空状态不要放"占位符"文案，用户明确反感。

## 7. 版本与发布

- 1.4.0 已改齐：`VERSION`、`desktop/package.json`、`README.md` / `README.zh-CN.md` 徽章与「实际包含什么」、`CHANGELOG.md` / `CHANGELOG.zh-CN.md` 抬头、`docs/ARCHITECTURE.md`。
- 发布正文已写好：`docs/release-notes-1.4.0.md`（中英双语，`release/` 下另有一份副本；`release/` 不进版本库）。
- 发 GitHub Release 需要 **fine-grained token，Contents = Read and write**（只读会 403）。PowerShell 5.1 传中文正文必须用 `[System.Text.Encoding]::UTF8.GetBytes($json)`，否则中文段会丢。
- 本轮**没有**推送到 GitHub，也没有发 Release：只做到本地 commit + 出包。

## 8. 环境坑（遇到别慌）

| 现象 | 原因 | 处理 |
|---|---|---|
| `electron.launch: Target page ... closed` | 上一个实例占着单实例锁 | 先杀 `Hymnix*` / `electron` 进程 |
| `Downloading Electron binary...` 卡住 | 新装依赖没下 Electron | 等它下完（约 100 MB） |
| `MODULE_NOT_FOUND requireStack: []` | node_modules 不完整 | `$env:CI='true'; pnpm install` |
| PyInstaller 输出 "Build complete" 但退出码 1 | 管道截断了 stderr 尾部 | 检查 `build/hymnix-orbit2-backend/` 里 exe 是否真的生成 |
| 直接运行 `hymnix-server-*.exe` 会把命令挂住 | 它是网关服务，不接受 `--version` | 不要拿它当 CLI 探测版本 |
| 飞书多维表格读不到 DOM | 整表是 canvas 渲染 | 只能坐标点击 + 截图核对；状态下拉不吃键盘 |

## 9. 已知未做（不要假装做了）

> 飞书「需求及 Bug 管理」表由用户本人维护完毕，与本仓库进度无关，不要在交接里当作未完成项。

- 第 4 节列出的 1.5 候选全部未做。
- 1.4.0 的安装包已产出，但**没有上传、没有发 Release、没有校验和公告**。
