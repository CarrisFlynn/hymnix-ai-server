import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

/**
 * Put a node.exe next to the app.
 *
 * The terminal agent needs a real Node: a PTY child cannot run Electron as node
 * (ConPTY ignores ELECTRON_RUN_AS_NODE and the process produces no output), and
 * asking every user to install Node before the built-in agent works is a trap.
 * The file is about 80 MB and is copied once per build.
 */
const out = resolve("build/node");
mkdirSync(out, { recursive: true });
const target = join(out, "node.exe");

let source = process.env.NODE_EXE || "";
if (!source) {
  try {
    source = execFileSync("where.exe", ["node"], { encoding: "utf8" }).split(/\r?\n/).map((row) => row.trim()).filter(Boolean)[0] || "";
  } catch {
    source = "";
  }
}
if (!source || !existsSync(source)) {
  console.error("stage-node: no node.exe found; set NODE_EXE or install Node.js");
  process.exit(1);
}
copyFileSync(source, target);
const version = execFileSync(target, ["--version"], { encoding: "utf8" }).trim();
console.log("stage-node: " + version + " from " + source + " (" + Math.round(statSync(target).size / 1048576) + " MB)");
