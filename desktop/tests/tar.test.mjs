import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractTar } from "../src/main/tar.ts";

function buildArchive(work, relative) {
  const archive = join(work, "bundle.tar");
  execFileSync("tar.exe", ["-cf", archive, "-C", work, relative], { windowsHide: true });
  return archive;
}

test("a real archive is unpacked with its directory structure", () => {
  const work = mkdtempSync(join(tmpdir(), "hx-tar-"));
  const src = join(work, "src", "deep", "nested");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(work, "src", "top.txt"), "top");
  writeFileSync(join(src, "inner.txt"), "inner");
  const archive = buildArchive(work, "src");
  const dest = join(work, "out");
  const result = extractTar(archive, dest);
  assert.ok(result.files >= 2, "expected both files, got " + result.files);
  assert.equal(readFileSync(join(dest, "src", "top.txt"), "utf8"), "top");
  assert.equal(readFileSync(join(dest, "src", "deep", "nested", "inner.txt"), "utf8"), "inner");
  assert.ok(statSync(join(dest, "src", "deep", "nested")).isDirectory());
  assert.ok(result.directories >= 2, "directories reported");
});

test("the staged language server archive carries its dependencies", () => {
  const archive = join(process.cwd(), "build", "lsp-runtime.tar");
  const work = mkdtempSync(join(tmpdir(), "hx-tar-lsp-"));
  const result = extractTar(archive, work);
  assert.ok(result.files > 100, "expected a real bundle, got " + result.files + " files");
  assert.ok(existsSync(join(work, "lsp-runtime", "node_modules", "typescript-language-server", "lib", "cli.mjs")), "cli present");
  assert.ok(existsSync(join(work, "lsp-runtime", "node_modules", "typescript", "lib", "tsserver.js")), "tsserver present");
});
