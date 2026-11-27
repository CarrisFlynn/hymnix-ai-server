import { cpSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";

/**
 * Copy the bundled language server into the app folder.
 *
 * It is called lsp-runtime, not lsp-server, on purpose: electron-builder treats any
 * directory named node_modules as a dependency tree to prune, which shipped the
 * server with its package.json and no code.
 */
const from = resolve(process.cwd(), "..", "lsp-server");
const to = resolve(process.cwd(), "lsp-runtime");
const cli = join(to, "node_modules", "typescript-language-server", "lib", "cli.mjs");
if (existsSync(cli)) { console.log("stage-lsp: already staged"); process.exit(0); }
if (!existsSync(from)) { console.error("stage-lsp: lsp-server/ missing; run npm install there first"); process.exit(1); }
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log("stage-lsp: staged " + to);

// Pack it as one archive: electron-builder drops any node_modules directory it
// finds, whether it is listed under files or extraResources, so a folder layout
// shipped the server with its package.json and no code.
const archive = resolve(process.cwd(), "build", "lsp-runtime.tar");
mkdirSync(dirname(archive), { recursive: true });
execFileSync("tar.exe", ["-cf", archive, "-C", process.cwd(), "lsp-runtime"], { windowsHide: true });
console.log("stage-lsp: archive " + Math.round(statSync(archive).size / 1048576) + " MB");
