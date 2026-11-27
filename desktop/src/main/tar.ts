/**
 * A minimal tar extractor.
 *
 * The bundled language server is shipped as one archive on purpose: electron-builder
 * drops any node_modules directory it finds, so a folder layout arrived with its
 * package.json and no code. A single .tar file is copied verbatim, and unpacking it
 * into the user data folder is the only part we need to own.
 *
 * Only plain files and directories are handled, which is all the staged copy holds.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";

function readString(block: Buffer, offset: number, length: number): string {
  const slice = block.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString("utf8");
}

function readOctal(block: Buffer, offset: number, length: number): number {
  const text = readString(block, offset, length).trim();
  if (!text) return 0;
  const value = parseInt(text, 8);
  return Number.isFinite(value) ? value : 0;
}

export type ExtractResult = { files: number; directories: number };

/** Unpack a tar archive into destDir, refusing entries that would escape it. */
export function extractTar(archive: string, destDir: string): ExtractResult {
  const data = readFileSync(archive);
  const root = normalize(destDir);
  let offset = 0;
  let files = 0;
  let directories = 0;
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const full = prefix ? prefix + "/" + name : name;
    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    offset += 512;
    const body = data.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;

    // PAX and GNU long-name records are metadata; the staged archive uses neither.
    if (type === "x" || type === "g" || type === "L" || type === "K") continue;
    const target = normalize(join(root, full));
    if (target !== root && !target.startsWith(root + sep)) continue;
    if (type === "5") {
      mkdirSync(target, { recursive: true });
      directories += 1;
      continue;
    }
    if (type !== "0" && type !== "") continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
    files += 1;
  }
  return { files, directories };
}
