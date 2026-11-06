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
