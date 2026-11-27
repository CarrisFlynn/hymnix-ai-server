## Hymnix Orbit 1.5.0

Where the work happens is the theme of this release. The model can stay anywhere; the tools now belong to the machine that owns the files; and the terminal is a real terminal.

### The terminal is a real terminal

The terminal page looks the same and gains two tabs. **COMMAND** is the line console you already had. **TERMINAL** is a genuine PTY through node-pty's ConPTY prebuilds — 147x33, real cursor, real raw keys, real TUI programs.

The launcher list is discovered, not assumed: **Hymnix Agent**, PowerShell, Claude Code, Codex, Gemini, Ollama and Git Bash, each marked available or not on your machine.

**Hymnix Agent** is this app's own kernel in CLI form. It carries no tools and no provider logic; a loopback bridge with a fresh token per run owns both, so the model can be local, a cloud API, or a model another machine shares, without the CLI knowing the difference. Dangerous tools ask `y/N` right in the terminal.

Node is bundled with the app. A PTY child cannot run Electron as node (ConPTY ignores the flag and the process produces no output), and asking every user to install Node first would be a trap.

### Tools belong to the machine that owns the files

All 22 file, patch, repository, command, terminal and fetch tools moved from the Python gateway into the main process. They answer with the gateway stopped — which is the normal case, because the gateway exists for sharing only.

The boundaries came with them, not just the features: paths resolve through realpath before the containment test, so a junction cannot walk out of the workspace; `web.fetch` refuses private destinations including IPv4-mapped IPv6 addresses and pins the checked address to the connection; a timed-out command is killed as a whole process tree; console bytes are decoded with the console code page.

### Sharing: the model is here, the hands are yours

When machine A shares a model, A provides compute and B runs the tools on its own machine. `/api/tools` and `/api/files` therefore refuse anything that is not a naked loopback call, so a guest cannot ask the host to read the host's own disk.

A shared session switches to Orbit at once and cannot switch back; disconnecting restores what you had.

`POST /v1/messages` speaks Anthropic Messages, so Claude Code or an Anthropic SDK can use a shared model directly. Reasoning arrives as a thinking block. The endpoint counts failed keys toward the ban, honours the daily quota, and answers malformed bodies with 400 instead of 500.

### Fixed

- A self-referencing CSS custom property made the terminal's foreground token invalid, so the selected tab's label was invisible.
- The gateway version allow-list did not include 1.5, which would have made the app refuse its own backend.
- node-pty prebuilds ship unpacked, and the bundled language server ships as an archive that is unpacked on first use, because the packager drops every `node_modules` directory it finds.
- PTY sessions and the agent bridge are closed on quit; a failed atomic write no longer leaves a copy of the file behind.

### Verification

- 147 JavaScript tests and 14 Python tests; typecheck; design tokens; 279/279 contrast pairs across 9 themes.
- The packaged artifact was launched and checked: it boots, ships no dev hook, renders its shell, lists Hymnix Agent as available, and runs the agent with the bundled Node.

### Install

Download `Hymnix-Orbit-1.5.0-Setup.exe` (installer) or `Hymnix-Orbit-1.5.0-Portable.exe` (no install). SHA-256 digests are in `SHA256SUMS.txt`.

The backend gateway is 1.5.0 as well; the desktop accepts 1.3, 1.4 and 1.5 backends, so an older one still works if you keep it.
