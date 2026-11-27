/** Type declarations for ask.js. Keep in sync with the exports. */

export type AskOption = { label: string; description: string };
export type AskQuestion = { id: string; question: string; header: string; options: AskOption[]; multiSelect: boolean };
export type AskAnswer = { id: string; selected: string[]; custom?: string };

export declare function normalizeQuestions(input: unknown): AskQuestion[];
export declare function buildAnswers(questions: AskQuestion[], picked?: Record<string, string[]>, custom?: Record<string, string>): AskAnswer[];
export declare function allSkipped(answers: AskAnswer[]): boolean;
