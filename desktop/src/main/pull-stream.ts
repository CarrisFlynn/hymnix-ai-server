import type { PullProgress } from "../shared/protocol";

export async function readPullStream(response: Response, onProgress: (event: PullProgress) => void): Promise<void> {
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof payload?.error === "string" ? payload.error : "Ollama download HTTP " + response.status);
  }
  if (!response.body) throw new Error("Ollama returned an empty download stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  function dispatch(line: string): boolean {
    if (!line.trim()) return false;
    const data: unknown = JSON.parse(line);
    if (!data || typeof data !== "object") throw new Error("Invalid Ollama download response.");
    const record = data as Record<string, unknown>;
    if (typeof record.error === "string") throw new Error(record.error);
    if (typeof record.status !== "string") throw new Error("Invalid Ollama download status.");
    const progress: PullProgress = { status: record.status };
    if (typeof record.digest === "string") progress.digest = record.digest;
    if (Number.isSafeInteger(record.total) && Number(record.total) >= 0) progress.total = Number(record.total);
    if (Number.isSafeInteger(record.completed) && Number(record.completed) >= 0) progress.completed = Number(record.completed);
    onProgress(progress);
    return progress.status === "success";
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) if (dispatch(line)) return;
      if (pending.length > 65_536) throw new Error("Ollama download status exceeded the expected size.");
      if (done) {
        if (dispatch(pending)) return;
        throw new Error("Ollama disconnected before the download completed.");
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
