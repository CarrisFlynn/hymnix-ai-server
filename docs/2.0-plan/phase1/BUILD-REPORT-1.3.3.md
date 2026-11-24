# Hymnix Orbit 1.3.3 打包与验证报告

日期：2026-11-25
覆盖两轮：正式安装包（替换上一版只交付 ZIP 的做法）与随后按反馈做的界面修订。

## 交付产物

全部位于 `release/`：

| 文件 | 大小 | SHA-256 |
| --- | --- | --- |
| `Hymnix-Orbit-1.3.3-Setup.exe` | 168,150,678 B | `7ce41309d3b999e89c5377b9445ab8ac62260c50dee77a3b7441a25d6e43b2c7` |
| `Hymnix-Orbit-1.3.3-Portable.exe` | 155,262,882 B | `37b44709b0c16b7f55d1a81fb0a7bb0226f1f2866756a960703d522324c10bf4` |
| `Hymnix-Orbit-1.3.3-Setup.exe.blockmap` | 177 KB | — |

安装器为 NSIS（可选安装目录、中英文安装界面、桌面与开始菜单快捷方式），便携版为单文件自解压。免安装运行可用 `build/stage-1.3.3e/win-unpacked/Hymnix Orbit.exe`。

## 构建链

1. `pnpm build`：tsc + Vite 生产构建 + 重写 `index.html` 脚本标签。
2. PyInstaller 6.19.0（Python 3.14）：`server/hymnix-server.spec` → `build/hymnix-orbit2-backend/hymnix-server-1.3.3-x64.exe`，以 `backend-gateway-headless.exe` 进入 resources。
3. electron-builder 26.18.0，electron 45.3.3，win x64，target = nsis + portable。

> 默认 `python`（3.13）没有 PyInstaller，需用 `py -3.14 -m PyInstaller`；`pnpm dist` 的 `build:backend` 仍写死 `python`。
> 若输出目录已存在 `win-unpacked`，宿主安全策略会以「批量删除」中断 electron-builder，改为输出到全新目录即可。

## 本轮界面修订（按反馈逐条）

| 反馈 | 处理 |
| --- | --- |
| 右侧已有模型与推理强度，输入框里的两个下拉多余 | 删除输入框内的模型选择与推理强度下拉，仅保留附件、输入、发送 |
| 用户消息应在右侧 | 用户消息改为右对齐气泡（强调色底、圆角、右下角时间）；助手回复改为左对齐正文，去掉左右两个大头像 |
| 侧栏历史对话错位、分级混乱 | 侧栏改为「新建对话 → 工作区 → 页面导航 → 最近会话 → 底部」，最近会话占据剩余高度并靠下；整栏单一滚动，标签与会话行不再互相压字 |
| 鼠标悬停预览无意义 | 删除主题卡片的 hover/focus 整页预览 |
| 浅色/深色/自动多余 | 删除外观模式开关；点主题卡片直接切换到该主题，每行单选，缩略图使用各主题真实配色 |
| 搜索框多余，且有两个 | 删除标题栏、侧栏、聊天头部、设置页四处搜索入口与命令面板 |
| 字体过小、难辨认 | 界面字体换成 Windows 原生文字字体（Segoe UI Variable Text / 微软雅黑），正文 13→14px，组件小字号整体 +1 |
| 折叠侧栏一团糟 | 折叠后固定 60px，仅居中图标；隐藏文字、快捷键、副标、状态文案，菜单向右弹出 |
| 自创的圆环标识 | 删除圆形底板与两道轨道环，恢复原始星标 |

附带清理：移除输入框上方重复的「复制上一条回复 / 清空 / 导出」工具条（⋯ 菜单已有同样功能），并把底部状态行并入「连接」行，缩短底栏高度。

## 验证

- TypeScript 类型检查：通过。
- 桌面端测试：25/25 通过（含中文字案完整性与主题色板一致性）。
- 设计令牌检查：4 个组件样式表仅使用语义令牌；主题对比度 189/189（9 主题 × 21 对，WCAG AA）。
- 视觉基线：135 张（15 页 × 9 主题）已重拍；基线启动前会重置侧栏折叠等本地状态，避免上一次运行的状态混进截图。
- 打包产物真实启动（CDP 连入 `win-unpacked/Hymnix Orbit.exe`）核对：搜索框 0 个、输入框下拉 0 个、用户消息右对齐（距内容区右缘 72px）、侧栏顺序为 brand/new/workspace/nav/recent/footer、正文 14px、字体为 Segoe UI Variable Text。

## 已知限制

- **未做代码签名**：安装器与主程序未签名，SmartScreen 首次运行会提示「未知发布者」。
- **未做真机矩阵**：只在当前机器验证启动与渲染，多分辨率、多 DPI、干净虚拟机安装未测。1080×675 这类矮窗口下侧栏需要滚动才能看到底部的设置/连接，这是把空间让给会话列表的取舍。
- **`window.__hymnixDev` 仍在正式包中暴露**（`navigate` / `applyTheme` / `dismissOverlays`），视觉基线依赖它，后续应改为构建期开关。
- 参考布局里的「助手 / 专家 / 资料库」等条目没有照抄，侧栏仍使用本项目自己的导航项。
