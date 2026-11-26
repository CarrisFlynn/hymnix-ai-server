/**
 * Background-job registry for the Jobs page.
 *
 * Long work in this app used to be invisible: a terminal command streamed to
 * one panel, a model download to another, a gateway restart to nothing at all.
 * This keeps one list in the main process, with the last few kilobytes of
 * output per job, so the renderer can show what is actually running and stop it.
 *
 * Output is trimmed as it arrives: a chatty build must not grow the renderer's
 * memory in a session that stays open all day.
 */

import type { JobKind, JobStatus, JobView } from "../shared/protocol";

export type { JobKind, JobStatus, JobView };

type LiveJob = JobView & { kill: (() => void) | null };

/** Keep the tail only: the page shows the last screenful, not the whole build. */
const MAX_OUTPUT = 64 * 1024;

export type JobPublish = (channel: "jobs:update" | "jobs:data", payload: unknown) => void;

export class JobCenter {
  private readonly jobs = new Map<string, LiveJob>();
  private sequence = 0;

  constructor(private readonly publish: JobPublish) {}

  /** Start tracking one unit of work. */
  create(input: { kind: JobKind; title: string; command?: string }): JobView {
    const id = "job-" + Date.now().toString(36) + "-" + (++this.sequence).toString(36);
    const job: LiveJob = {
      id,
      kind: input.kind,
      title: String(input.title || "").slice(0, 200) || input.kind,
      ...(input.command ? { command: String(input.command).slice(0, 4000) } : {}),
      status: "running",
      startedAt: Date.now(),
      finishedAt: null,
      exitCode: null,
      error: "",
      output: "",
      kill: null,
    };
    this.jobs.set(id, job);
    this.announce(job);
    return this.view(job);
  }

  /** Append streamed output and re-trim the tail. */
  append(id: string, stream: "stdout" | "stderr" | "log", text: string): void {
    const job = this.jobs.get(id);
    if (!job || !text) return;
    const chunk = text.length > MAX_OUTPUT ? text.slice(text.length - MAX_OUTPUT) : text;
    job.output = (job.output + chunk).slice(-MAX_OUTPUT);
    this.publish("jobs:data", { id, stream, text: chunk });
  }

  /** Register the cancel action (a process tree, an abort controller). */
  attachKill(id: string, kill: () => void): void {
    const job = this.jobs.get(id);
    if (job) job.kill = kill;
  }

  /** Close a job once, whatever finished it (exit, abort, error). */
  finish(id: string, status: Exclude<JobStatus, "running">, exitCode: number | null = null, error = ""): void {
    const job = this.jobs.get(id);
    if (!job || job.status !== "running") return;
    job.status = status;
    job.finishedAt = Date.now();
    job.exitCode = exitCode;
    job.error = String(error || "").slice(0, 400);
    job.kill = null;
    this.announce(job);
  }

  /** User pressed cancel: run the registered killer, then mark it cancelled. */
  stop(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.status !== "running") return false;
    const kill = job.kill;
    job.kill = null;
    try { kill?.(); } catch { /* the process may already be gone */ }
    this.finish(id, "cancelled");
    return true;
  }

  /** Current list, newest first. Only the tail travels: the page shows the last screenful. */
  list(): JobView[] {
    return [...this.jobs.values()]
      .sort((left, right) => (right.finishedAt || right.startedAt) - (left.finishedAt || left.startedAt))
      .map((job) => ({ ...this.view(job), output: job.output.slice(-24 * 1024) }));
  }

  get(id: string): JobView | null {
    const job = this.jobs.get(id);
    return job ? this.view(job) : null;
  }

  /** Drop finished rows; running work is never discarded. */
  clear(): void {
    for (const [id, job] of this.jobs) {
      if (job.status !== "running") this.jobs.delete(id);
    }
  }

  /** Cancel everything that is still running (app quit, workspace change). */
  stopAll(): void {
    for (const id of [...this.jobs.keys()]) this.stop(id);
  }

  private announce(job: LiveJob): void {
    this.publish("jobs:update", this.view(job));
  }

  private view(job: LiveJob): JobView {
    const { kill: _kill, ...rest } = job;
    return { ...rest };
  }
}
