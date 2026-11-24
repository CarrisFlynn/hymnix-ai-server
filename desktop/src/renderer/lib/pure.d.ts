/**
 * Type declarations for `pure.js`. The renderer runs with `allowJs: false`, so the
 * framework-free helpers need a hand-written surface. Keep this file in sync with
 * the exports in `pure.js`; `tests/components.test.mjs` asserts the behaviour.
 */

export declare function estimateTokens(text: string): number;

export declare function parseSlashCommand(input: string): {
  command: string;
  argument: string;
  isCommand: boolean;
};

export type ConnectErrorCategory = "password" | "unreachable" | "version" | "unknown";

export declare function classifyConnectError(message: unknown): {
  category: ConnectErrorCategory;
  hint: string;
};

export declare function downloadBytes(bytes: number, lang: string): string;

export type PasswordScore = 0 | 1 | 2 | 3 | 4;

export declare function passwordStrength(password: string): {
  score: PasswordScore;
  label: "empty" | "weak" | "fair" | "good" | "strong";
};
