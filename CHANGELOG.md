# Changelog

Only user-visible changes are listed. Internal refactors, test scaffolding and machine-specific paths are intentionally omitted.

## 1.3.0 — 2026-11-17

### Added

- Integrated host/guest mode: one app can host a model server for friends or connect to a friend’s machine.
- Share identity: host name, share password, and a public tunnel with a one-click start, restart and ready state.
- Connection screen: address, share name and connection password; model list and chat follow the connected machine.
- Cloud API as a second chat source, with saved endpoint, model and key (key is masked after saving).
- Downloadable model catalog (30+ entries) with search, next to the installed model list.
- Terminal console: status strip, live tunnel log, and commands for status, models, loading, tunnel control, hardware info and gateway config.
- Chat: markdown rendering, code blocks with copy, and a collapsible thinking-process panel for reasoning models.
- Right control panel: model picker, reasoning effort, conversation save/load/export, GPU, VRAM, AI and RAM telemetry.
- In-app preview pane (Chromium) for local files and URLs, or open in the default browser instead.
- Settings: beta channel flag, run at startup, fullscreen start, display scaling, smooth scrolling, GPU acceleration, cache location and preview mode.
- Star banner linking to the repository.

### Changed

- Window uses a custom title bar; the native menu bar is removed.
- Gateway tab is now a first-class page instead of being buried in settings.
- History shows saved conversations rather than gateway request logs.
- The “Logs” page was replaced by this changelog.
- Language switching now also covers theme names and settings labels.

### Fixed

- Enter sends the message; Shift+Enter inserts a newline.
- The model no longer receives an injected timestamp, so a plain greeting is answered as a greeting.
- The tunnel cannot start without a share password, and its state stays consistent with the buttons.
- Ollama can be started from the UI when the model service is offline.
- Status dots render at the intended size.
- Sponsor and mail links open correctly, and e-mail addresses copy to the clipboard.

### Removed

- Empty placeholder pages (projects, files, tools, approvals, plugins) are no longer in the navigation.
- The unused settings tab strip was removed.

## 1.2.0

- 17 pages in a single window, bubble chat with avatars, code copy, terminal console with status strips.
- Five languages, 418 translation keys.

## 1.1.0

- First public build with the local gateway and local model support.

---

# 更新日志（中文）

只列用户能感知的改动；内部重构、测试脚手架和本机路径不在此列出。

## 1.3.0 — 2026-11-17

### 新增

- 主机 / 访客一体化：同一个应用既能给朋友当模型服务端，也能连朋友的机器。
- 共享身份：共享名称、共享密码，以及一键启动、重启、显示就绪状态的公网隧道。
- 连接界面：地址、共享名称、连接密码；连上后模型列表和对话都跟着对方机器走。
- 云端 API 作为第二种对话来源，可保存地址、模型和密钥（保存后密钥打码）。
- 可下载模型清单（30+ 条）带搜索，与已安装列表分开显示。
- 终端控制台：状态条、隧道实时日志，以及 status、models、加载、隧道控制、硬件信息、网关配置等命令。
- 对话：Markdown 渲染、代码块复制、推理模型的思考过程折叠面板。
- 右侧控制栏：模型选择、推理强度、对话保存/加载/导出、GPU / VRAM / AI / RAM 遥测。
- 应用内预览（Chromium）可打开本地文件与网址，也可以改为默认浏览器打开。
- 设置：客户端测试标志、开机启动、全屏启动、显示缩放、平滑滚动、GPU 加速、缓存位置、预览方式。
- 指向仓库的 Star 横幅。

### 改进

- 窗口改为自绘标题栏，去掉原生菜单栏。
- 网关连接从设置里独立出来，成为一级页面。
- 历史页改为保存的对话记录，不再是网关请求日志。
- 原来的“日志”页替换为本更新日志。
- 切换语言时，主题名称与设置标签也会跟着切换。

### 修复

- 回车发送，Shift+回车换行。
- 不再给模型注入时间戳，问“你好”就只是打招呼。
- 没有共享密码时隧道拒绝启动，按钮状态与实际状态一致。
- 模型服务未启动时可从界面一键启动 Ollama。
- 状态圆点尺寸恢复正常。
- 赞助与邮件链接可正常打开，邮箱地址点击复制。

### 移除

- 导航里删掉空占位页（项目、文件、工具、审批、插件）。
- 删掉没有实际作用的设置标签条。
