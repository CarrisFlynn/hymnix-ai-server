export type Goal = { objective: string; status: "active" | "paused" | "complete"; rounds: number; maxRounds: number; createdAt: number };
export declare const GOAL_STATUSES: string[];
export declare function createGoal(objective: string, maxRounds?: number): { goal?: Goal; error?: string };
export declare function applyGoalPatch(goal: Goal | null, patch: Record<string, unknown>): { goal?: Goal; error?: string };
export declare function consumeRound(goal: Goal): Goal;
export declare function shouldContinue(goal: Goal | null): boolean;
export declare function continuationPrompt(goal: Goal): string;
