/**
 * Model-facing views over scheduled tasks.
 *
 * The store and its validation live in src/main/automation.ts; this module only
 * decides what one tool call may see and which fields an update may touch, so a
 * model cannot smuggle in a key the store does not own.
 */

/** One task without its full prompt: the model gets the shape, not the payload. */
export function summarizeTask(task, now = Date.now()) {
  if (!task || !task.id) return null;
  const nextAt = typeof task.nextAt === "number" ? task.nextAt : null;
  return {
    id: task.id,
    title: String(task.title || "").slice(0, 120),
    enabled: Boolean(task.enabled),
    rule: task.rule,
    nextAt: task.enabled ? nextAt : null,
    inMs: task.enabled && nextAt != null ? Math.max(0, nextAt - now) : null,
    lastAt: typeof task.lastAt === "number" ? task.lastAt : null,
    promptChars: String(task.prompt || "").length,
    promptPreview: String(task.prompt || "").slice(0, 120),
  };
}

/** Filter and cap the list one tool call returns. */
export function scheduleForModel(tasks, input = {}, now = Date.now()) {
  const onlyEnabled = Boolean(input.enabledOnly);
  const raw = Number(input.limit);
  const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 50, 1), 100);
  const rows = (tasks || []).filter((task) => (onlyEnabled ? Boolean(task && task.enabled) : true));
  return { total: rows.length, tasks: rows.slice(0, limit).map((task) => summarizeTask(task, now)) };
}

/**
 * Only the fields schedule.update owns. Anything else is dropped here rather
 * than forwarded, so a stray key never reaches the store.
 */
export function buildSchedulePatch(input = {}) {
  const patch = {};
  if (input.title !== undefined) patch.title = String(input.title);
  if (input.prompt !== undefined) patch.prompt = String(input.prompt);
  if (input.rule !== undefined) patch.rule = input.rule;
  if (input.enabled !== undefined) patch.enabled = Boolean(input.enabled);
  return patch;
}

/** True when the patch would change nothing; the caller answers instead of writing. */
export function isEmptyPatch(patch) {
  return !patch || Object.keys(patch).length === 0;
}
