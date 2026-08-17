interface PaperclipRequestOptions extends RequestInit {
  searchParams?: URLSearchParams;
}

export interface PaperclipAgent {
  id: string;
  companyId: string;
  name: string;
  title?: string | null;
  status: string;
  role?: string | null;
  lastHeartbeatAt?: string | null;
  updatedAt?: string | null;
  runtimeConfig?: {
    heartbeat?: {
      enabled?: boolean;
      wakeOnDemand?: boolean;
      cooldownSec?: number;
      maxConcurrentRuns?: number;
    };
  } | null;
}

export interface PaperclipRoutineRunSummary {
  id: string;
  status?: string | null;
  source?: string | null;
  routineId?: string | null;
  issueId?: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt?: string | null;
}

export interface PaperclipIssue {
  id: string;
  identifier?: string | null;
  title: string;
  status: string;
  priority?: string | null;
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
  responsibleUserId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
}

export interface PaperclipIssueFilter {
  assigneeAgentId?: string;
  limit?: number;
  projectId?: string;
  status?: string[];
}

export interface PaperclipCreateIssueInput {
  title: string;
  description: string;
  createdByAgentId: string;
  status?: string;
  priority?: string;
  assigneeAgentId?: string;
  goalId?: string;
  parentId?: string;
}

function paperclipApiUrl(): string {
  return process.env["PAPERCLIP_API_URL"] || "http://127.0.0.1:3100";
}

function paperclipBoardKey(): string {
  const key = process.env["PAPERCLIP_BOARD_KEY"];
  if (!key) {
    throw new Error("Missing PAPERCLIP_BOARD_KEY for the Paperclip board API.");
  }
  return key;
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Paperclip API ${response.status} ${response.statusText}: ${body || "request failed"}`,
    );
  }
  return (await response.json()) as T;
}

async function request<T>(path: string, init: PaperclipRequestOptions = {}): Promise<T> {
  const url = new URL(path, paperclipApiUrl());
  if (init.searchParams) {
    init.searchParams.forEach((value, key) => url.searchParams.set(key, value));
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${paperclipBoardKey()}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, { ...init, headers });
  return parseResponse<T>(response);
}

async function requestFirstMatch<T>(
  paths: string[],
  init: PaperclipRequestOptions = {},
): Promise<T> {
  let lastError: Error | null = null;
  for (const path of paths) {
    try {
      return await request<T>(path, init);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("404")) throw error;
      lastError = error instanceof Error ? error : new Error(message);
    }
  }
  throw lastError ?? new Error("No matching Paperclip API route responded.");
}

export const paperclipClient = {
  getAgent(agentId: string) {
    return request<PaperclipAgent>(`/api/agents/${agentId}`);
  },

  getRoutineRuns(routineId: string, limit = 5) {
    const searchParams = new URLSearchParams({ limit: String(limit), routineId });
    return requestFirstMatch<PaperclipRoutineRunSummary[]>(
      [
        `/api/routines/${routineId}/runs`,
        `/api/routine-runs/${routineId}`,
        `/api/routine-runs`,
      ],
      { searchParams },
    );
  },

  getIssues(companyId: string, filter: PaperclipIssueFilter = {}) {
    const searchParams = new URLSearchParams();
    if (filter.assigneeAgentId) {
      searchParams.set("assigneeAgentId", filter.assigneeAgentId);
    }
    if (filter.projectId) {
      searchParams.set("projectId", filter.projectId);
    }
    if (filter.limit) {
      searchParams.set("limit", String(filter.limit));
    }
    if (filter.status && filter.status.length > 0) {
      searchParams.set("status", filter.status.join(","));
    }
    return request<PaperclipIssue[]>(`/api/companies/${companyId}/issues`, { searchParams });
  },

  createIssue(companyId: string, payload: PaperclipCreateIssueInput) {
    return request<PaperclipIssue>(`/api/companies/${companyId}/issues`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  triggerHeartbeat(agentId: string) {
    return requestFirstMatch<Record<string, unknown>>(
      [
        `/api/agents/${agentId}/wake`,
        `/api/agents/${agentId}/wake-on-demand`,
        `/api/agents/${agentId}/heartbeat`,
        `/api/agents/${agentId}/heartbeat/trigger`,
      ],
      { method: "POST" },
    );
  },
};
