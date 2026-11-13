import type { ResearchDeps } from "./studio-research.server";
export function createStudioTransport(
  config: { origin: string; key: string; companyId: string; projectId: string; agentId: string },
  fetcher?: typeof fetch,
): {
  readAgent: ResearchDeps["agent"];
  createIssue: ResearchDeps["createIssue"];
  readIssue: ResearchDeps["readIssue"];
};

export function studioTransportDiagnostic(error: unknown): string;

/** Separate provenance-bound transport for explicitly authorized intake recovery. */
export function createPausedStudioIntakeTransport(
  config: { origin: string; key: string; companyId: string; projectId: string; agentId: string },
  binding: { bridgeKeyId: string; organizationId: string; requestId: string; title: string; description: string },
  fetcher?: typeof fetch,
): {
  readAgent: ResearchDeps["agent"];
  createIssue(input: Parameters<ResearchDeps["createIssue"]>[0]): Promise<{
    id: string; companyId: string; projectId: string; assigneeAgentId: null;
    originKind: "task_bridge"; originId: string; createdByAgentId: string;
  }>;
  readIssue(companyId: string, issueId: string): Promise<{
    id: string; companyId: string; projectId: string; assigneeAgentId: null;
    originKind: "task_bridge"; originId: string; createdByAgentId: string;
  }>;
};
