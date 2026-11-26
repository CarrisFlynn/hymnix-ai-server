# Changelog

Only user-visible changes are listed. Internal refactors, test scaffolding and machine-specific paths are intentionally omitted.

## 1.4.2 — 2026-11-27

The regression 1.4.1 introduced, plus two boundary issues the fifth review found.

### Fixed

- **An approved `fs.write` sent with `data`/`text` still failed.** 1.4.1 normalised the alias after the approval digest was taken, so the callback compared a digest the gateway never stored. Normalisation now happens before the digest at both layers; a real approval of `{"path","data"}` executes and returns its result.
- **The proxy-trust flag was persisted.** A crash while a tunnel ran left it `True` on disk, so a later launch trusted `CF-Connecting-IP` without a tunnel. It is runtime-only now: `_save_cfg` strips it and startup forces it off.

### Security

- **A malformed single `Content-Length`** (non-numeric) used to be read as zero and left the connection open. It is rejected with `400 invalid_content_length` and the connection closes; `_read_body` no longer silently falls back to zero.

### Housekeeping

- Removed the dead `translateText` / `ATTRS` / `observer` leftovers from `i18n.ts`.
- HANDOFF no longer claims the tool loop is read-only or that jobs are memory-only.

## 1.4.1 — 2026-11-27

Fixes from the fourth review: four defects in the code that shipped in 1.4.0, plus two request-boundary holes.

### Fixed

- **"Always allow" could silently revoke itself.** The confirm button ran a toggle, so a tool that was already auto-approved was removed from the allowlist while the current request was approved. Adding and removing are separate actions now: an allowed tool shows **Revoke always-allow** and clicking it only revokes, without deciding anything.
- **The approval row never disabled while answering.** The in-flight state was declared but never set, so a double click could decide the same request twice. It is set and cleared around the decision now.
- **Plugin handlers could run their side effects twice.** If a handler raised `TypeError`/`ValueError` after doing work, the wrapper retried it without arguments. The calling convention is decided by the signature only; exceptions propagate.
- **`automation.update()` mutated before validating.** A rejected rule left the live task half-edited. Values are validated into locals first, then applied.

### Security

- **Duplicate `Content-Length` headers** are rejected with `400 conflicting_content_length` and the connection is closed (verified with a raw socket: one response).
- **GET / HEAD / DELETE with a body** are rejected with `400 body_not_allowed`; previously the unread bytes could be parsed as the next request on a keep-alive connection.
- **`_save_cfg()` did not exist.** Tunnel code called it inside `try/except: pass`, so the forwarded-header flag never persisted; it now writes the configuration atomically.
- **Tunnel trust no longer switches on before the tunnel works.** The flag is set only after cloudflared spawns, and a failed start leaves it off.
- **`fs.write` names one contract.** `data`/`text` are normalised to `content` before validation, and the schema requires `path` + `content`, so the model no longer sees a contract it cannot satisfy.

## 1.4.0 — 2026-11-26

The six capabilities the desktop shell was missing, four provider dialects behind one composer, and three rounds of security review closed.

### Added

- **Automation.** A scheduled-prompt page: once, every N minutes, daily or weekly. When a task is due the app opens a fresh conversation and sends its prompt; missed runs collapse into a single catch-up delivery instead of replaying a backlog (the same rule-plus-next-occurrence model DSH uses).
- **Plan tab.** A fourth conversation view. Orbit publishes steps through a `todo_write` tool call and the tab renders them with live status, per-step duration and the evidence behind each step (tool calls, approvals, plan rewrites). Any step can also be marked done or skipped by hand, and the tab badge tracks `done/total`.
- **Approval inbox.** The title-bar badge (Ctrl+Shift+A) opens a drawer: pending requests sorted by risk, each row expanding its redacted arguments, batch allow/deny, and per-tool "always allow" (persisted) or "allow this session". Decisions are archived; a request that arrives while the window is in the background raises an OS notification.
- **Background jobs.** Long commands, model downloads and gateway restarts share one Jobs page: streamed output, elapsed time, exit code, and a cancel that kills the whole process tree.
- **Editable shortcuts.** Ctrl+/ opens a reference sheet; Settings → Shortcuts records a new combination inline, names the command that already owns a duplicate (fixed keys included), and stores only the changes.
- **Four provider dialects.** Native Ollama `/api/chat` (frame-by-frame streaming, structured `tool_calls`, no key), OpenAI-compatible `/v1/chat/completions`, Anthropic `/v1/messages` with `tool_use`/`tool_result` blocks, and OpenClaw with its agent header. A pasted address is recognised by shape, and all four carry tool calls.
- **Risk acknowledgements.** Turning on full access, or "always allow" for a tool, opens a dialog that names the blast radius and requires a tick.
- **Sharing carries the monitor.** Service details, connected clients and recent activity moved into the Sharing page; the rail drops to eight entries.

### Changed

- **The gateway is optional.** Health, model list, load/unload/delete, Ollama start and a local chat turn all talk to Ollama directly, so stopping the gateway no longer stops the app.
- **"Always allow" answers the request.** It now approves the pending call and remembers the preference in one action, the way DSH's approval card does; the row disables while the answer is in flight.
- **Language switching is reversible.** The DOM-rewriting translator is gone; every string goes through `t()`.
- **Docs state the truth about signing.** README and `docs/SIGNING.md` say the builds are unsigned.

### Fixed

- **A 1.4.0 build could not start its own gateway.** The readiness gate only accepted 1.3.x, so every 1.4.0 install failed with an invalid readiness record. Fixed, with a regression test.
- **Approving a tool call never worked.** The shell sent a different verdict word than the gateway accepts and parsed the reply as another shape; `fs.write` was also missing `import tempfile`, so approved writes raised an exception. The full loop now runs and returns the tool result.
- **The gateway's auto-approve branch was `if True:`**, so every tool ran unattended and the approval queue was dead code.
- **Local turns sent `reasoning_effort`**, a picked model had to be preloaded, and a tool call written as text was not recognised.
- **Starting Ollama when it is not installed** no longer takes the main process down.
- **An English session sent the literal `CODE_MODE_PROMPT` key** instead of a real system prompt.
- **The approval window was 90 s against a 60 s gateway TTL**; it is 55 s now.
- **Shortcut conflicts ignored fixed keys**; an empty batch selection approved everything; a stopped reply showed no marker; restart skipped cleanup.
- **Security (three review rounds).** Plugin sandbox escape through exception tracebacks (and `type`/`object` removed inside it); admin-API bypass through encoded paths, now decoded repeatedly with the normalised path forwarded; chunked and OPTIONS request smuggling, now rejected at the door with the connection closed; error responses that corrupted the next keep-alive request; cloudflared hashed over the whole file; forwarded headers no longer trusted by default and stripped when proxying; MCP commands limited to known runtimes with no shell metacharacters; preview restricted to the app's own folders; a token never sent over plain http to a remote host; `terminal.unsubscribe` no longer kills the process.
- **Legacy Tk console listens on `127.0.0.1`**, not `0.0.0.0`.

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
