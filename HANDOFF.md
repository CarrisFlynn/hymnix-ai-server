# HANDOFF — Hymnix Orbit 1.4.0

写给下一个接手的人。读完这一页就能直接开工，不需要回看聊天记录。

## 1. 工作区（唯一允许改的地方）

- 路径：`C:\Users\xiaoy\Desktop\Hymnix AI 1.4.0`
- 仓库：`https://github.com/CarrisFlynn/hymnix-ai-server`（分支 `main`）
- 当前 HEAD：`454447b`，工作区干净
- `VERSION` 仍是 **1.3.3**（1.4.0 版本号还没有升，见第 6 节）
- **`C:\Users\xiaoy\Desktop\Hymnix AI 1.3.3` 已归档，禁止再动一个字节。**

## 2. 构建与门禁

```powershell
cd 'C:\Users\xiaoy\Desktop\Hymnix AI 1.4.0\desktop'
$env:CI='true'                 # 不加会报 ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY
pnpm install                   # 首次或 node_modules 缺失时
pnpm check                     # typecheck + 单测 + 设计门禁 + build
pnpm build                     # 只构建
```

打包：

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
pnpm exec electron-builder --win --x64
```

产物在 `..\release\`。本轮已出：Setup 137,579,196 B / Portable 124,926,488 B（文件名仍是 1.3.3）。

## 3. 本轮已完成（都已验证，不要重做）

| 项 | 位置 | 验证方式 |
|---|---|---|
| 会话排序稳定 | `main.tsx`：`movedAt` 字段、保存改原地替换、侧栏 `orderAt = movedAt \|\| createdAt` | 点开会话前后数组顺序与 DOM 顺序一致 |
| 模型面板不被裁断 | `orbit-v2.css`：`.model-panel` 贴 `bottom: calc(100% + 8px)`，`max-height: min(58vh,440px)` | 900/700/640 三档 `clipped:false` |
| 删除对话 + 真撤销 | `main.tsx` `deleteSession()` + `⋯` 菜单「删除对话」 | 删除后撤销，会话内容与标题一起回来 |
| Ctrl+K 命令面板 | `main.tsx` `paletteOpen` / `.palette-*` CSS | 页面跳转、新建、删除可用 |
| 空状态任务台 | `main.tsx` `orbit-board` 块 + CSS | 实测 760×344，3 任务卡 + 4 动作卡 |
| 安全批次（1.3.3 时代，已进 1.4.0） | `server/hxcore/plugins.py`、`plugin_index.py`、`gateway_core.py` | 恶意插件加载返回 `plugin_sandbox_escape: _os` |

## 4. 剩余任务（按顺序做，这是 1.4.0 的核心）

### A. 计划视图（最高优先）
- 位置：对话页第二排标签（与 对话/上下文/轨迹 并列），新增「计划」。
- 数据模型建议：`Plan { id, taskId, steps: [{ id, intent, status: queued|running|done|failed|skipped, evidenceIds[] }] }`
- 先做纯前端状态（组件内 state），再接 IPC；UI 用现有 `.orbit-*` 视觉语言。
- 验收：能显示 3-5 步、能标记完成/跳过、能显示每步耗时。

### B. 审批收件箱
- 现有：Trace 标签里已渲染 `approvals`（`tool` / `risk` / `argsRedacted`）。
- 要做：侧栏或头部「待审批 N」徽标、逐条展开参数、批量允许/拒绝、处理后从列表移除。
- IPC 已有 `approvals:list|decide`，不要新造协议。

### C. 后台任务面板
- 需要：主进程执行长命令、流式 stdout、可取消（已有 `killProcessTree`）。
- 建议 IPC：`jobs:start|stop|list`，事件 `jobs:data`。
- 验收：跑一条 30 秒命令，能看到实时输出，点取消后子进程树被清掉。

### D. 快捷键设置页
- 设置里新增一节：列出当前快捷键（Ctrl+K 命令面板、Alt+← 返回、Enter 发送…），支持改键与冲突检测。
- 校验：同一组合键不允许绑定两次。

## 5. 设计约束（踩过的坑，别重犯）

1. **不要"只调样式"**：550C 皮肤插件的原则是 *只覆盖令牌、不重画盒子*。本项目的布局崩过多次都是因为叠加式覆盖 CSS。新样式优先加在 `orbit-v2.css` 末尾并写明作用域。
2. **主题不换**：Orbit 与 Hymnix 的差异靠功能（任务、运行、证据、工作台），不靠配色。
3. **所有 `t()` 字符串必须有中文**，否则 `tests/components.test.mjs` 直接失败（本轮就因此红过一次）。
4. **窗口尺寸断言**：`tests/protocol.test.mjs` 要求 `Math.min(1294` / `Math.min(830` 与 `minWidth: 800, minHeight: 560`。
5. 空状态不要放"占位符"文案，用户明确反感。

## 6. 版本与发布

- 升 1.4.0 要一起改：`VERSION`、`desktop/package.json` version、安装包产物名、README 徽章、CHANGELOG 抬头。
- GitHub Release 已发 `v1.3.3`（4 个附件：Setup / Portable / blockmap / SHA256SUMS），正文中英双语在 `release/release-notes-1.3.3.md`。
- 发新版需要 **fine-grained token，Contents = Read and write**；只读会 403。PowerShell 5.1 传中文正文必须用 `[System.Text.Encoding]::UTF8.GetBytes($json)`，否则中文段会丢。

## 7. 环境坑（遇到别慌）

| 现象 | 原因 | 处理 |
|---|---|---|
| `electron.launch: Target page ... closed` | 上一个实例占着单实例锁 | 先杀 `Hymnix*` / `electron` 进程 |
| `Downloading Electron binary...` 卡住 | 新装依赖没下 Electron | 等它下完（约 100 MB） |
| `MODULE_NOT_FOUND requireStack: []` | node_modules 不完整 | `$env:CI='true'; pnpm install` |
| 飞书多维表格读不到 DOM | 整表是 canvas 渲染 | 只能坐标点击 + 截图核对；状态下拉不吃键盘 |

## 8. 已知未做（不要假装做了）

- 计划视图、审批收件箱、后台任务面板、快捷键页（第 4 节的 A-D）
- VERSION 升 1.4.0
- 飞书「需求及 Bug 管理」表：只写了第 31 条，负责人列处于隐藏状态，其余 15 条未加
