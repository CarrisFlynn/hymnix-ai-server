/**
 * Goal state for one conversation: an objective, a status and a round budget.
 *
 * The goal turns a long task into something the shell can continue by itself:
 * after a turn ends, if the goal is still active and rounds remain, the next
 * continuation prompt is generated here (pure) and sent by the caller.
 */

export const GOAL_STATUSES = ["active", "paused", "complete"];

export function createGoal(objective, maxRounds = 6) {
  const text = String(objective || "").trim();
  if (!text) return { error: "objective_required" };
  return {
    goal: {
      objective: text.slice(0, 2000),
      status: "active",
      rounds: 0,
      maxRounds: Math.max(1, Math.min(20, Math.round(Number.isFinite(Number(maxRounds)) ? Number(maxRounds) : 6))),
      createdAt: Date.now(),
    },
  };
}

/** Apply a tool-shaped patch; unknown fields and statuses are refused. */
export function applyGoalPatch(goal, patch) {
  if (!goal) return { error: "no_goal" };
  const next = { ...goal };
  if (typeof patch?.objective === "string" && patch.objective.trim()) next.objective = patch.objective.trim().slice(0, 2000);
  if (patch?.status !== undefined) {
    if (!GOAL_STATUSES.includes(String(patch.status))) return { error: "invalid_status" };
    next.status = String(patch.status);
  }
  if (patch?.maxRounds !== undefined) {
    const rounds = Math.round(Number(patch.maxRounds));
    if (!Number.isFinite(rounds) || rounds < 1 || rounds > 20) return { error: "invalid_max_rounds" };
    next.maxRounds = rounds;
  }
  return { goal: next };
}

/** One continuation consumes a round; completion is decided by the model. */
export function consumeRound(goal) {
  return { ...goal, rounds: Math.min(goal.maxRounds, goal.rounds + 1) };
}

export function shouldContinue(goal) {
  return Boolean(goal) && goal.status === "active" && goal.rounds < goal.maxRounds;
}

/** The prompt the shell sends for the next round; names the goal and the budget. */
export function continuationPrompt(goal) {
  const round = goal.rounds + 1;
  return [
    "继续推进这个目标：" + goal.objective,
    "这是第 " + round + " / " + goal.maxRounds + " 轮。",
    "先检查当前进度，再完成下一步；目标达成时调用 goal.write 把 status 设为 complete，并简要说明结果。",
  ].join("\n");
}
