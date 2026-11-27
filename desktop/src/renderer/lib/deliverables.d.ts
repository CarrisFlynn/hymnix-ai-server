/** Type declarations for deliverables.js. Keep in sync with the exports. */

export type Deliverable = { path: string; description: string };

export declare function normalizeDeliverables(input: unknown): Deliverable[];
export declare function leafName(path: string): string;
