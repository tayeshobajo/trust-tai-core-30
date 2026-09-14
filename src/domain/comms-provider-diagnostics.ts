/**
 * Operator diagnostics for a failed reasoning call.
 *
 * When a review fails at the provider, "provider_call_failed" alone is not
 * enough for anyone to act on: an expired key, an exhausted quota, a rejected
 * request body and a dropped connection all arrive under that one word. This
 * module turns the failure into a small, sanitized record an operator can read
 * and a run row can carry.
 *
 * What is deliberately NOT here: credentials, headers, prompt text, draft
 * text, client names, or any provider message verbatim. Only a category, a
 * status code, and the configured provider and model, which are already
 * public facts about this deployment.
 */

export type ProviderErrorCategory =
  | "not_configured"
  | "auth"
  | "quota"
  | "rate_limited"
  | "bad_request"
  | "upstream_error"
  | "timeout"
  | "network"
  | "refused"
  | "unknown";

export interface ProviderDiagnostics {
  /** The provider this deployment would call, from secret-free config. */
  provider: string | null;
  /** The model id that provider is configured with. */
  model: string | null;
  /** The provider's HTTP status, when the failure carried one. */
  status: number | null;
  category: ProviderErrorCategory;
  /** The error class name, never its message. */
  errorName: string;
}

/**
 * Classify by status first, because a status is a fact, then fall back to
 * coarse shapes in the message. The message itself is never kept.
 */
export function categorizeProviderError(input: {
  status?: number | null;
  message?: string | null;
  errorName?: string | null;
  notConfigured?: boolean;
}): ProviderErrorCategory {
  if (input.notConfigured) return "not_configured";
  const status = input.status ?? null;
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "quota";
  if (status === 429) return "rate_limited";
  if (status === 400 || status === 404 || status === 422) return "bad_request";
  if (status !== null && status >= 500) return "upstream_error";

  const text = (input.message ?? "").toLowerCase();
  if (!text) return input.status === null ? "unknown" : "refused";
  if (/invalid_api_key|unauthor|api key|forbidden/.test(text)) return "auth";
  if (/quota|credit|billing|insufficient/.test(text)) return "quota";
  if (/rate limit|too many requests|429/.test(text)) return "rate_limited";
  if (/timed out|timeout|deadline/.test(text)) return "timeout";
  if (/fetch failed|network|econn|socket|dns|aborted/.test(text)) return "network";
  if (/unsupported|unknown parameter|invalid|model/.test(text)) return "bad_request";
  if (/failed before returning|response\.failed/.test(text)) return "refused";
  return "unknown";
}

/** Build the sanitized record. Nothing private can reach it by construction. */
export function providerDiagnostics(input: {
  error: unknown;
  configured: { provider: string | null; model: string | null };
  notConfigured?: boolean;
}): ProviderDiagnostics {
  const error = input.error;
  const status =
    typeof (error as { status?: unknown })?.status === "number"
      ? ((error as { status: number }).status ?? null)
      : null;
  const message = error instanceof Error ? error.message : null;
  return {
    provider: input.configured.provider,
    model: input.configured.model,
    status,
    category: categorizeProviderError({
      status,
      message,
      notConfigured: input.notConfigured ?? false,
    }),
    errorName: error instanceof Error ? error.name : typeof error,
  };
}

/** Stage strings recorded on the failed run, so the evidence outlives the log. */
export function diagnosticStages(diagnostics: ProviderDiagnostics): string[] {
  return [
    `provider:${diagnostics.provider ?? "none"}`,
    `model:${diagnostics.model ?? "none"}`,
    `provider_status:${diagnostics.status ?? "none"}`,
    `provider_error:${diagnostics.category}`,
  ];
}

/** One log line for an operator. Contains no credential and no private text. */
export function diagnosticsLogLine(scope: string, diagnostics: ProviderDiagnostics): string {
  return `[${scope}] provider call failed · provider=${diagnostics.provider ?? "none"} model=${
    diagnostics.model ?? "none"
  } status=${diagnostics.status ?? "none"} category=${diagnostics.category} error=${
    diagnostics.errorName
  }`;
}
