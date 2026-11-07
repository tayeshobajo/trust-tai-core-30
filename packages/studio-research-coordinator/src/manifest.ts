import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
export const manifest: PaperclipPluginManifestV1 = {
  id: "trusttai.studio-research-coordinator",
  apiVersion: 1,
  version: "0.1.0-dev.12",
  displayName: "Studio Research Coordinator (local candidate)",
  description:
    "Disabled-by-default, request-specific manual research coordinator. No native heartbeat, schedules, outreach or publishing.",
  author: "Trust Tai",
  categories: ["automation"],
  minimumHostVersion: "2026.1012.0",
  capabilities: ["api.routes.register", "secrets.read-ref"],
  instanceConfigSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      version: { const: 1 },
      mode: { const: "linux-public-preview" },
      enabled: { type: "boolean" },
      policyDigest: { type: "string" },
      studioPublicKeyPem: { type: "string" },
      hostSigningKey: { type: "object" },
      providerKey: { type: "object" },
    },
  },
  entrypoints: { worker: "dist/worker.js" },
  apiRoutes: (["run", "read", "cancel", "review", "reconcile"] as const).map((operation) => ({
    routeKey: `signed-${operation}`,
    method: "POST" as const,
    path: `/issues/:issueId/research/:requestId/${operation}`,
    auth: "agent" as const,
    capability: "api.routes.register" as const,
    companyResolution: { from: "issue" as const, param: "issueId" },
  })),
};
export default manifest;
