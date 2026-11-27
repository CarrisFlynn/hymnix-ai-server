export type AgentRecord = { name: string; system: string; messages: { role: string; content: string }[]; updatedAt: number; lastError?: string };
export type AgentMap = Record<string, AgentRecord>;
export declare function emptyAgents(): AgentMap;
export declare function spawnAgent(agents: AgentMap, name: string, system?: string): { agents?: AgentMap; error?: string };
export declare function appendExchange(agents: AgentMap, name: string, userText: string, reply: { ok: boolean; text?: string; error?: string }): { agents?: AgentMap; error?: string };
export declare function wireMessages(agent: AgentRecord): { role: string; content: string }[];
export declare function listAgents(agents: AgentMap): { name: string; messages: number; updatedAt: number; lastError: string }[];
export declare function closeAgent(agents: AgentMap, name: string): { agents?: AgentMap; error?: string };
