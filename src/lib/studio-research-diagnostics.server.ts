// Only fixed categories may cross the authenticated connection-check boundary.
// Never serialize upstream messages, causes, headers, credentials or identifiers.
const categories = [
  "authentication_required",
  "membership_required",
  "access_lookup_failed",
  "access_denied",
  "access_check_failed",
  "binding_missing",
  "binding_mismatch",
  "workspace_lookup_failed",
  "workspace_mismatch",
  "unexpected_failure",
  "storage_key_missing",
  "storage_network_failure",
  "storage_redirect_rejected",
  "storage_http_401",
  "storage_http_403",
  "storage_http_404",
  "storage_http_other",
  "storage_response_invalid",
] as const;
export type ResearchDiagnostic = (typeof categories)[number];
export class ResearchDiagnosticError extends Error {
  constructor(readonly category: ResearchDiagnostic) {
    super("Research connection check failed.");
  }
}
export function researchDiagnostic(error: unknown): ResearchDiagnostic {
  return error instanceof ResearchDiagnosticError && categories.includes(error.category)
    ? error.category
    : "unexpected_failure";
}
