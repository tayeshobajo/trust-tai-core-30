/**
 * The fragmentation guard registry.
 *
 * The law: no business app may become its own isolated AI brain. In code that
 * means exactly one reasoning boundary — src/lib/intelligence-runtime.server.ts —
 * sitting on top of a small set of low-level transport modules, and nothing
 * else in the suite importing providers, provider configuration, or AI
 * endpoint URLs.
 *
 * This module is the data the guard test (intelligence-runtime-boundary.test.ts)
 * enforces. It is also the migration map: every documented exception names the
 * bypass it currently holds and the runtime contract it must adopt. Removing
 * an exception is done by migrating the file and deleting its entry — never by
 * widening the allowlist.
 */

/**
 * Low-level modules that may legitimately touch provider machinery. These are
 * the boundary itself and its transport plumbing — not reasoning entry points.
 */
export const CANONICAL_REASONING_MODULES: string[] = [
  /** The one reasoning boundary. Rooms call this. */
  "src/lib/intelligence-runtime.server.ts",
  /** Low-level provider transport + JSON extraction + membership check. */
  "src/lib/roadmap-research.server.ts",
  /** Provider selection configuration (endpoints, models, keys). */
  "src/lib/scout-provider.server.ts",
  /** Gateway run-id plumbing (no reasoning). */
  "src/lib/ai-gateway.server.ts",
];

export interface ReasoningException {
  file: string;
  /** The bypass it currently holds. */
  bypass: string;
  /** The runtime contract it must adopt to leave this list. */
  migration: string;
}

/**
 * Documented pre-existing call sites, pending migration. Each is a known
 * fragment of the pre-runtime era; the guard fails if any NEW file joins them.
 */
export const REASONING_EXCEPTIONS: ReasoningException[] = [
  {
    file: "src/lib/intelligence-reason.server.ts",
    bypass: "engine reasoning endpoint assembles its own prompt via the transport",
    migration:
      "adopt ReasoningRequest + verifyRuntimeRead from src/data/intelligence/runtime/reason.ts",
  },
  {
    file: "src/lib/steward-interpret.server.ts",
    bypass: "steward interpretation composes its own provider call via the transport",
    migration: "route through reasonWithRuntime with output: 'interpretation'",
  },
  {
    file: "src/lib/roadmap-studio.server.ts",
    bypass: "studio generation composes its own two-step provider calls via the transport",
    migration: "route both steps through reasonWithRuntime (evidence packet, then expression)",
  },
  {
    file: "src/lib/scout-discover.server.ts",
    bypass: "direct provider fetch with web search and a bespoke stream parser",
    migration: "route through reasonWithRuntime with output: 'research' and runtime retrieval",
  },
  {
    file: "src/lib/comms-draft.server.ts",
    bypass: "direct provider fetch for draft composition",
    migration: "route through reasonWithRuntime with output: 'draft'",
  },
];

/**
 * Import specifiers that signal a room is building its own AI stack.
 * Forbidden everywhere outside CANONICAL_REASONING_MODULES and the documented
 * exceptions above.
 */
export const FORBIDDEN_PROVIDER_IMPORTS: string[] = [
  "@/lib/scout-provider.server",
  "@/lib/roadmap-research.server",
];

/**
 * URL fragments that signal a direct provider or gateway call. Forbidden in
 * app code outside the canonical transport modules.
 */
export const FORBIDDEN_PROVIDER_URLS: string[] = [
  "api.openai.com",
  "ai.gateway.lovable.dev",
  "generativelanguage.googleapis.com",
];

/**
 * The gateway run-id plumbing may be imported by API route handlers (it is
 * transport plumbing, not reasoning), but never by room services, domain
 * modules or components.
 */
export const RUN_ID_PLUMBING = "@/lib/ai-gateway.server";
export const RUN_ID_ALLOWED_PREFIXES = ["src/routes/api/", "src/lib/"];
