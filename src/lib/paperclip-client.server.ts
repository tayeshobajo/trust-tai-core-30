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
  /** Set on company-level pauses; agent status="paused" does not populate it. */
  pausedAt?: string | null;
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
  description?: string | null;
  status: string;
  priority?: string | null;
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
  responsibleUserId?: string | null;
  originKind?: string | null;
  originId?: string | null;
  startedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  blockerAttention?: {
    state: string;
    reason: string | null;
    unresolvedBlockerCount: number;
  } | null;
}

export interface PaperclipComment {
  id: string;
  companyId: string;
  issueId: string;
  authorAgentId: string | null;
  authorUserId: string | null;
  authorType: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface PaperclipRoutine {
  id: string;
  companyId: string;
  title: string;
  description?: string | null;
  status: string;
  assigneeAgentId: string | null;
  lastTriggeredAt?: string | null;
  createdAt: string;
  updatedAt: string;
  lastRun?: {
    id: string;
    status: string;
    triggeredAt: string | null;
    completedAt: string | null;
    linkedIssue?: { id: string; identifier: string; title: string; status: string } | null;
  } | null;
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

/**
 * Where this deployment believes Paperclip lives, described as metadata only.
 *
 * The origin is not a secret, but a key never travels with it. `loopback`
 * being true is why a deployment can only ever be SYNCHRONIZED: a hosted
 * Trust Tai OS cannot reach a laptop's 127.0.0.1.
 */
export function paperclipHostInfo(): {
  origin: string;
  tls: boolean;
  loopback: boolean;
  configured: boolean;
} {
  const configured = Boolean(process.env["PAPERCLIP_API_URL"]);
  const raw = paperclipApiUrl();
  try {
    const url = new URL(raw);
    return {
      origin: url.origin,
      tls: url.protocol === "https:",
      loopback: ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(url.hostname),
      configured,
    };
  } catch {
    return { origin: raw, tls: false, loopback: false, configured };
  }
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
  /** Cheap reachability probe for diagnostics. Never throws. */
  async ping(): Promise<boolean> {
    try {
      const url = new URL("/api/health", paperclipApiUrl());
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${paperclipBoardKey()}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  },

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
        // Confirmed against Paperclip server 2026.722.0 (dist route registration):
        // the real on-demand wake endpoint is /wakeup. Older fallbacks kept last
        // in case of version drift.
        `/api/agents/${agentId}/wakeup`,
        `/api/agents/${agentId}/wake`,
        `/api/agents/${agentId}/wake-on-demand`,
        `/api/agents/${agentId}/heartbeat`,
        `/api/agents/${agentId}/heartbeat/trigger`,
      ],
      { method: "POST", body: JSON.stringify({}) },
    );
  },

  /** Set agent paused state. Returns the updated agent.
   *
   * Paperclip models pause as agent *status* ("paused" in AGENT_STATUSES), not a
   * boolean — `{ paused: true }` is silently ignored. Resume restores "active";
   * callers that want to preserve a prior non-paused status must pass it through
   * resumeStatus.
   */
  setAgentPaused(agentId: string, paused: boolean, resumeStatus = "active") {
    return request<PaperclipAgent>(`/api/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: paused ? "paused" : resumeStatus }),
    });
  },

  /** Update an issue's status. Returns the updated issue. */
  updateIssueStatus(issueId: string, status: string) {
    return request<PaperclipIssue>(`/api/issues/${issueId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  },

  /** Read comments for an issue (activity timeline). */
  getIssueComments(issueId: string) {
    return request<PaperclipComment[]>(`/api/issues/${issueId}/comments`);
  },

  /** List routines for a company. */
  getRoutines(companyId: string) {
    return request<PaperclipRoutine[]>(`/api/companies/${companyId}/routines`);
  },

  /** List pending approvals for a company. Returns [] when endpoint not supported. */
  async getApprovals(companyId: string): Promise<Record<string, unknown>[]> {
    try {
      return await request<Record<string, unknown>[]>(`/api/companies/${companyId}/approvals`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("404") || msg.includes("not found")) return [];
      throw error;
    }
  },

  /** List all agents for a company. */
  getCompanyAgents(companyId: string) {
    return request<PaperclipAgent[]>(`/api/companies/${companyId}/agents`);
  },
};
