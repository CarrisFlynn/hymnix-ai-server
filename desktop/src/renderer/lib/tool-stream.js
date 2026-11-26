/**
 * Tool-call assembly for streamed chat deltas.
 *
 * The OpenAI shape sends a call as fragments keyed by index, with the name once
 * and the arguments as a JSON string. Ollama sends the whole call in one delta
 * with the arguments already parsed. A fragment with neither an index nor an id
 * continues the previous call. All three land in one list here, so the renderer
 * never has to know which provider answered.
 */

/** One assembled call. */
export function createToolCallCollector() {
  const partial = new Map();
  let lastKey = "";

  return {
    /** Feed one delta's `tool_calls` array (may be undefined). */
    push(rawCalls) {
      for (const raw of rawCalls || []) {
        if (!raw || typeof raw !== "object") continue;
        const key = typeof raw.index === "number" ? "i" + raw.index : raw.id ? "id:" + raw.id : (lastKey || "n0");
        lastKey = key;
        const current = partial.get(key) || { id: "", name: "", arguments: "" };
        const value = raw.function ? raw.function.arguments : undefined;
        const piece = typeof value === "string"
          ? value
          : value && typeof value === "object"
            ? JSON.stringify(value)
            : "";
        partial.set(key, {
          id: raw.id || current.id,
          name: (raw.function && raw.function.name) || current.name,
          arguments: current.arguments + piece,
        });
      }
    },
    /** Calls in arrival order; nameless fragments are dropped. */
    calls(makeId) {
      const next = typeof makeId === "function" ? makeId : () => "call_" + Math.random().toString(36).slice(2, 10);
      return [...partial.values()]
        .filter((call) => call.name)
        .map((call) => ({ ...call, id: call.id || next() }));
    },
  };
}
