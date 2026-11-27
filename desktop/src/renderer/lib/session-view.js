/**
 * Read-only views over the saved conversations.
 *
 * The renderer already holds every session in memory, so "which conversation
 * talked about this?" is a filter, not a query engine. Keeping it here means the
 * tool result is predictable and testable without a window.
 */

const MAX_SESSIONS = 50;
const SNIPPET = 180;

/** One row a model can reason about, without the transcript. */
export function listSessionsView(sessions, options = {}) {
  const pinnedOnly = Boolean(options.pinnedOnly);
  const raw = Number(options.limit);
  const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 20, 1), MAX_SESSIONS);
  const rows = (sessions || [])
    .filter((item) => (pinnedOnly ? Boolean(item && item.pinned) : true))
    .slice()
    .sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime());
  return {
    total: rows.length,
    sessions: rows.slice(0, limit).map((item) => ({
      id: item.id,
      title: String(item.name || "").slice(0, 120),
      messages: Number(item.count) || (item.messages || []).length,
      model: String(item.model || ""),
      pinned: Boolean(item.pinned),
      updatedAt: item.updatedAt || "",
    })),
  };
}

/** One message trimmed to the text around the match, so a hit is readable. */
export function snippetAround(text, query) {
  const body = String(text || "").replace(/\s+/g, " ").trim();
  const needle = String(query || "").toLowerCase();
  if (!needle) return body.slice(0, SNIPPET);
  const at = body.toLowerCase().indexOf(needle);
  if (at < 0) return body.slice(0, SNIPPET);
  const start = Math.max(0, at - Math.floor((SNIPPET - needle.length) / 2));
  const cut = body.slice(start, start + SNIPPET);
  return (start > 0 ? "…" : "") + cut + (start + SNIPPET < body.length ? "…" : "");
}

/**
 * Conversations that mention the query, newest first, with up to perSession
 * matching messages each. A missing query is refused rather than matching all.
 */
export function searchSessions(sessions, options = {}) {
  const query = String(options.query || "").trim();
  if (!query) return { error: "query_required", total: 0, sessions: [] };
  const needle = query.toLowerCase();
  const rawLimit = Number(options.limit);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 10, 1), MAX_SESSIONS);
  const perSession = Math.min(Math.max(Number(options.perSession) || 3, 1), 10);

  const found = [];
  for (const session of sessions || []) {
    const messages = session.messages || [];
    const hits = [];
    let matchCount = 0;
    for (let index = 0; index < messages.length; index += 1) {
      const content = String(messages[index].content || "");
      if (!content.toLowerCase().includes(needle)) continue;
      matchCount += 1;
      if (hits.length < perSession) hits.push({ index, role: messages[index].role, snippet: snippetAround(content, query) });
    }
    if (!hits.length) continue;
    found.push({
      id: session.id,
      title: String(session.name || "").slice(0, 120),
      updatedAt: session.updatedAt || "",
      matchCount,
      hits,
    });
  }
  found.sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime());
  return { total: found.length, sessions: found.slice(0, limit) };
}
