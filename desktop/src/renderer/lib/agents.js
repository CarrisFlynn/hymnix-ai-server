/**
 * Named agents that keep their own conversation history.
 *
 * The transport is one non-streaming completion per message; this module only
 * owns the state transitions, so the renderer stays thin and the rules are
 * testable without a model.
 */

const MAX_AGENTS = 6;
const MAX_MESSAGES = 40;
const MAX_TEXT = 8000;

export function emptyAgents() {
  return {};
}

/** Create one named agent; returns a new map. Refuses duplicates and overflow. */
export function spawnAgent(agents, name, system = "") {
  const id = String(name || "").trim().slice(0, 40);
  if (!id) return { error: "name_required" };
  if (agents[id]) return { error: "already_exists" };
  if (Object.keys(agents).length >= MAX_AGENTS) return { error: "too_many_agents" };
  return {
    agents: { ...agents, [id]: { name: id, system: String(system || "").slice(0, MAX_TEXT), messages: [], updatedAt: Date.now() } },
  };
}

/**
 * Append one exchange. A failed reply is stored with its error so the next send
 * still has the user's message in context instead of silently losing it.
 */
export function appendExchange(agents, name, userText, reply) {
  const agent = agents[name];
  if (!agent) return { error: "no_agent" };
  const messages = agent.messages.concat([{ role: "user", content: String(userText || "").slice(0, MAX_TEXT) }]);
  if (reply && reply.ok) messages.push({ role: "assistant", content: String(reply.text || "").slice(0, MAX_TEXT) });
  return {
    agents: { ...agents, [name]: { ...agent, messages: messages.slice(-MAX_MESSAGES), updatedAt: Date.now(), lastError: reply && !reply.ok ? String(reply.error || "failed").slice(0, 200) : "" } },
  };
}

/** The wire messages for one call: system prompt (if any) plus the transcript. */
export function wireMessages(agent) {
  const list = [];
  if (agent.system) list.push({ role: "system", content: agent.system });
  return list.concat(agent.messages);
}

export function listAgents(agents) {
  return Object.values(agents).map((agent) => ({
    name: agent.name,
    messages: agent.messages.length,
    updatedAt: agent.updatedAt,
    lastError: agent.lastError || "",
  }));
}

export function closeAgent(agents, name) {
  if (!agents[name]) return { error: "no_agent" };
  const next = { ...agents };
  delete next[name];
  return { agents: next };
}
