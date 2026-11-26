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
| 英文系统提示词修复 | `main.tsx` `CODE_MODE_PROMPT` | 英文会话不再发送字面键 |

复测脚本（Playwright 启动真实 Electron）：

```powershell
cd desktop
node scripts/verify-1.4.mjs      # 四项 UI 端到端，输出 PLAN/JOB/SHORTCUT 等断言行
```

截图产物：`.verify-plan.png`、`.verify-plan-zoom.png`、`.verify-approvals.png`、`.verify-jobs.png`、`.verify-shortcuts.png`、`.verify-shortcut-editor.png`（仓库根目录，属临时验证物，可删）。

## 4. 剩余任务（1.5 候选）

- 桌面端仍然没有 **文件 / 工具 / 日志 / OCR / Git / diff** 页面；网关接口都在（`/api/files/*`、`/api/tools`、`/admin/*`），缺的是页面。
- 工具循环目前只广告**只读**工具。写文件、跑命令要先进审批策略与沙箱设计，别直接开。
- 审批是网关侧 60 秒 TTL 的一次性授权；桌面端的「总是允许」是渲染层自动代批，不是网关持久规则。若要做成网关级策略，改 `server/hxcore/approvals.py` 的 mode，并在 UI 里说明影响面。
- 任务列表只在内存里；重开应用后历史清空。要留档就落 `app.getPath("userData")`。

## 5. 打包前检查

- `build/hymnix-orbit2-backend/hymnix-server-1.4.0-x64.exe`（PyInstaller，`pnpm build:backend`，读根目录 `VERSION` 命名）
- `engine-java/build/hymnix-engine.jar`、`cloudflared.exe`、`server/assets/hymnix-red-white-star.ico`
- 产物落在 `..\release\`（本轮已出，未签名）：
  - `Hymnix-Orbit-1.4.0-Setup.exe` — 168,162,430 B · `07e7f707…34d7319`
  - `Hymnix-Orbit-1.4.0-Portable.exe` — 155,282,294 B · `c6b11890…e5e7ac45`
  - `Hymnix-Orbit-1.4.0-Setup.exe.blockmap` — 177,054 B
  - 校验：`release/SHA256SUMS.txt`
- 打包后的 exe 已冒烟验证（`desktop/scripts/smoke-packaged.mjs`）：版本 1.4.0、导航有「任务」、对话有「计划」页。

## 6. 设计约束（踩过的坑，别重犯）

1. **不要"只调样式"**：550C 皮肤插件的原则是 *只覆盖令牌、不重画盒子*。布局崩过多次都是因为叠加式覆盖 CSS。新样式加在文件末尾并写明作用域（1.4.0 的四个卡片就是这么加的）。
2. **主题不换**：Orbit 与 Hymnix 的差异靠功能（任务、运行、证据、工作台），不靠配色。
3. **所有 `t()` 字符串必须有中文**，否则 `tests/components.test.mjs` 直接失败。扫描器已升级：三元分支里的文案也算（`t(a ? "Always allow" : "Always allowed")`），比较用的字面量（`"danger"`）不算。
4. **窗口尺寸断言**：`tests/protocol.test.mjs` 要求 `Math.min(1294` / `Math.min(830` 与 `minWidth: 800, minHeight: 560`。
5. **不要恢复 `renderApprovals()` 页面**：`protocol.test.mjs` 明确要求 Approvals 页保持移除，审批走抽屉。
6. 空状态不要放"占位符"文案，用户明确反感。

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
