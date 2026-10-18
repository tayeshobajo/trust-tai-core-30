/**
 * STAGED — NOT WIRED TO ANY ROUTE. Concrete Supabase adapter for durable
 * transcript-coverage attestation. Calls the proposed SQL functions via RPC
 * as the authenticated user (RLS applies). Unusable until the UNAPPLIED
 * patches in `docs/proposed/steward-backend/` are reviewed, applied, and
 * granted.
 *
 * RPC boundary (003_coverage_attestation.up.sql):
 * - steward_attest_coverage(p_org, p_conversation) — the SQL derives the
 *   transcript hash and scope version server-side; the caller supplies
 *   neither (any caller-supplied hash would be spoofable).
 * - steward_current_coverage(p_org, p_conversation) → boolean
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CoverageAttestation,
  CoverageRepository,
} from "./steward-coverage.server";

interface AttestationRow {
  id: string;
  organization_id: string;
  conversation_id: string;
  transcript_hash: string;
  scope_version: number;
  attested_by: string;
  attested_at: string;
  superseded_at: string | null;
}

function mapAttestation(row: AttestationRow): CoverageAttestation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    conversationId: row.conversation_id,
    transcriptHash: row.transcript_hash,
    scopeVersion: row.scope_version,
    attestedBy: row.attested_by,
    attestedAt: row.attested_at,
    supersededAt: row.superseded_at,
  };
}

function rethrow(error: { code?: string; message?: string } | null): never {
  throw new Error(error?.message ?? "coverage call failed");
}

/** The client MUST be the authenticated per-request client (RLS as user). */
export function createSupabaseCoverageRepository(
  supabase: SupabaseClient,
): CoverageRepository & {
  latestAttestation(orgId: string, conversationId: string): Promise<CoverageAttestation | null>;
} {
  return {
    async attest(input) {
      // transcriptHash/scopeVersion are intentionally NOT sent: the SQL
      // derives both from the stored conversation and scope version.
      const { data, error } = await supabase.rpc("steward_attest_coverage", {
        p_org: input.orgId,
        p_conversation: input.conversationId,
      });
      if (error) rethrow(error);
      return mapAttestation(data as AttestationRow);
    },
    async currentCoverage(input) {
      const { data, error } = await supabase.rpc("steward_current_coverage", {
        p_org: input.orgId,
        p_conversation: input.conversationId,
      });
      if (error) rethrow(error);
      return data === true;
    },
    async latestAttestation(orgId, conversationId) {
      const { data, error } = await supabase
        .from("steward_coverage_attestations")
        .select("*")
        .eq("organization_id", orgId)
        .eq("conversation_id", conversationId)
        .order("attested_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) rethrow(error);
      return data ? mapAttestation(data as AttestationRow) : null;
    },
  };
}
