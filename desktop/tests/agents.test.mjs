import { test } from "node:test";
import assert from "node:assert/strict";
import { appendExchange, agentPath, closeAgent, emptyAgents, listAgents, spawnAgent, treeRows, wireMessages } from "../src/renderer/lib/agents.js";

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

test("children nest under their parent and paths read like DSH names", () => {
  let { agents } = spawnAgent(emptyAgents(), "lead");
  agents = spawnAgent(agents, "reviewer", "", "lead").agents;
  agents = spawnAgent(agents, "checker", "", "reviewer").agents;
  const rows = treeRows(agents);
  assert.deepEqual(rows.map((row) => row.name), ["lead", "reviewer", "checker"]);
  assert.deepEqual(rows.map((row) => row.depth), [0, 1, 2]);
  assert.equal(rows[1].children, 1);
  assert.equal(agentPath(agents, "checker"), "lead/reviewer/checker");
  assert.equal(agentPath(agents, "lead"), "lead");
});

test("an agent named __proto__ does not break the tree", () => {
  // Fixing spawn to use own properties made this name creatable; a plain {}
  // keyed by parent then resolved __proto__ through the prototype chain.
  const created = spawnAgent({}, "__proto__");
  assert.ok(!created.error, "the name is createable");
  const child = spawnAgent(created.agents, "child", "", "__proto__");
  assert.ok(!child.error);
  const rows = treeRows(child.agents);
  assert.deepEqual(rows.map((row) => row.name + "@" + row.depth), ["__proto__@0", "child@1"]);
  assert.equal(agentPath(child.agents, "child"), "__proto__/child");
});
