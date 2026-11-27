import { test } from "node:test";
import assert from "node:assert/strict";
import { createGoal, applyGoalPatch, consumeRound, shouldContinue, continuationPrompt } from "../src/renderer/lib/goals.js";

test("a goal needs an objective and clamps its round budget", () => {
  assert.equal(createGoal("   ").error, "objective_required");
  assert.equal(createGoal("ship 1.4", 0).goal.maxRounds, 1);
  assert.equal(createGoal("ship 1.4", 99).goal.maxRounds, 20);
});

test("status and budget are validated before they are applied", () => {
  const { goal } = createGoal("write docs", 3);
  assert.equal(applyGoalPatch(goal, { status: "paused" }).goal.status, "paused");
  assert.equal(applyGoalPatch(goal, { status: "done" }).error, "invalid_status");
  assert.equal(applyGoalPatch(goal, { maxRounds: 0 }).error, "invalid_max_rounds");
});

test("continuation stops at the budget and consumes one round", () => {
  const { goal } = createGoal("build the thing", 2);
  assert.equal(shouldContinue(goal), true);
  const second = consumeRound(goal);
  assert.equal(shouldContinue(second), true);
  const third = consumeRound(second);
  assert.equal(shouldContinue(third), false);
  assert.match(continuationPrompt(goal), /1 \/ 2/);
});

test("a completed goal never continues", () => {
  const { goal } = createGoal("done already", 5);
  const done = applyGoalPatch(goal, { status: "complete" }).goal;
  assert.equal(shouldContinue(done), false);
});
