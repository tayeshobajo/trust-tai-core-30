// src/lib/paperclip-client.server.ts
// Server-only: typed Paperclip board API client

if (typeof window !== 'undefined') {
  throw new Error('paperclip-client.server.ts must not be imported on the client');
}

const PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL ?? 'http://127.0.0.1:3100';
const PAPERCLIP_API_KEY = process.env.PAPERCLIP_BOARD_API_KEY ?? '';

async function paperclipFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${PAPERCLIP_API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${PAPERCLIP_API_KEY}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Paperclip API ${res.status}: ${text}`);
  }
  return res.json();
}

export interface PaperclipAgent {
  id: string;
  name: string;
  status: string;
  companyId: string;
}

export interface PaperclipIssue {
  id: string;
  title: string;
  status: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
}

export const paperclipClient = {
  async getAgent(agentId: string): Promise<PaperclipAgent> {
    return paperclipFetch(`/api/agents/${agentId}`);
  },

  async listIssues(companyId: string, status?: string): Promise<PaperclipIssue[]> {
    const params = new URLSearchParams({ companyId });
    if (status) params.set('status', status);
    return paperclipFetch(`/api/issues?${params}`);
  },

  async createIssue(payload: {
    companyId: string;
    title: string;
    agentId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<PaperclipIssue> {
    return paperclipFetch('/api/issues', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
