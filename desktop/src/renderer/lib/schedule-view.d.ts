/** Type declarations for schedule-view.js. Keep in sync with the exports. */

import type { AutomationTask, ScheduleRule } from "../../shared/protocol.ts";

export declare function summarizeTask(task: AutomationTask | null | undefined, now?: number): Record<string, unknown> | null;
export declare function scheduleForModel(tasks: AutomationTask[] | null | undefined, input?: { enabledOnly?: boolean; limit?: number }, now?: number): { total: number; tasks: Array<Record<string, unknown> | null> };
export declare function buildSchedulePatch(input?: { title?: unknown; prompt?: unknown; rule?: ScheduleRule; enabled?: unknown }): { title?: string; prompt?: string; rule?: ScheduleRule; enabled?: boolean };
export declare function isEmptyPatch(patch: Record<string, unknown> | null | undefined): boolean;
