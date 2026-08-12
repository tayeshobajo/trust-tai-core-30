/**
 * Trust Tai OS — intelligence context contract.
 *
 * Small input. Deep intelligence. Clear output.
 *
 * This defines HOW context will be retrieved across apps with provenance and
 * authorization. It does not orchestrate live AI yet — the current
 * implementation is a mocked, in-memory provider.
 */

import type { Provenance } from "./activity";
import type { EntityRef, ID } from "./entities";

export interface ContextRequest {
  organizationId: ID;
  /** The user asking — authorization is always evaluated per user. */
  userId: ID;
  /** What the context is about. */
  subject?: EntityRef;
  /** Plain-language question or intent. */
  question?: string;
  /** Restrict to specific registered apps. */
  appIds?: ID[];
  limit?: number;
}

/** A single retrieved fact, always carrying where it came from. */
export interface ContextFact {
  id: ID;
  statement: string;
  subject: EntityRef;
  provenance: Provenance;
  /** Explicitly separates AI suggestion from approved human decision. */
  kind: "fact" | "inference" | "recommendation";
}

export interface ContextResult {
  request: ContextRequest;
  facts: ContextFact[];
  /** Apps that were readable for this user; anything else was withheld. */
  authorizedAppIds: ID[];
  /** Apps intentionally excluded, with reason. Fails closed by default. */
  withheld: { appId: ID; reason: "unauthorized" | "not_connected" }[];
  generatedAt: string;
}

export interface IntelligenceProvider {
  retrieve(request: ContextRequest): Promise<ContextResult>;
}
