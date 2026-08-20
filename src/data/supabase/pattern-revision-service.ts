/**
 * Persistence for revision proposal governance.
 *
 * One append-only table. A person's answer to a proposal is stored, and the
 * canon text is not touched: accepting authorises a later, versioned review.
 * A missing table reads as an empty ledger so the surface still answers, and
 * refuses to write with the migration named.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";
import type { PatternRevisionDecision } from "@/domain/intelligence-canon";

type Row = Record<string, unknown>;

const MISSING =
  "The revision proposal ledger is not in this database yet. Apply docs/intelligence-canon-governance-schema.sql.";

function missing(message: string): boolean {
  return message.includes("does not exist") || message.includes("schema cache");
}

function fail(error: { message: string }): never {
  throw new Error(missing(error.message) ? MISSING : error.message);
}

function toDecision(row: Row): PatternRevisionDecision {
  const note = row["note"];
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    patternId: String(row["pattern_id"]),
    patternVersion: Number(row["pattern_version"] ?? 1),
    proposalFingerprint: String(row["proposal_fingerprint"]),
    proposalText: String(row["proposal_text"] ?? ""),
    outcomeRefs: (row["outcome_refs"] ?? []) as ID[],
    decision: String(row["decision"]) as PatternRevisionDecision["decision"],
    ...(typeof note === "string" && note.length > 0 ? { note } : {}),
    decidedBy: String(row["decided_by"] ?? ""),
    decidedAt: String(row["decided_at"]),
  };
}

export const patternRevisionService = {
  async list(organizationId: ID): Promise<PatternRevisionDecision[]> {
    const { data, error } = await supabase
      .from("pattern_revision_decisions")
      .select("*")
      .eq("organization_id", organizationId)
      .order("decided_at", { ascending: false })
      .limit(200);
    if (error) return missing(error.message) ? [] : fail(error);
    return (data ?? []).map((row) => toDecision(row as Row));
  },

  /**
   * A person's answer, recorded once per proposal fingerprint. A retry, a
   * double click or a re-render resolves to the answer already written.
   */
  async decideOnce(
    entry: PatternRevisionDecision,
  ): Promise<{ entry: PatternRevisionDecision; created: boolean }> {
    const existing = await patternRevisionService.list(entry.organizationId);
    const match = existing.find(
      (row) => row.proposalFingerprint === entry.proposalFingerprint,
    );
    if (match) return { entry: match, created: false };

    const { data, error } = await supabase
      .from("pattern_revision_decisions")
      .insert({
        organization_id: entry.organizationId,
        pattern_id: entry.patternId,
        pattern_version: entry.patternVersion,
        proposal_fingerprint: entry.proposalFingerprint,
        proposal_text: entry.proposalText,
        outcome_refs: entry.outcomeRefs,
        decision: entry.decision,
        note: entry.note ?? null,
        decided_by: entry.decidedBy,
        decided_at: entry.decidedAt,
      })
      .select("*")
      .single();
    if (error) fail(error);
    return { entry: toDecision(data as Row), created: true };
  },
};
