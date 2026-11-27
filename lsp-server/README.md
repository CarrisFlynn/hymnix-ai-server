# Bundled language server

`typescript-language-server` plus the **JavaScript** TypeScript 5 it drives.

The app itself compiles with TypeScript 7 (the native Go port, `tsgo`), which does
not ship the `tsserver` that `typescript-language-server` spawns. Installing both
into the app's own tree therefore produced a server that completed the LSP
handshake and then answered every `documentSymbol` / `definition` with an empty
list. Pinning TypeScript 5 here, in a folder with its own `node_modules`, is what
makes the queries return real results.

Install before packaging:

```powershell
cd desktop/lsp-server
pnpm install --prod
```

`electron-builder` copies this folder to `resources/lsp-server` via `extraResources`.
`node_modules` here is not committed.
