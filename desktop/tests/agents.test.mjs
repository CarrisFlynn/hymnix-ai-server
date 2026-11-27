import { test } from "node:test";
import assert from "node:assert/strict";
import { appendExchange, closeAgent, emptyAgents, listAgents, spawnAgent, wireMessages } from "../src/renderer/lib/agents.js";

test("agents are named, unique and capped", () => {
  let { agents } = spawnAgent(emptyAgents(), "reviewer", "You review code.");
  assert.equal(spawnAgent(agents, "reviewer").error, "already_exists");
  assert.equal(spawnAgent(agents, "  ").error, "name_required");
  for (let i = 0; i < 5; i += 1) agents = spawnAgent(agents, "a" + i).agents;
  assert.equal(spawnAgent(agents, "overflow").error, "too_many_agents");
});

test("an exchange keeps history and a failed reply keeps the user turn", () => {
  const { agents } = spawnAgent(emptyAgents(), "writer");
  const ok = appendExchange(agents, "writer", "draft an intro", { ok: true, text: "Here it is." });
  assert.equal(ok.agents.writer.messages.length, 2);
  const failed = appendExchange(ok.agents, "writer", "revise it", { ok: false, error: "timeout" });
  assert.equal(failed.agents.writer.messages.length, 3);
  assert.equal(failed.agents.writer.lastError, "timeout");
  assert.deepEqual(wireMessages(failed.agents.writer).map((m) => m.role), ["user", "assistant", "user"]);
});

test("listing and closing reflect the live map", () => {
  const { agents } = spawnAgent(emptyAgents(), "scout");
  assert.equal(listAgents(agents)[0].name, "scout");
  assert.equal(closeAgent(agents, "scout").agents.scout, undefined);
  assert.equal(closeAgent(agents, "missing").error, "no_agent");
});
