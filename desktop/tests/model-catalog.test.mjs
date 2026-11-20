import assert from "node:assert/strict";
import { test } from "node:test";
import {
  catalogPublishers,
  DEFAULT_CATALOG_FILTERS,
  downloadableCatalog,
  estimateVramGiB,
  filterCatalog,
  parseDownloadLimit,
  VRAM_PRESETS,
} from "../src/renderer/model-catalog.ts";

const model = (name, publisher, downloadGb, options = {}) => ({
  name, publisher, downloadGb, use: "Chat", aliases: [], license: "Apache-2.0", licenseKind: "permissive", ...options,
});
const candidates = [
  model("qwen3:4b", "Alibaba", 2.6, { aliases: ["通义千问", "Qwen 3"] }),
  model("qwen3:8b", "Alibaba", 5.2, { aliases: ["通义千问", "Qwen 3"] }),
  model("qwen2.5-coder:7b", "Alibaba", 4.7, { aliases: ["通义千问"], use: "Coding" }),
  model("deepseek-r1:7b", "DeepSeek", 4.7, { aliases: ["深度求索"], use: "Reasoning", license: "MIT" }),
  model("llama3.1:8b", "Meta", 4.9, { aliases: ["羊驼"], license: "Llama 3.1 Community License", licenseKind: "open-weight" }),
  model("nomic-embed-text:latest", "Nomic", 0.274, { use: "Embeddings" }),
];
const names = (entries) => entries.map(({ name }) => name);
const search = (filters = {}, entries = candidates) => names(filterCatalog(entries, { ...DEFAULT_CATALOG_FILTERS, ...filters }));

test("matches every keyword across Ollama name, publisher, aliases, and bilingual uses", () => {
  assert.deepEqual(search({ query: " Ｑｗｅｎ３：４Ｂ  ALIBABA	通义千问 聊天 " }), ["qwen3:4b"]);
  assert.deepEqual(search({ query: "QWEN   3 8b chat" }), ["qwen3:8b"]);
  assert.deepEqual(search({ query: "Alibaba 代码" }), ["qwen2.5-coder:7b"]);
  assert.deepEqual(search({ query: "深度求索 REASONING" }), ["deepseek-r1:7b"]);
  assert.deepEqual(search({ query: "Nomic 向量嵌入" }), ["nomic-embed-text:latest"]);
  assert.deepEqual(search({ query: "qwen3 推理" }), []);
  assert.deepEqual(search({ query: " " }), names(candidates));
});

test("intersects all filters and keeps license classes separate", () => {
  const entries = [
    model("atlas:2b", "A", 2.6),
    model("atlas:3b", "B", 2.6),
    model("atlas:4b", "A", 2.6, { licenseKind: "open-weight" }),
    model("atlas:5b", "A", 2.61),
    model("atlas:vision", "A", 2.6, { use: "Vision" }),
    model("orbit:2b", "A", 2.6),
  ];
  const combined = { query: "atlas", publisher: "A", licenseKind: "permissive", maxDownloadGb: "2.6", vramGiB: 4 };
  assert.deepEqual(search(combined, entries), ["atlas:2b"]);
  assert.deepEqual(search({ ...combined, licenseKind: "open-weight" }, entries), ["atlas:4b"]);
  assert.deepEqual(search({ ...combined, licenseKind: "other" }, entries), []);
  assert.deepEqual(search({}, entries), names(entries));
  assert.deepEqual(catalogPublishers(candidates), ["Alibaba", "DeepSeek", "Meta", "Nomic"]);
});

test("treats download limits as non-negative decimal GB, including sub-GB models", () => {
  assert.equal(parseDownloadLimit(" ０.２７４ "), 0.274);
  assert.equal(parseDownloadLimit(".274"), 0.274);
  assert.equal(parseDownloadLimit("0"), 0);
  for (const invalid of ["", " ", "-1", "NaN", "Infinity", "1,024", "0xff", "4 GB"]) {
    assert.equal(parseDownloadLimit(invalid), null);
  }
  assert.deepEqual(search({ maxDownloadGb: "0.274" }), ["nomic-embed-text:latest"]);
  assert.deepEqual(search({ maxDownloadGb: "0" }), []);
  assert.deepEqual(search({ maxDownloadGb: "0.273" }), []);
});

test("filters on the displayed full-offload estimate and offers common VRAM sizes", () => {
  const chat = model("atlas:2b", "A", 2.6);
  assert.equal(estimateVramGiB(chat), 4);
  assert.ok(estimateVramGiB({ ...chat, use: "Vision" }) > estimateVramGiB(chat));
  assert.ok(estimateVramGiB({ ...chat, use: "Embeddings" }) < estimateVramGiB(chat));
  assert.ok(estimateVramGiB({ ...chat, downloadGb: 5.2 }) > estimateVramGiB(chat));
  assert.deepEqual(search({ vramGiB: 4 }), ["qwen3:4b", "nomic-embed-text:latest"]);
  for (const size of [4, 6, 8, 12, 16, 24, 32, 48, 64, 80]) assert.ok(VRAM_PRESETS.includes(size));
});

test("keeps installed models out of results, including Ollama's implicit latest tag", () => {
  assert.deepEqual(names(downloadableCatalog(candidates, ["QWEN3:4B", "nomic-embed-text", "qwen3:latest"])), [
    "qwen3:8b", "qwen2.5-coder:7b", "deepseek-r1:7b", "llama3.1:8b",
  ]);
  assert.deepEqual(names(downloadableCatalog([model("namespace/local", "A", 1)], ["namespace/local:latest"])), []);
  assert.deepEqual(downloadableCatalog(candidates, names(candidates)), []);
});
