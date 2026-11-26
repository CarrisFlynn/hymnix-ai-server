/**
 * Scheduled tasks, mirroring the DSH schedule model.
 *
 * A task is a prompt plus a rule (one-off instant, fixed interval, daily or
 * weekly wall-clock time). The center ticks, fires at most one delivery per
 * task, and reschedules from the moment it fired. If no window is listening the
 * task stays due, so the next launch delivers the latest missed occurrence once
 * instead of replaying a backlog.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AutomationTask, ScheduleRule } from "../shared/protocol";
import { advanceOccurrence, nextOccurrence, normalizeRule } from "../shared/schedule.ts";

const MAX_TASKS = 50;
const TICK_MS = 20_000;
const MAX_TITLE = 120;
/** A one-off more than five years out is almost certainly a mistake in the input. */
const MAX_AHEAD_MS = 5 * 365 * 24 * 60 * 60 * 1000;
const MAX_PROMPT = 4000;

type Deliver = (task: AutomationTask) => boolean;

export class AutomationCenter {
  private tasks: AutomationTask[] = [];
  private timer: NodeJS.Timeout | null = null;

  private readonly file: string;
  private readonly deliver: Deliver;
  private readonly publish: (task: AutomationTask) => void;
  private readonly clock: () => number;

  constructor(
    file: string,
    deliver: Deliver,
    publish: (task: AutomationTask) => void,
    clock: () => number = Date.now,
  ) {
    this.file = file;
    this.deliver = deliver;
    this.publish = publish;
    this.clock = clock;
  }

  /** Read the store; anything malformed is dropped rather than guessed at. */
  load(): void {
    try {
      if (!existsSync(this.file)) { this.tasks = []; return; }
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as unknown;
      const rows = Array.isArray(parsed) ? parsed : [];
      const now = this.clock();
      this.tasks = rows.flatMap((row) => {
        if (!row || typeof row !== "object") return [];
        const value = row as Record<string, unknown>;
        const id = String(value.id ?? "");
        const title = String(value.title ?? "").trim();
        const prompt = String(value.prompt ?? "");
        const normalized = normalizeRule(value.rule);
        if (!id || !title || !prompt || "error" in normalized) return [];
        const rule = normalized.rule;
        const enabled = value.enabled !== false;
        const nextAt = typeof value.nextAt === "number" ? value.nextAt : nextOccurrence(rule, now);
        return [{
          id, title: title.slice(0, MAX_TITLE), prompt: prompt.slice(0, MAX_PROMPT), rule, enabled,
          createdAt: Number(value.createdAt) || now,
          nextAt: enabled ? nextAt : null,
          lastAt: typeof value.lastAt === "number" ? value.lastAt : null,
        }];
      }).slice(0, MAX_TASKS);
    } catch { this.tasks = []; }
  }

  list(): AutomationTask[] { return this.tasks.map((task) => ({ ...task })); }

  create(input: { title?: unknown; prompt?: unknown; rule?: unknown }): { ok: boolean; task?: AutomationTask; error?: string } {
    const title = String(input.title ?? "").trim().slice(0, MAX_TITLE);
    const prompt = String(input.prompt ?? "").trim().slice(0, MAX_PROMPT);
    if (!title) return { ok: false, error: "title_required" };
    if (!prompt) return { ok: false, error: "prompt_required" };
    const normalized = normalizeRule(input.rule);
    if ("error" in normalized) return { ok: false, error: normalized.error };
    const rule = normalized.rule;
    const now = this.clock();
    const next = nextOccurrence(rule, now);
    if (next == null) return { ok: false, error: "not_future" };
    if (rule.kind === "at" && rule.at - now > MAX_AHEAD_MS) return { ok: false, error: "too_far" };
    if (this.tasks.length >= MAX_TASKS) return { ok: false, error: "too_many_tasks" };
    const task: AutomationTask = { id: randomUUID().slice(0, 8), title, prompt, rule, enabled: true, createdAt: now, nextAt: next, lastAt: null };
    this.tasks.push(task);
    this.save();
    this.publish(task);
    return { ok: true, task: { ...task } };
  }

  update(id: string, patch: { title?: unknown; prompt?: unknown; rule?: unknown; enabled?: unknown }): { ok: boolean; task?: AutomationTask; error?: string } {
    const task = this.tasks.find((item) => item.id === id);
    if (!task) return { ok: false, error: "not_found" };
    // Validate into locals first: a rejected patch must not leave the live task
    // half-edited, even when nothing is saved.
    let title = task.title;
    let prompt = task.prompt;
    let rule = task.rule;
    let nextAt = task.nextAt;
    if (patch.title !== undefined) {
      title = String(patch.title).trim().slice(0, MAX_TITLE);
      if (!title) return { ok: false, error: "title_required" };
    }
    if (patch.prompt !== undefined) {
      prompt = String(patch.prompt).trim().slice(0, MAX_PROMPT);
      if (!prompt) return { ok: false, error: "prompt_required" };
    }
    if (patch.rule !== undefined) {
      const normalized = normalizeRule(patch.rule);
      if ("error" in normalized) return { ok: false, error: normalized.error };
      rule = normalized.rule;
      nextAt = nextOccurrence(rule, this.clock());
      if (nextAt == null) return { ok: false, error: "not_future" };
      if (rule.kind === "at" && rule.at - this.clock() > MAX_AHEAD_MS) return { ok: false, error: "too_far" };
    }
    let enabled = task.enabled;
    if (patch.enabled !== undefined) {
      enabled = Boolean(patch.enabled);
      nextAt = enabled ? nextOccurrence(rule, this.clock()) : null;
    }
    task.title = title;
    task.prompt = prompt;
    task.rule = rule;
    task.enabled = enabled;
    task.nextAt = nextAt;
    this.save();
    this.publish(task);
    return { ok: true, task: { ...task } };
  }

  remove(id: string): { ok: boolean } {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((task) => task.id !== id);
    if (this.tasks.length === before) return { ok: false };
    this.save();
    return { ok: true };
  }

  /** Fire now and keep the original schedule for the next planned run. */
  runNow(id: string): { ok: boolean } {
    const task = this.tasks.find((item) => item.id === id);
    if (!task) return { ok: false };
    const delivered = this.deliver({ ...task });
    if (delivered) { task.lastAt = this.clock(); this.save(); this.publish(task); }
    return { ok: delivered };
  }

  start(): void {
    if (this.timer) return;
    this.load();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    if (typeof this.timer.unref === "function") this.timer.unref();
    this.tick();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass: deliver whatever is due, at most once each. */
  tick(): void {
    const now = this.clock();
    let dirty = false;
    for (const task of this.tasks) {
      if (!task.enabled || task.nextAt == null || task.nextAt > now) continue;
      if (!this.deliver({ ...task })) continue;   // no window yet: stay due
      const scheduled = task.nextAt;
      task.lastAt = now;
      if (task.rule.kind === "at") {
        // A one-off is finished once delivered; leaving it enabled would lie.
        task.enabled = false;
        task.nextAt = null;
      } else {
        task.nextAt = advanceOccurrence(task.rule, scheduled, now);
      }
      dirty = true;
      this.publish(task);
    }
    if (dirty) this.save();
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const temp = this.file + ".tmp";
      writeFileSync(temp, JSON.stringify(this.tasks, null, 2), "utf8");
      renameSync(temp, this.file);
    } catch { /* a failed save must not take the app down */ }
  }
}
