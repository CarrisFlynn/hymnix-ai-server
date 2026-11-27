import { test } from "node:test";
import assert from "node:assert/strict";
import { listSessionsView, searchSessions, snippetAround } from "../src/renderer/lib/session-view.js";
import { parseWorktrees } from "../src/main/worktree.ts";

const sessions = [
  { id: "s1", name: "Renderer work", updatedAt: "2026-11-27T08:00:00Z", model: "qwen3:8b", pinned: true, messages: [
    { role: "user", content: "Where is the tool loop?" },
    { role: "assistant", content: "It lives in main.tsx and runs streamTurn in a for loop." },
  ] },
  { id: "s2", name: "Packaging", updatedAt: "2026-11-27T09:00:00Z", model: "qwen3:8b", pinned: false, messages: [
    { role: "user", content: "How do I sign the installer?" },
    { role: "assistant", content: "There is no certificate; the build is unsigned." },
  ] },
];

test("listSessionsView reports newest first with counts", () => {
  const page = listSessionsView(sessions, { limit: 5 });
  assert.equal(page.total, 2);
  assert.equal(page.sessions[0].id, "s2", "the most recently used conversation comes first");
  assert.equal(page.sessions[0].messages, 2);
  assert.equal(listSessionsView(sessions, { pinnedOnly: true }).sessions.length, 1);
  assert.equal(listSessionsView(sessions, { limit: 1 }).sessions.length, 1);
});

test("session_search finds the conversation that mentioned the term", () => {
  const found = searchSessions(sessions, { query: "streamTurn" });
  assert.equal(found.total, 1);
  assert.equal(found.sessions[0].id, "s1");
  assert.equal(found.sessions[0].matchCount, 1);
  assert.equal(found.sessions[0].hits[0].role, "assistant");
  assert.ok(found.sessions[0].hits[0].snippet.includes("streamTurn"));
});

test("session_search is case-insensitive and refuses an empty query", () => {
  assert.equal(searchSessions(sessions, { query: "MAIN.TSX" }).total, 1);
  const empty = searchSessions(sessions, { query: "   " });
  assert.equal(empty.error, "query_required");
  assert.deepEqual(empty.sessions, []);
  assert.equal(searchSessions(sessions, { query: "nothing-matches-this" }).total, 0);
});

test("snippetAround cuts around the match instead of at the start", () => {
  const long = "a".repeat(400) + " NEEDLE " + "b".repeat(400);
  const cut = snippetAround(long, "needle");
  assert.ok(cut.includes("NEEDLE"));
  assert.ok(cut.startsWith("…") && cut.endsWith("…"));
  assert.ok(cut.length <= 200);
});

test("parseWorktrees reads the porcelain output", () => {
  const rows = parseWorktrees([
    "worktree C:/repo",
    "HEAD 4c7b1a3d2e1f",
    "branch refs/heads/main",
    "",
    "worktree C:/repo-experiment",
    "HEAD b1e26f2aa11b",
    "branch refs/heads/experiment",
    "",
    "worktree C:/detached",
    "HEAD 9bf086155ccc",
    "detached",
  ].join("\n"));
  assert.equal(rows.length, 3);
  assert.equal(rows[0].path, "C:/repo");
  assert.equal(rows[0].branch, "main");
  assert.equal(rows[0].current, true, "the first row is the main checkout");
  assert.equal(rows[1].branch, "experiment");
  assert.equal(rows[1].current, false);
  assert.equal(rows[2].branch, "(detached)");
});
