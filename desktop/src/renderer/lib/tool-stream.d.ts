/** Type declarations for tool-stream.js. Keep in sync with the exports. */

export type ToolCallPart = { id: string; name: string; arguments: string };

export declare function createToolCallCollector(): {
  push(rawCalls: unknown): void;
  calls(makeId?: () => string): ToolCallPart[];
};
