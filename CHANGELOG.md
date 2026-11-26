# Changelog

Only user-visible changes are listed. Internal refactors, test scaffolding and machine-specific paths are intentionally omitted.

## 1.4.0 — 2026-11-26

The four capabilities the desktop shell was missing, built on the contracts already in the app rather than beside them.

### Added

- **Plan tab.** A fourth conversation view. Orbit publishes steps through a `todo_write` tool call and the tab renders them with live status, per-step duration and the evidence behind each step (tool calls, approvals, plan rewrites). Any step can also be marked done or skipped by hand, and the tab badge tracks `done/total`.
- **Tool loop.** A coding turn now runs model → tool → model up to six rounds: the gateway's read-only tools (files, repository search, web fetch, calculator, clock, system info) are advertised to the model, their results are fed back, and a turn stops honestly when the model produces a final answer or the round budget runs out.
- **Approval inbox.** A title-bar badge (and Ctrl+Shift+A) opens a drawer listing every pending request, danger first: risk level, reasons, collapsible redacted arguments, age and the gateway's 60-second expiry, batch allow/deny, plus "always allow" (persisted per tool) and "allow this session". Decisions are archived and can be reviewed later; a request that arrives while the window is in the background also raises an OS notification.
- **Background jobs.** Long shell commands, model downloads and gateway restarts share one list (page: Jobs, Ctrl+Shift+J) with streamed output, elapsed time, an exit code and a cancel that kills the whole process tree. Terminal commands appear in both the terminal and the job list because they are the same process.
- **Editable shortcuts.** Ctrl+/ opens a reference sheet of every global command. Settings → Shortcuts records a new combination inline, names the command that already owns a combination instead of silently stealing it, keeps Escape and Enter locked, and stores only the overrides.

### Fixed

- **Approving a tool call never worked.** The shell posted `approve`/`deny` while the gateway decides with `allow`/`deny`, and it parsed the reply as an `id`/`decision` pair the gateway never sends. An approval now runs the tool and returns its result, so an approved call no longer has to be repeated.
- **English sessions sent `CODE_MODE_PROMPT` as their system prompt** — the literal i18n key, because the English dictionary is the key itself. The coding brief is now a real sentence with a Chinese translation.
- Plan, job and shortcut rows now share fixed column widths, so the duration, exit code and button edges line up down the list instead of drifting with each row's content.
- The shortcut sheet sits in its own scrim with equal margins, and scrollable lists inside cards show a thin scrollbar instead of slicing the last row.
- Plan and job durations no longer render as a meaningless `0ms` when a step is measured in single-digit milliseconds.

### Design pass — neutral surfaces at 14px (2026-11-25)

- All nine presets now share one neutral surface system (near-white / near-black, hairline borders, no tinted pages); the preset only changes the accent colour. Accent is reserved for primary actions, focus, the active tab and the active level badge.
- Base type is 14px, with 13px controls and 11-12px meta text; the type scale still multiplies by the text-size setting.
- Rhythm is compact and consistent: 30px rows, 8px inline padding in the rail, 10px panel padding, 1px hairlines; nothing overlaps the composer or the page content any more.
- The conversation list belongs to the Chat page: on Models, Sharing, Plugins, Settings, Monitor, Terminal, Changelog and Sponsor the list is hidden and the content takes the full width.
- Page heads are light (17px title, one muted line, actions on the right) so content gets the vertical space.

## Unreleased — Codex-style shell and a real model picker (2026-11-25)

### Changed

- The window is now three columns: a navigation rail (Hymnix AI / Orbit switch, New chat, pages), the conversation list, and the content area. The right-hand inspector is gone; model and reasoning live in the composer, telemetry in the status bar and the Context tab.
- The product switch mirrors ChatGPT / Codex: **Hymnix AI** is the general assistant, **Hymnix Orbit** is the coding agent; both share one conversation history.
- Each conversation carries three views: **Chat**, **Context** (system prompt, workspace, model, reasoning, token estimate, telemetry) and **Trace** (tool activity, approvals, recent log).
- The composer is one rounded card with attach, a tool-approval chip (ask every time / auto allow), the model chip and a circular send that becomes Stop while generating.
- The model chip opens a panel with the model list and a reasoning slider (Low / Medium / High / Max) whose gradient flows faster and hotter as it climbs; Max stays disabled until a provider declares support.
- The model list is grouped: local models, cloud providers (with their own models) and remote hosts. Unconfigured sources appear as placeholders that jump straight to the right settings page.
- Models page is organised around where replies run: **Local models**, **Cloud API**, **Remote hosts**. Cloud providers are saved profiles (vendor catalog or custom endpoint, multiple models each, optional Max support); the remote-host section carries the tunnel address, password and favourites, with the one-line explanation of what a tunnel does.
- Sharing page now only shares this computer; connecting to a friend or adding a provider moved to the Models page.
- Every page sits in the same three-column shell with a consistent page head, and content is capped at a comfortable reading width.

### Added

- A persistent status bar: connection state, current model and source, GPU / VRAM / RAM, and the active reasoning level.
- Provider registry in the gateway (`/admin/providers`: save, edit, delete, select, add/remove model, fetch models), with the API key masked and the chosen profile copied into the runtime config the chat path already used.
- A global tool-approval switch (`auto_approve_tools`, default off) shared by every conversation; auto-approved calls are still logged.

### Fixed

- The old inspector, its overlay behaviour and the chat header it duplicated are removed, so nothing covers the composer any more.
- Long page content is centred instead of drifting right, and the status bar no longer clips at 1024-1280px.

## Unreleased — 1.3.3 patch round (2026-11-25)

A hardening and repair pass over the 1.3.3 shell: the security chain in the gateway, the interaction bugs the Claude-style layout introduced, the contrast and theme defects the design gates missed, and the first visible layout work of the 2.0 plan.

### Security

- Every `/admin/*` route now authenticates before dispatch, so no handler can be published without the admin key.
- `/admin/network` no longer returns the share password in plain text; only a direct loopback caller that already proved the admin key can reveal it, and requests arriving through the public tunnel never can.
- CORS is an allowlist (`app://hymnix`, loopback pages) instead of `*`, which closes the DNS-rebinding read path.
- Share-password guessing now feeds the same ban list as API keys, and the default admin key is 144 bits instead of 48.
- Guest API keys can no longer reach model management (`/api/pull`, `/api/delete`, `/api/create`, `/api/copy`, `/api/blobs`).
- Cloud provider base URLs are validated: `http(s)` only, and link-local metadata addresses are rejected.
- The terminal no longer resolves the shell through `PATH` (`shell: true` removed), only runs inside the selected workspace, and kills the whole process tree on cancel and on quit.
- The dashboard keeps the admin key in page memory instead of `localStorage`.

### Fixed

- Unloading the model that is producing a reply no longer loops forever: the confirmation path bypasses the busy guard instead of re-opening the dialog.
- Branching from a reply stops the running stream, so tokens can no longer be appended to the new conversation.
- "Choose cache folder" uses its own picker and no longer repoints the workspace root, the file browser or the terminal.
- The tunnel Restart button really restarts; the main process used to map everything except "stop" to "start".
- Tool calls and the approval list speak the same field names as the gateway; the approval list tolerates the gateway's snake_case.
- `/health` actually fills its five-second cache; the assignment used to sit after an unconditional return.
- Conversation cleanup archives first and truncates second, and both writes are atomic.
- Diff application writes through a temp file and `os.replace`, so an interrupted write cannot truncate a source file.
- Daily quota set in the config now reaches the headless gateway, so the 429 limit works in the desktop build.
- Plugins: a dunder-attribute block stops the `__subclasses__` escape, and a trace-hook deadline actually interrupts runaway plugin code instead of merely abandoning the wait.

### Appearance and layout

- Soften accent no longer references its own custom property (which wiped the background off every primary button, switch, badge and progress bar); it now desaturates towards the theme's text colour and stays above 4.5:1.
- First launch no longer flashes white: the theme bootstrap is a blocking classic script, and the window is created with the last resolved background colour.
- Auto appearance is reachable again from Settings (Light / Dark / Auto), and choosing a theme of the other mode still wins explicitly.
- Light / Dark / Auto, text size, density and reduce-motion now apply before the first paint, so the layout no longer reflows on boot.
- The close-button hover, the terminal SYS/WRN/ERR tags, the tonal button hover and the error-panel icon meet WCAG AA in all nine themes.
- The chat inspector becomes a drawer that reserves its own width below 1280 px instead of covering the composer and the last replies.
- Below 1023 px the sidebar is a clean icon rail: labels are removed instead of wrapping into vertical columns.
- The composer shows the current model and reasoning effort as chips, so neither lives only in the inspector.
- A stopped reply keeps what arrived and shows "Stopped" with Retry.
- The Windows text face is used throughout; the duplicated, unreachable Inter and duplicate mono weights (240 KB of dead payload) are gone.
- Two unreachable 680 px media queries were retargeted to the reachable 860 px band.

### Added

- A real in-app update check (Settings → About) that reads the latest GitHub release and compares versions.
- Guests can disconnect and return to local mode from Sharing & connections.

### Tooling

- The contrast gate now checks 31 pairs per theme, including the console tags, the close-button hover, the tonal hover and pressed states, and parses `color-mix()` with real sRGB interpolation.
- The token gate also rejects named colours (`white`, `black`), which is how a hard-coded close-button label slipped through.
- Visual baselines regenerated for all nine themes.

## 1.3.3 — 2026-11-24

### Added

- Phase 0 of the 2.0 redesign: one semantic token layer (`--bg`, `--text`, `--accent-fill`, status and console tokens), one theme file per preset, and locally bundled Inter and JetBrains Mono (no CDN).
- Three new themes: Ink green (墨绿 on ivory), Honey crimson (crimson on honey) and Graphite gold (metallic gold on graphite). Nine presets in total; each one declares its light or dark mode.
- Theme files are wired into a dedicated theme manager, so the theme picker lists all nine presets and remembers the choice.
- Rebuilt the workspace shell with a collapsible sidebar, a responsive chat inspector and a consistent flat component style.
- One component language across the app: six button levels, chips and status pills, hover and focus tooltips with the keyboard hint, and skeleton rows while a list loads.
- The model picker is a searchable combobox that marks which models fit your GPU.
- Sharing shows a password strength meter, a QR code for the public link that is generated on this device, and the list of people connected with a one-click disconnect.
- Connect to a friend now diagnoses the failure in plain language (wrong password, unreachable host, version mismatch) and keeps favourites for the hosts you use often. Admin and cloud keys are stored in the Windows credential vault instead of a plain JSON file.
- Chat reports token speed while generating and per reply, can branch a new conversation from any reply, and keeps the partial answer when the connection drops with an inline Retry.
- Attach files by button, drag and drop, or paste; attachments show as removable chips.
- Slash commands in the composer: /model, /clear, /export and /system.
- Code blocks can wrap and save as a file.
- Downloads check free disk space before starting, notify you when they finish, and show a progress ring in the sidebar.
- A three-step first-run card walks from starting the model service to downloading a model and sending the first message.
- Settings gained a per-section Reset to default, `Restart needed` chips with a sticky restart bar, and an autosave confirmation.
- A "What's new" card appears once per version.
- **One chat core, three wire protocols**: alongside the existing OpenAI-compatible path, Hymnix now speaks **Anthropic's Messages API (what Claude Code uses)** and an **OpenClaw gateway**. Pick the protocol in Sharing & connections -> API providers; each one brings its own default address and model name.
- Anthropic: requests go to `POST /v1/messages` with `anthropic-version: 2023-06-01` and `x-api-key`. System prompts move to the top-level field, consecutive same-role turns are merged, `thinking_delta` maps onto the existing reasoning pane, and `max_tokens` is configurable per provider.
- OpenClaw: defaults to `http://127.0.0.1:18789`, writes the model field as `openclaw/<agent>` and sends `x-openclaw-agent-id`. An agent name can be set on its own; otherwise `openclaw/default` is used. When the endpoint is disabled the app names the config key that turns it on.
- All three protocols share one streaming event shape: text, reasoning and errors are normalised in the main process, so the UI and the chat pipeline stay protocol-agnostic.
- "Fetch models" reads the provider's model list with the right headers and shows the ids as clickable chips; "Test" lists models first and falls back to a one-token probe, reporting round-trip time.
- The chat page now follows the Claude arrangement: conversation and composer share a centred 760px reading column, a new session stacks heading, composer and example prompts down the middle, and the right-hand inspector starts collapsed behind "Chat settings".
- The composer gained a Chat / Code switch: code mode injects a coding-agent prompt (state paths and minimal diffs, confirm destructive work first) while every other control - attachments, slash commands, stop, token speed - behaves identically in both modes.
- Added Light, Dark and Auto appearance, live theme previews, spacing density, text scaling and reduced-motion controls.
- Conversations autosave into searchable history with pin, delete and undo; messages support copy, edit and resend, regenerate, and turn deletion.
- Chat and management screens now show explicit service/setup states, with focused model, sharing and monitoring views.
- Added a desktop plugin center backed by the isolated gateway plugin manager; new installs remain disabled until permissions are reviewed.
- Revoking a granted plugin permission unloads and disables that plugin immediately.
- Wired Files and Logs navigation to their existing screens and made the native window background follow the selected appearance mode.

### Changed

- The sidebar follows the Codex and Claude arrangement: new chat, workspace and page navigation at the top, recent conversations below them taking the remaining height. One scroll column, and labels no longer sit on top of conversation rows.
- Your messages are right-aligned bubbles; replies are left-aligned body text without the two large avatars.
- Appearance lost the light/dark/auto switch and the hover preview: clicking a theme card switches to it, thumbnails use each theme's real colours, and one card per row is selected.
- The composer no longer duplicates the model and reasoning pickers, which live in the right-hand panel.
- Collapsing the sidebar now leaves only centred icons instead of stacked or clipped labels.
- Removed every search box (title bar, sidebar, chat header, settings) and the command palette.
- The empty-state mark is the original star again, without the circle plate and orbit rings added earlier.
- UI text uses the Windows text face and sits about 1px larger, which reads better at these sizes.
- Sidebar conversations follow the Claude and ChatGPT pattern: one single scroll column with single-line titles, instead of a small nested scrollbox that clipped rows. The workspace selector is a quiet row, and the footer stays pinned.
- Text scaling stays usable up to 150% and long labels wrap instead of clipping; touch targets grow to 44px on touch screens.
- Chat completion is announced once to screen readers instead of on every token, and reduced-motion and forced-colors settings are respected throughout.
- The six existing presets keep their 1.3.2 values through a compatibility layer, so this release changes no existing colours.
- The main list now carries only pages that do real work: Chat, Models, Sharing & connections, Plugins, Changelog and Sponsor, plus Monitor and Terminal for developers. Files, Tools and Approvals are gone.
- Monitor and Terminal are no longer folded into a collapsible developer group; they are always visible.
- The help menu is gone: Changelog and Sponsor sit in the main list, and the shortcut list stays in Settings.
- Every page has a Back control (Alt+← works too) that returns to the page you came from.
- Text size finally scales type instead of only spacing: a label at 100% is 12px, at 130% it is 15.6px. The range is capped at 150%.
- Startup and runtime keeps three switches: client beta, run at system startup, start in fullscreen.
- The cache and data folders show their real paths with an Open folder button, and "How to open previews" became "File preview" with a clearer pair of choices.

### Fixed

- The status pill no longer clips its label or leaves a sliver beside it: the header and connection bar wrap below 1360 px instead of cutting pills.
- Fixed a stray brace left by the theme migration that broke the stylesheet build.
- Both theme rows could show a tick at the same time. Only the active theme is ticked now: choosing a light theme clears the dark row and vice versa.

### Tooling

- The token contract is enforced: a design-token check fails the build on any hard-coded colour in component CSS, and a WCAG AA contrast check covers 21 pairs in each of the nine themes.
- A component gallery (`Settings > Component gallery`) renders every component in every state, and a Playwright baseline captures every page in every theme (135 images) for visual diffs.
- The terminal command hint is no longer clipped at the bottom edge.
- The switch off-state is visible again with a stronger track colour.

## 1.3.2 — 2026-11-20

### Added

- Two color themes: **Deep sea blue** (navy #122E8A on soft cream #F5EFEA) replaces Daylight as the light theme, and **Neon black** (electric green #00FE92 on a true black canvas) is a high-contrast dark theme. Six presets in total; a saved theme that no longer exists falls back to the default.
- Chat follows streaming replies while you stay at the bottom, keeps your reading position when you scroll up, and offers a button back to the latest reply. The turn markers on the right jump to a turn and bold the active one.
- Local Ollama downloads show live progress and speed, and can be paused, resumed, or canceled. Resuming continues from the data Ollama kept; canceling and pulling again starts a fresh request.
- The expanded Ollama catalog filters by publisher, license, download size, and estimated GPU memory, and searches by name or publisher.
- Experimental: the built-in terminal accepts reply text pushed by a local script over a loopback-only endpoint with a rotating token. The app only displays that text in the terminal. It does not forward it to a model, and it does not read or control the third-party client that produced it.

### Changed

- Closing the Windows desktop app stops the background gateway and the other processes the app started, so nothing keeps running after exit.
- The Windows installer closes the previous installation and its leftover gateway before upgrading, without touching an Ollama you launched yourself.
- Ollama can be started from the app. An Ollama started separately afterwards is picked up automatically instead of requiring an app restart.

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
