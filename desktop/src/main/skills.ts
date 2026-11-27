/**
 * Skill discovery: a folder per skill with a SKILL.md inside.
 *
 * The list is cheap and safe to show; loading returns the document itself, so a
 * model can pull in domain knowledge only when a task names it.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type SkillEntry = { id: string; name: string; description: string; path: string };

const MAX_DOCUMENT = 60 * 1024;

export function scanSkills(directories: string[]): SkillEntry[] {
  const found = new Map<string, SkillEntry>();
  for (const directory of directories) {
    if (!directory || !existsSync(directory)) continue;
    let names: string[] = [];
    try { names = readdirSync(directory); } catch { continue; }
    for (const entry of names) {
      const file = join(directory, entry, "SKILL.md");
      if (!existsSync(file)) continue;
      let text = "";
      try { text = readFileSync(file, "utf8").slice(0, MAX_DOCUMENT); } catch { continue; }
      const heading = /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
      const flagged = /^description:\s*(.+)$/im.exec(text)?.[1]?.trim();
      const firstLine = text.split("\n").map((line) => line.trim()).find((line) => line && !line.startsWith("#")) || "";
      found.set(entry, {
        id: entry,
        name: heading || entry,
        description: (flagged || firstLine).slice(0, 300),
        path: file,
      });
    }
  }
  return [...found.values()].sort((left, right) => left.id.localeCompare(right.id));
}

/** Read one skill by id from the scanned directories; never accepts a path. */
export function readSkill(directories: string[], id: string): { ok: boolean; id?: string; content?: string; error?: string } {
  const key = String(id || "").trim();
  if (!key || /[\\/]/.test(key) || key.includes("..")) return { ok: false, error: "invalid_id" };
  for (const directory of directories) {
    if (!directory) continue;
    const file = join(directory, key, "SKILL.md");
    if (!existsSync(file)) continue;
    try {
      return { ok: true, id: key, content: readFileSync(file, "utf8").slice(0, MAX_DOCUMENT) };
    } catch {
      return { ok: false, error: "read_failed" };
    }
  }
  return { ok: false, error: "not_found" };
}
