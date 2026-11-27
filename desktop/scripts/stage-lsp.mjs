import { cpSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

/** Copy the bundled language server into the app folder; electron-builder's files glob cannot leave it. */
const from = resolve(process.cwd(), "..", "lsp-server");
const to = resolve(process.cwd(), "lsp-server");
const cli = join(to, "node_modules", "typescript-language-server", "lib", "cli.mjs");
if (existsSync(cli)) { console.log("stage-lsp: already staged"); process.exit(0); }
if (!existsSync(from)) { console.error("stage-lsp: lsp-server/ missing; run npm install there first"); process.exit(1); }
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log("stage-lsp: staged " + to);
