import type { PullProgress } from "../shared/protocol";

export function trackDownloadProgress() {
  let sample: { layer: string; completed: number; time: number } | undefined;
  let bytesPerSecond: number | undefined;

  return (progress: PullProgress, now = performance.now()) => {
    const { status, digest, completed, total } = progress;
    if (total == null || !Number.isFinite(total) || total <= 0 || completed == null || !Number.isFinite(completed)) {
      sample = undefined;
      bytesPerSecond = undefined;
      return { status, completed: undefined, total: undefined, bytesPerSecond: undefined };
    }

    const layer = digest ?? status;
    const bytes = Math.max(0, Math.min(completed, total));
    if (!sample || sample.layer !== layer || bytes < sample.completed) {
      sample = { layer, completed: bytes, time: now };
      bytesPerSecond = undefined;
    } else if (now - sample.time >= 250) {
      const observed = (bytes - sample.completed) * 1000 / (now - sample.time);
      bytesPerSecond = observed === 0 || bytesPerSecond === undefined ? observed : (observed + bytesPerSecond) / 2;
      sample = { layer, completed: bytes, time: now };
    }
    return { status, completed: bytes, total, bytesPerSecond };
  };
}

export function pullErrorMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  return message.replace(/^Error invoking remote method 'models:pull-stream': (?:Error: )?/, "");
}
