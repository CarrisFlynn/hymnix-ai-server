import type { AdminClientsResponse, AdminErrorRecord, AdminHistoryQuery, AdminHistoryResponse, AdminStatus, ApprovalDecisionResponse, ApprovalListResponse, DesktopApi, ToolCallRequest, ToolCallResponse, ToolsResponse } from "../shared/protocol";

export type DesktopApiWithAdminHistory = DesktopApi & {
  adminHistory: (adminKey: string, query?: AdminHistoryQuery) => Promise<AdminHistoryResponse>;
  tools: {
    list: (apiKey?: string) => Promise<ToolsResponse>;
    call: (request: ToolCallRequest) => Promise<ToolCallResponse>;
    pending: () => Promise<ApprovalListResponse>;
    approve: (id: string) => Promise<ApprovalDecisionResponse>;
    deny: (id: string) => Promise<ApprovalDecisionResponse>;
  };
  gateway: DesktopApi["gateway"] & {
    adminStatus: (adminKey: string) => Promise<AdminStatus>;
    adminErrors: (adminKey: string, limit?: number) => Promise<AdminErrorRecord[]>;
    adminClients: (adminKey: string) => Promise<AdminClientsResponse>;
  };
};

declare global {
  interface Window {
    desktop: DesktopApi;
  }
}

export {};

