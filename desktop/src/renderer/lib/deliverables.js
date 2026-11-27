/**
 * Files the model hands over as finished deliverables.
 *
 * Kept separate from the transcript so the chip row survives scrolling, and
 * normalised here so a bad path is caught before it reaches the UI.
 */

const MAX_FILES = 4;
const MAX_PATH = 400;
const MAX_DESCRIPTION = 200;

/** Normalise and de-duplicate the files one present call declares. */
export function normalizeDeliverables(input) {
  const rows = Array.isArray(input) ? input : [];
  const seen = new Set();
  const out = [];
  for (const raw of rows.slice(0, MAX_FILES * 2)) {
    const source = raw && typeof raw === "object" ? raw : { path: raw };
    const path = String(source.path || "").trim().slice(0, MAX_PATH);
    if (!path) continue;
    const key = path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path, description: String(source.description || "").trim().slice(0, MAX_DESCRIPTION) });
    if (out.length >= MAX_FILES) break;
  }
  return out;
}

/** "src/renderer/main.tsx" -> "main.tsx"; the chip shows the leaf, the tip shows the path. */
export function leafName(path) {
  const value = String(path || "");
  const cut = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  return cut >= 0 ? value.slice(cut + 1) : value;
}
