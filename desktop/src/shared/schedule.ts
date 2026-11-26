/**
 * Automation rules and their next occurrence.
 *
 * Mirrors the DSH schedule model: a one-off instant, a fixed interval, a daily
 * wall-clock time, or a weekly time on chosen weekdays. Everything is computed
 * in the local zone and strictly after the reference instant, so a task that
 * just fired cannot fire twice in the same second.
 */
import type { ScheduleRule } from "./protocol";

export const RULE_KINDS: string[] = ["at", "every", "daily", "weekly"];

const WEEKDAYS: number[] = [0, 1, 2, 3, 4, 5, 6];

/** "HH:MM" -> { hours, minutes }, or null. */
export function parseClock(value: unknown): { hours: number; minutes: number } | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value ?? "").trim());
  if (!match) return null;
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

export function formatClock(hours: number, minutes: number): string {
  return String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0");
}

/** Validate a rule and return it in canonical form. */
export function normalizeRule(rule: unknown): { rule: ScheduleRule } | { error: string } {
  if (!rule || typeof rule !== "object") return { error: "invalid_rule" };
  const source = rule as Record<string, unknown>;
  const kind = String(source.kind ?? "");
  if (!RULE_KINDS.includes(kind)) return { error: "invalid_rule" };
  if (kind === "at") {
    const at = Number(source.at);
    if (!Number.isFinite(at) || at <= 0) return { error: "invalid_rule" };
    return { rule: { kind: "at", at } };
  }
  if (kind === "every") {
    const seconds = Math.round(Number(source.seconds));
    if (!Number.isFinite(seconds) || seconds < 60) return { error: "frequency_too_high" };
    return { rule: { kind: "every", seconds } };
  }
  const clock = parseClock(source.time);
  if (!clock) return { error: "invalid_rule" };
  if (kind === "daily") return { rule: { kind: "daily", time: formatClock(clock.hours, clock.minutes) } };
  const rawDays = Array.isArray(source.weekdays) ? source.weekdays : [];
  const weekdays = rawDays.map((day) => Number(day)).filter((day) => WEEKDAYS.includes(day));
  if (!weekdays.length) return { error: "invalid_rule" };
  return { rule: { kind: "weekly", time: formatClock(clock.hours, clock.minutes), weekdays: [...new Set(weekdays)].sort() } };
}

export function isValidRule(rule: unknown): boolean {
  return !("error" in normalizeRule(rule));
}

/**
 * The first instant strictly after `after` (epoch ms) that the rule fires.
 * Returns null for a one-off rule whose instant has already passed.
 */
export function nextOccurrence(rule: unknown, after: number = Date.now()): number | null {
  const normalized = normalizeRule(rule);
  if ("error" in normalized) return null;
  const value = normalized.rule;
  if (value.kind === "at") return value.at > after ? value.at : null;
  if (value.kind === "every") return after + value.seconds * 1000;
  const clock = parseClock(value.time);
  if (!clock) return null;
  const base = new Date(after);
  if (value.kind === "daily") {
    const candidate = new Date(base.getFullYear(), base.getMonth(), base.getDate(), clock.hours, clock.minutes, 0, 0);
    if (candidate.getTime() > after) return candidate.getTime();
    candidate.setDate(candidate.getDate() + 1);
    return candidate.getTime();
  }
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset, clock.hours, clock.minutes, 0, 0);
    if (candidate.getTime() <= after) continue;
    if (value.weekdays.includes(candidate.getDay())) return candidate.getTime();
  }
  return null;
}

/**
 * The next instant after a run that was due at `scheduled`.
 *
 * Rescheduling from "now" drifts: a 20 s tick turns a 60 s interval into 60-80 s,
 * and a daily 09:00 task that fired at 09:00:20 would move to tomorrow. Walking
 * forward from the planned instant keeps the cadence; when the app was closed for
 * longer than the walk allows, it jumps to the next slot after now.
 */
export function advanceOccurrence(rule: unknown, scheduled: number, now: number = Date.now()): number | null {
  let next = nextOccurrence(rule, scheduled);
  for (let step = 0; step < 2000 && next != null && next <= now; step += 1) {
    next = nextOccurrence(rule, next);
  }
  if (next == null || next <= now) next = nextOccurrence(rule, now);
  return next;
}

/** Human parts for the UI; the caller localizes them. */
export function describeRule(rule: unknown): { kind: string; parts: string[] } {
  const normalized = normalizeRule(rule);
  if ("error" in normalized) return { kind: "invalid", parts: [] };
  const value = normalized.rule;
  if (value.kind === "at") return { kind: "at", parts: [String(value.at)] };
  if (value.kind === "every") return { kind: "every", parts: [String(value.seconds)] };
  if (value.kind === "daily") return { kind: "daily", parts: [value.time] };
  return { kind: "weekly", parts: [value.time, value.weekdays.join(",")] };
}

/** Milliseconds until the next run, or null when nothing is scheduled. */
export function msUntilNext(rule: unknown, now: number = Date.now()): number | null {
  const next = nextOccurrence(rule, now);
  return next == null ? null : Math.max(0, next - now);
}
