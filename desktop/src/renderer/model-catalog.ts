import type { CatalogEntry } from "./model-catalog-data";

export const VRAM_PRESETS = [4, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64, 80, 96, 128] as const;

export const LICENSE_LABELS = {
  permissive: "Permissive",
  "open-weight": "Open weights with model terms",
  other: "Other terms",
} as const satisfies Record<CatalogEntry["licenseKind"], string>;

export type CatalogFilters = {
  query: string;
  publisher: string;
  licenseKind: CatalogEntry["licenseKind"] | "";
  maxDownloadGb: string;
  vramGiB: number | null;
};

export const DEFAULT_CATALOG_FILTERS: Readonly<CatalogFilters> = {
  query: "",
  publisher: "",
  licenseKind: "",
  maxDownloadGb: "",
  vramGiB: null,
};

const USE_KEYWORDS: Record<CatalogEntry["use"], string> = {
  Chat: "conversation 对话 聊天",
  Reasoning: "thinking 推理 思考",
  Coding: "code programming 代码 编程 编码",
  Vision: "image multimodal 视觉 图像 多模态",
  Embeddings: "embedding vector 向量嵌入",
};

function normalizeSearch(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

function ollamaTag(name: string): string {
  const normalized = name.trim().toLowerCase();
  return normalized.slice(normalized.lastIndexOf("/") + 1).includes(":") ? normalized : normalized + ":latest";
}

export function downloadableCatalog(entries: readonly CatalogEntry[], installedNames: readonly string[]): CatalogEntry[] {
  const installed = new Set(installedNames.map(ollamaTag));
  return entries.filter((entry) => !installed.has(ollamaTag(entry.name)));
}

export function catalogPublishers(entries: readonly CatalogEntry[]): string[] {
  return [...new Set(entries.map((entry) => entry.publisher))].sort((a, b) => a.localeCompare(b, "en"));
}

export function parseDownloadLimit(value: string): number | null {
  const decimal = value.normalize("NFKC").trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(decimal)) return null;
  const limit = Number(decimal);
  return Number.isFinite(limit) ? limit : null;
}

export function estimateVramGiB(entry: CatalogEntry): number {
  // Approximate on-device weights from the size of the listed Ollama variant in decimal GB.
  const weights = entry.downloadGb * 1e9 / (2 ** 30);
  // Allow roughly 10% for runtime buffers and estimate a 4K KV cache by model size.
  // Embedding inference has no autoregressive KV cache. Vision gets extra image buffer space.
  const contextAndScratch = entry.use === "Embeddings" ? 0.75 : Math.max(1.25, weights * 0.17);
  const visionBuffers = entry.use === "Vision" ? 0.75 : 0;
  return Math.ceil((weights * 1.1 + contextAndScratch + visionBuffers) * 2) / 2;
}

export function filterCatalog(entries: readonly CatalogEntry[], filters: CatalogFilters): CatalogEntry[] {
  const terms = normalizeSearch(filters.query).trim().split(/\s+/).filter(Boolean);
  const maxDownloadGb = parseDownloadLimit(filters.maxDownloadGb);
  return entries.filter((entry) => {
    if (filters.publisher && entry.publisher !== filters.publisher) return false;
    if (filters.licenseKind && entry.licenseKind !== filters.licenseKind) return false;
    if (maxDownloadGb !== null && entry.downloadGb > maxDownloadGb) return false;
    if (filters.vramGiB !== null && estimateVramGiB(entry) > filters.vramGiB) return false;
    if (!terms.length) return true;
    const searchable = [entry.name, entry.publisher, ...entry.aliases, entry.use, USE_KEYWORDS[entry.use]].map(normalizeSearch);
    return terms.every((term) => searchable.some((field) => field.includes(term)));
  });
}
