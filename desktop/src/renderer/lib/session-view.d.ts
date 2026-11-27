/** Type declarations for session-view.js. Keep in sync with the exports. */

export type SessionRow = { id: string; title: string; messages: number; model: string; pinned: boolean; updatedAt: string };
export type SessionHit = { index: number; role: string; snippet: string };
export type SessionMatch = { id: string; title: string; updatedAt: string; matchCount: number; hits: SessionHit[] };

export declare function listSessionsView(sessions: readonly unknown[] | null | undefined, options?: { pinnedOnly?: boolean; limit?: number }): { total: number; sessions: SessionRow[] };
export declare function snippetAround(text: string, query: string): string;
export declare function searchSessions(sessions: readonly unknown[] | null | undefined, options?: { query?: string; limit?: number; perSession?: number }): { error?: string; total: number; sessions: SessionMatch[] };
