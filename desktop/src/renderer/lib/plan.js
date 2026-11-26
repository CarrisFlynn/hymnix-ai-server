/**
 * Plan state: the step list a coding session shows in its Plan tab.
 *
 * The model publishes the whole list through the `todo_write` tool; this module
 * turns that rewrite into a stable list — steps keep their identity by intent,
 * timestamps only move forward, and a step that was running when the model
 * moved on is closed instead of hanging forever. Framework-free so the rules
 * are testable without a browser.
 */

/** Lifecycle order: a rewrite may advance a step, never rewind it. */
export const PLAN_RANK = { queued: 0, running: 1, done: 2 };

/** Terminal states never regress, whatever the model says next. */
const TERMINAL = new Set(["done", "failed", "skipped"]);

/** Map the tool's vocabulary onto ours. */
export function normalizeStatus(raw) {
  const value = String(raw || "").toLowerCase();
  if (value === "pending" || value === "queued") return "queued";
  if (value === "in_progress" || value === "running" || value === "active") return "running";
  if (value === "completed" || value === "done" || value === "complete") return "done";
  if (value === "failed" || value === "error") return "failed";
  if (value === "cancelled" || value === "canceled" || value === "skipped") return "skipped";
  return "queued";
}

/** One empty plan per conversation. */
export function createPlan(taskId, now = Date.now()) {
  return { id: "plan-" + Math.random().toString(36).slice(2, 10), taskId: taskId || "", steps: [], updatedAt: now };
}

/** Read a step list out of a tool payload, tolerating a bare array or `{todos}`. */
export function readTodos(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const value = payload.todos ?? payload.steps ?? payload.items;
    if (Array.isArray(value)) return value;
  }
  return [];
}

function toIntent(item) {
  if (typeof item === "string") return item.trim();
  if (!item || typeof item !== "object") return "";
  const value = item.content ?? item.intent ?? item.title ?? item.text ?? item.step ?? "";
  return String(value || "").trim().slice(0, 240);
}

function toStatus(item) {
  if (!item || typeof item !== "object") return "queued";
  return normalizeStatus(item.status ?? item.state ?? "pending");
}

/** Advance-only merge of one step's status. */
function resolveStatus(previous, next) {
  if (!previous) return next;
  if (TERMINAL.has(previous)) return previous;
  const before = PLAN_RANK[previous] ?? 0;
  const after = PLAN_RANK[next] ?? 0;
  return after > before ? next : previous;
}

function stamp(status, step, now) {
  if (status === "running" && !step.startedAt) step.startedAt = now;
  if (!TERMINAL.has(status)) return;
  if (!step.startedAt) step.startedAt = now;
  if (!step.finishedAt) step.finishedAt = now;
}

/**
 * Rewrite the plan from a `todo_write` payload. Returns a new plan; the caller's
 * object is never mutated, so React state updates stay predictable.
 */
export function applyTodos(plan, payload, now = Date.now(), limit = 30) {
  const base = plan || createPlan("", now);
  const incoming = readTodos(payload);
  const previous = new Map();
  for (const step of base.steps || []) previous.set(step.intent, step);
  const used = new Set();
  const steps = [];
  for (const item of incoming.slice(0, limit)) {
    const intent = toIntent(item);
    if (!intent || used.has(intent)) continue;
    used.add(intent);
    const prior = previous.get(intent);
    const status = resolveStatus(prior ? prior.status : "", toStatus(item));
    const step = prior
      ? { ...prior, intent, status, evidenceIds: (prior.evidenceIds || []).slice() }
      : { id: "step-" + Math.random().toString(36).slice(2, 8), intent, status, startedAt: 0, finishedAt: null, evidenceIds: [] };
    stamp(status, step, now);
    steps.push(step);
  }
  // Steps the model dropped, but that already happened, stay as history so the
  // record of the turn is not silently rewritten.
  for (const prior of base.steps || []) {
    if (used.has(prior.intent)) continue;
    if (prior.status === "done" || prior.status === "failed" || prior.status === "skipped") { steps.push(prior); continue; }
    if (prior.status === "running") steps.push({ ...prior, status: "skipped", finishedAt: prior.finishedAt || now });
  }
  return { ...base, steps: steps.slice(-limit), updatedAt: now };
}

/** Manual mark from the Plan tab: done, skipped or back to running. */
export function markStep(plan, stepId, status, now = Date.now()) {
  const base = plan || createPlan("", now);
  const next = normalizeStatus(status);
  let touched = false;
  const steps = (base.steps || []).map((step) => {
    if (step.id !== stepId) return step;
    touched = true;
    const updated = { ...step, status: next, startedAt: step.startedAt || now, finishedAt: TERMINAL.has(next) ? now : null };
    return updated;
  });
  return touched ? { ...base, steps, updatedAt: now } : base;
}

/** Link one evidence record to the step that was running (or the newest one). */
export function attachEvidence(plan, stepId, evidenceId) {
  const base = plan || createPlan("");
  if (!evidenceId) return base;
  let target = stepId;
  if (!target) {
    const running = (base.steps || []).find((step) => step.status === "running");
    target = running ? running.id : (base.steps || []).at(-1)?.id;
  }
  if (!target) return base;
  const steps = base.steps.map((step) => step.id === target
    ? { ...step, evidenceIds: step.evidenceIds.includes(evidenceId) ? step.evidenceIds : step.evidenceIds.concat([evidenceId]) }
    : step);
  return { ...base, steps };
}

/** The step the next tool call should be credited to. */
export function activeStep(plan) {
  return (plan && plan.steps ? plan.steps.find((step) => step.status === "running") : null) || null;
}

/** Elapsed milliseconds for one step, or null while it never started. */
export function stepDuration(step) {
  if (!step || !step.startedAt) return null;
  const end = step.finishedAt || Date.now();
  return Math.max(0, end - step.startedAt);
}

/** Counts behind the header summary. */
export function planStats(plan) {
  const steps = (plan && plan.steps) || [];
  const stats = { total: steps.length, queued: 0, running: 0, done: 0, failed: 0, skipped: 0 };
  for (const step of steps) stats[step.status] = (stats[step.status] || 0) + 1;
  return stats;
}

/** Percentage complete, rounded down so 100% means every step really closed. */
export function planPercent(plan) {
  const stats = planStats(plan);
  const closed = stats.done + stats.skipped + stats.failed;
  if (!stats.total) return 0;
  return Math.floor((closed / stats.total) * 100);
}

/** "3 of 5 done" for the tab badge and the panel header. */
export function summarizePlan(plan) {
  const stats = planStats(plan);
  if (!stats.total) return "";
  return stats.done + "/" + stats.total;
}

/** Compact duration for a step row: "0.4s", "18s", "1m 04s". */
export function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return "";
  const value = Math.max(0, Math.round(ms));
  if (value < 1000) return value + "ms";
  if (value < 60000) return (value / 1000).toFixed(value < 10000 ? 1 : 0) + "s";
  const minutes = Math.floor(value / 60000);
  const seconds = Math.round((value % 60000) / 1000);
  return minutes + "m " + String(seconds).padStart(2, "0") + "s";
}
