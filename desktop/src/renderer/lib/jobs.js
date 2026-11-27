/**
 * Background-job list rules shared by the Jobs page and the title-bar counter.
 *
 * Sorting is deliberately stable: a job keeps its row while it runs, so the
 * list does not jump under the pointer every time output arrives.
 */

const STATUS_RANK = { running: 0, failed: 1, done: 2, cancelled: 3 };

/** A job is live until it reaches a terminal status. */
export function isActiveJob(job) {
  return Boolean(job) && job.status === "running";
}

/** Running first (newest started), then finished (newest finished). */
export function sortJobs(jobs) {
  return (jobs || []).slice().sort((left, right) => {
    const rank = (STATUS_RANK[left.status] ?? 9) - (STATUS_RANK[right.status] ?? 9);
    if (rank !== 0) return rank;
    return (right.finishedAt || right.startedAt || 0) - (left.finishedAt || left.startedAt || 0);
  });
}

/** Replace or insert one job, keeping the list sorted. */
export function mergeJob(jobs, job) {
  if (!job || !job.id) return jobs || [];
  const current = jobs || [];
  const index = current.findIndex((item) => item.id === job.id);
  const next = index < 0 ? current.concat([job]) : current.map((item) => (item.id === job.id ? job : item));
  return sortJobs(next);
}

/** How many jobs are still running, for the badge. */
export function activeJobCount(jobs) {
  return (jobs || []).filter(isActiveJob).length;
}

/** Wall-clock milliseconds one job has been (or was) alive. */
export function jobElapsed(job, now = Date.now()) {
  if (!job || !job.startedAt) return 0;
  return Math.max(0, (job.finishedAt || now) - job.startedAt);
}

/** "0:07", "1:23", "1:02:03" for the elapsed column. */
export function formatElapsed(ms) {
  const seconds = Math.max(0, Math.floor((ms || 0) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours) return hours + ":" + String(minutes).padStart(2, "0") + ":" + String(rest).padStart(2, "0");
  return minutes + ":" + String(rest).padStart(2, "0");
}

/** Filter for the page's segmented control. */
export function filterJobs(jobs, filter) {
  if (filter === "running") return (jobs || []).filter(isActiveJob);
  if (filter === "finished") return (jobs || []).filter((job) => !isActiveJob(job));
  return jobs || [];
}

/** i18n key for one status. */
export function jobStatusLabel(status) {
  if (status === "running") return "Running";
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Cancelled";
  return "Done";
}

/** Short, honest one-liner for a row: what ran and how it ended. */
export function jobSummary(job) {
  if (!job) return "";
  if (job.status === "running") return job.kind === "model" ? "Downloading" : "Running";
  if (job.status === "cancelled") return "Cancelled";
  if (job.status === "failed") return job.error || "Failed";
  return job.exitCode == null ? "Done" : "Exit " + job.exitCode;
}

/** Model-facing row: no output, bounded strings, elapsed instead of raw timestamps. */
export function summarizeJob(job, now = Date.now()) {
  if (!job || !job.id) return null;
  const row = {
    id: job.id,
    kind: job.kind,
    title: String(job.title || "").slice(0, 120),
    status: job.status,
    elapsedMs: jobElapsed(job, now),
  };
  if (job.command) row.command = String(job.command).slice(0, 400);
  if (job.status !== "running") {
    row.exitCode = job.exitCode == null ? null : job.exitCode;
    row.error = String(job.error || "").slice(0, 300);
  }
  return row;
}

/** Filter and cap the list one tool call returns; the model never gets 50 rows. */
export function jobForModel(jobs, input = {}, now = Date.now()) {
  const status = String(input.status || "all");
  const filter = status === "running" ? "running" : status === "finished" ? "finished" : "all";
  const raw = Number(input.limit);
  const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 20, 1), 100);
  const rows = filterJobs(jobs, filter);
  return { total: rows.length, jobs: rows.slice(0, limit).map((job) => summarizeJob(job, now)) };
}

/** Exact id first, then a unique prefix: the model echoes the short form a lot. */
export function findJob(jobs, id) {
  const wanted = String(id || "").trim();
  if (!wanted) return { error: "id_required" };
  const list = jobs || [];
  const exact = list.find((job) => job.id === wanted);
  if (exact) return { job: exact };
  const prefixed = list.filter((job) => job.id.startsWith(wanted));
  if (prefixed.length === 1) return { job: prefixed[0] };
  if (prefixed.length > 1) return { error: "ambiguous_id" };
  return { error: "not_found" };
}

/** The end of a log is the useful part; the start is usually noise. */
export function tailOutput(text, maxChars = 8000) {
  const value = String(text == null ? "" : text);
  const raw = Number(maxChars);
  const cap = Math.min(Math.max(Number.isFinite(raw) ? raw : 8000, 200), 64000);
  if (value.length <= cap) return { text: value, truncated: false };
  return { text: value.slice(value.length - cap), truncated: true };
}
