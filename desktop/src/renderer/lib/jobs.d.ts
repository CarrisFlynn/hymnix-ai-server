/** Type declarations for jobs.js. Keep in sync with the exports. */

export type JobStatus = "running" | "done" | "failed" | "cancelled";
export type JobFilter = "all" | "running" | "finished";

export type JobView = {
  id: string;
  kind: string;
  title: string;
  command?: string;
  status: JobStatus;
  startedAt: number;
  finishedAt?: number | null;
  exitCode?: number | null;
  error?: string;
  output?: string;
};

export declare function isActiveJob(job: JobView | null | undefined): boolean;
export declare function sortJobs<T extends JobView>(jobs: T[] | null | undefined): T[];
export declare function mergeJob<T extends JobView>(jobs: T[] | null | undefined, job: T): T[];
export declare function activeJobCount(jobs: JobView[] | null | undefined): number;
export declare function jobElapsed(job: JobView | null | undefined, now?: number): number;
export declare function formatElapsed(ms: number | null | undefined): string;
export declare function filterJobs<T extends JobView>(jobs: T[] | null | undefined, filter: JobFilter): T[];
export declare function jobStatusLabel(status: string): string;
export declare function jobSummary(job: JobView | null | undefined): string;
