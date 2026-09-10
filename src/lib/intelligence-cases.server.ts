/**
 * The case ledger, read as the caller.
 *
 * Human corrections live here, and corrections outrank inference. The read is
 * made with the caller's own token so RLS and the workspace boundary still
 * decide what is visible. When the ledger cannot be read, the source is
 * returned as withheld: unknown stays unknown, it never becomes an empty fact.
 */

import { createClient } from "@supabase/supabase-js";

import type { IntelligenceCase } from "@/domain/intelligence-canon";
import type { WithheldSource } from "@/domain/signals";
import { trustTaiSupabaseKey, trustTaiSupabaseUrl } from "@/lib/trust-tai-backend.server";

export interface CaseLedgerRead {
  cases: IntelligenceCase[];
  withheld: WithheldSource[];
}

function toCase(row: Record<string, unknown>): IntelligenceCase {
  const optional = (key: string, field: string) =>
    typeof row[key] === "string" && (row[key] as string).length > 0
      ? { [field]: row[key] as string }
      : {};
  return {
    id: String(row["id"] ?? ""),
    organizationId: String(row["organization_id"] ?? ""),
    patternId: String(row["pattern_id"] ?? ""),
    patternVersion: Number(row["pattern_version"] ?? 1),
    entities: [],
    evidenceRefs: [],
    hypothesis: String(row["hypothesis"] ?? ""),
    humanDecision: String(row["human_decision"] ?? ""),
    decidedBy: String(row["decided_by"] ?? ""),
    decidedAt: String(row["decided_at"] ?? ""),
    diagnosisVerdict: (typeof row["diagnosis_verdict"] === "string"
      ? row["diagnosis_verdict"]
      : "unknown") as IntelligenceCase["diagnosisVerdict"],
    ...(optional("correction", "correction") as { correction?: string }),
    ...(optional("lesson", "lesson") as { lesson?: string }),
    createdAt: String(row["created_at"] ?? ""),
  } satisfies IntelligenceCase;
}

/** Read this workspace's case ledger. Never throws; unreadable is withheld. */
export async function readIntelligenceCases(
  token: string,
  organizationId: string,
  limit = 40,
): Promise<CaseLedgerRead> {
  try {
    const key = trustTaiSupabaseKey();
    const supabase = createClient(trustTaiSupabaseUrl(), key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}`, apikey: key } },
    });
    const { data, error } = await supabase
      .from("intelligence_cases")
      .select("*")
      .eq("organization_id", organizationId)
      .order("decided_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return { cases: ((data ?? []) as Record<string, unknown>[]).map(toCase), withheld: [] };
  } catch {
    return { cases: [], withheld: [{ appId: "intelligence_cases", reason: "not_connected" }] };
  }
}
