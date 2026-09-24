/**
 * Organizational principles: persistence and read-back for the learning
 * engine's durable store (supabase/migrations/20260924150000_*.sql).
 *
 * Members read (RLS select policy); only the service role writes. Rows are
 * never deleted: retirement and supersession are updates the database
 * lifecycle trigger polices with the same rules the pure state machine
 * (src/domain/principle-lifecycle.ts) encodes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PrincipleDomain } from "@/domain/learning-unit";
import type { Principle, PrincipleStatus } from "@/domain/principle-lifecycle";
import { principlesForScope, type RetrievalPrinciple } from "@/lib/scout-retrieval";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;
type Row = Record<string, unknown>;

const TABLE = "organizational_principles";

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jsonArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

export function toPrinciple(row: Row): Principle {
  return {
    id: String(row["id"] ?? ""),
    organizationId: String(row["organization_id"] ?? ""),
    principle: String(row["principle"] ?? ""),
    scope: {
      domain: String(row["scope_domain"] ?? "relationship_nurture") as PrincipleDomain,
      contextTags: strings(row["scope_context_tags"]),
    },
    status: String(row["status"] ?? "provisional") as PrincipleStatus,
    source: row["source"] === "tai_confirmed" ? "tai_confirmed" : "inferred",
    confidence: typeof row["confidence"] === "number" ? row["confidence"] : Number(row["confidence"] ?? 0.5),
    supportingEvidence: jsonArray(row["supporting_evidence"]),
    contradictingEvidence: jsonArray(row["contradicting_evidence"]),
    contextsObserved: strings(row["contexts_observed"]),
    relationshipsObserved: strings(row["relationships_observed"]),
    lastValidatedAt: typeof row["last_validated_at"] === "string" ? row["last_validated_at"] : null,
    supersededBy: typeof row["superseded_by"] === "string" ? row["superseded_by"] : null,
    transitionReason: typeof row["transition_reason"] === "string" ? row["transition_reason"] : null,
  };
}

function toRow(principle: Principle): Row {
  return {
    organization_id: principle.organizationId,
    principle: principle.principle,
    scope_domain: principle.scope.domain,
    scope_context_tags: principle.scope.contextTags,
    status: principle.status,
    source: principle.source,
    confidence: principle.confidence,
    supporting_evidence: principle.supportingEvidence,
    contradicting_evidence: principle.contradictingEvidence,
    contexts_observed: principle.contextsObserved,
    relationships_observed: principle.relationshipsObserved,
    last_validated_at: principle.lastValidatedAt,
    superseded_by: principle.supersededBy,
    transition_reason: principle.transitionReason,
  };
}

/** The whole store as plain sentences: the "what is the system learning?" read. */
export async function readPrinciples(
  client: Client,
  organizationId: string,
): Promise<Principle[]> {
  try {
    const { data, error } = await client
      .from(TABLE)
      .select("*")
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false });
    if (error || !data) return [];
    return (data as Row[]).map(toPrinciple);
  } catch {
    return [];
  }
}

/** Retrieval mapping. Only active/strengthened principles influence reads. */
export function asRetrievalPrinciples(principles: Principle[]): RetrievalPrinciple[] {
  return principles
    .filter((p) => p.status === "active" || p.status === "strengthened")
    .map((p) => ({
      id: p.id,
      organizationId: p.organizationId,
      principle: p.principle,
      scope: p.scope,
      status: p.status,
      confidence: p.confidence,
      lastValidatedAt: p.lastValidatedAt,
    }));
}

/**
 * The one-line read live call sites use to bring learned principles into a
 * retrieval compose: fetch, keep active/strengthened only, filter to the
 * caller's honest scope. Best-effort by contract: a failed principles read
 * never breaks discovery or drafting, it is an empty list. Missing data is
 * preferable to false attribution.
 */
export async function readRetrievalPrinciples(
  client: Client,
  organizationId: string,
  scope: { domain: string; contextTags: string[] },
): Promise<RetrievalPrinciple[]> {
  try {
    return principlesForScope(
      asRetrievalPrinciples(await readPrinciples(client, organizationId)),
      scope,
    );
  } catch {
    return [];
  }
}

/**
 * The same best-effort read for call sites that hold only the caller's JWT
 * (smart import). The client is built exactly like the other caller-token
 * reads (see readIntelligenceCases), so RLS and the workspace boundary
 * still decide what is visible.
 */
export async function readRetrievalPrinciplesAsCaller(
  token: string,
  organizationId: string,
  scope: { domain: string; contextTags: string[] },
): Promise<RetrievalPrinciple[]> {
  try {
    const { trustTaiSupabaseKey, trustTaiSupabaseUrl } = await import(
      "@/lib/trust-tai-backend.server"
    );
    const { createClient } = await import("@supabase/supabase-js");
    const key = trustTaiSupabaseKey();
    const client = createClient(trustTaiSupabaseUrl(), key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}`, apikey: key } },
    });
    return readRetrievalPrinciples(client, organizationId, scope);
  } catch {
    return [];
  }
}

/**
 * Persist consolidation output. New provisional principles insert; existing
 * ones update in place, with the database lifecycle trigger as the final
 * judge of every transition. Service-role client only. Best-effort per row:
 * one refused write (an unlawful transition) never blocks the rest, and the
 * refusals are returned for the weekly report.
 */
export async function persistPrinciples(
  writer: Client,
  principles: Principle[],
): Promise<{ written: number; refused: { id: string; because: string }[] }> {
  let written = 0;
  const refused: { id: string; because: string }[] = [];
  for (const principle of principles) {
    const isNew = principle.id.startsWith("provisional:");
    try {
      if (isNew) {
        const { error } = await writer.from(TABLE).insert(toRow(principle));
        if (error) refused.push({ id: principle.id, because: error.message });
        else written += 1;
      } else {
        const { error } = await writer
          .from(TABLE)
          .update(toRow(principle))
          .eq("id", principle.id)
          .eq("organization_id", principle.organizationId);
        if (error) refused.push({ id: principle.id, because: error.message });
        else written += 1;
      }
    } catch (error) {
      refused.push({
        id: principle.id,
        because: error instanceof Error ? error.message : "write failed",
      });
    }
  }
  return { written, refused };
}
