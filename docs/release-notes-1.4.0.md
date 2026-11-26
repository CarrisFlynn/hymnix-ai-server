# Hymnix Orbit 1.4.0

## 中文

1.4.0 补上桌面端缺的四件事，并修好一条从来没通过的链路。

**计划**
对话页新增第四个标签「计划」。Orbit 通过 `todo_write` 工具调用发布步骤，界面显示实时状态、每步耗时，以及每一步背后的证据（调用过哪些工具、等你审批了多久、计划被重写过几次）。任何一步也可以由你手动标记完成或跳过。

**审批收件箱**
标题栏的徽标（Ctrl+Shift+A）打开右侧抽屉：待审批按危险等级排序，每条都能展开脱敏参数，支持批量允许 / 拒绝，也可以对某个工具选择「总是允许」（会持久化）或「本次会话允许」。处理过的记录会归档；窗口在后台时新到的审批会发系统通知。

**后台任务**
长命令、模型下载、网关重启统一进「任务」页：实时输出、耗时、退出码，取消会清掉整棵进程树。终端里跑的命令同时出现在这里——它们本来就是同一个进程。

**可改快捷键**
Ctrl+/ 打开全部全局命令的参考表。设置 → 快捷键 可以就地录制新组合；重复的组合会告诉你已经被哪条命令占用；Escape 与 Enter 保持锁定；只保存改动。

**修复**
- 桌面端审批此前从未真正生效：发出的判定词和网关期望的不一致，返回体也按另一种形状解析。现在「允许」会直接执行工具并带回结果。
- 英文界面会把 `CODE_MODE_PROMPT` 这个字面键当成系统提示词发出去，现在是真正的英文提示词，并配了中文翻译。

## English

1.4.0 closes the four gaps that kept the desktop shell a viewer, and repairs one path that never worked.

**Plan**
A fourth conversation tab. Orbit publishes its steps through a `todo_write` tool call; the shell shows live status, per-step duration and the evidence behind each step — which tools ran, how long an approval waited, how often the plan was rewritten. Any step can also be closed or skipped by hand.

**Approval inbox**
The title-bar badge (Ctrl+Shift+A) opens a drawer: pending requests sorted by risk, each row expanding its redacted arguments, with batch allow/deny plus per-tool "always allow" (persisted) or "allow this session". Decisions are archived, and a request that arrives while the window is in the background raises an OS notification.

**Background jobs**
Long commands, model downloads and gateway restarts share one Jobs page: streamed output, elapsed time, exit code, and a cancel that kills the whole process tree. Terminal commands show up here too — they are the same process.

**Editable shortcuts**
Ctrl+/ opens a reference sheet of every global command. Settings → Shortcuts records a new combination inline; a duplicate names the command that already owns it; Escape and Enter stay locked; only the changes are stored.

**Fixes**
- Approving a tool call from the desktop never worked: the shell sent a different verdict word than the gateway accepts and parsed its reply as another shape. "Allow" now runs the tool and returns its result.
- An English session used to send the literal `CODE_MODE_PROMPT` key as its system prompt. It is now a real English brief with a Chinese translation.

## 安装 / Install

- `Hymnix-Orbit-1.4.0-Setup.exe` — Windows x64 安装版（中英文安装界面）
- `Hymnix-Orbit-1.4.0-Portable.exe` — 免安装单文件
- 校验：`SHA256SUMS.txt`
