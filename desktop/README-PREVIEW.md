# Hymnix AI 1.3.0 Cycle37 Desktop Shell Preview

PREVIEW / NOT FINAL. This is a real Electron + React shell foundation, not feature-parity completion.

Implemented: secure Electron main/preload boundary, persistent workspace navigation, conversation canvas, composer, context/status panel, responsive layout, real Python gateway health/model/SSE calls and fetch-abort cancellation.

Run from desktop/: pnpm install; pnpm typecheck; pnpm test; pnpm build. This stage is verified without launching Electron, a browser, a server GUI, an installer or any visible app. Existing Python/Tk remains authoritative. History, files, diff/artifacts, plugins, tools/approvals, terminal, monitor/tunnel, settings/themes, updater, logs/recovery and accessibility migration remain open.
