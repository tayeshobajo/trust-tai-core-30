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
