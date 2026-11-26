/** Type declarations for plan.js. Keep in sync with the exports. */

export type PlanStatus = "queued" | "running" | "done" | "failed" | "skipped";

export type PlanStep = {
  id: string;
  intent: string;
  status: PlanStatus;
  startedAt: number;
  finishedAt: number | null;
  evidenceIds: string[];
};

export type PlanState = { id: string; taskId: string; steps: PlanStep[]; updatedAt: number };

export declare const PLAN_RANK: Record<string, number>;
export declare function normalizeStatus(raw: unknown): PlanStatus;
export declare function createPlan(taskId?: string, now?: number): PlanState;
export declare function readTodos(payload: unknown): unknown[];
export declare function applyTodos(plan: PlanState | null | undefined, payload: unknown, now?: number, limit?: number): PlanState;
export declare function markStep(plan: PlanState | null | undefined, stepId: string, status: PlanStatus, now?: number): PlanState;
export declare function attachEvidence(plan: PlanState | null | undefined, stepId: string | null, evidenceId: string): PlanState;
export declare function activeStep(plan: PlanState | null | undefined): PlanStep | null;
export declare function stepDuration(step: PlanStep | null | undefined): number | null;
export declare function planStats(plan: PlanState | null | undefined): { total: number; queued: number; running: number; done: number; failed: number; skipped: number };
export declare function planPercent(plan: PlanState | null | undefined): number;
export declare function summarizePlan(plan: PlanState | null | undefined): string;
export declare function formatDuration(ms: number | null | undefined): string;
