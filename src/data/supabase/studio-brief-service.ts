/**
 * Studio's durable side: opportunity decisions and kept briefs.
 *
 * Opportunities themselves are derived per request from Website's observed
 * truth and are never stored. What a person decided, and the brief they kept,
 * are stored here.
 *
 * A missing table reads as "not provisioned" rather than an error, and a write
 * into a missing table refuses with the migration named, so nothing is ever
 * reported as kept when it was not.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";
import type { ContentBrief } from "@/domain/content-brief";
import type { OpportunityDecision, OpportunityDecisionState } from "@/domain/content-opportunity";

import { missingRelation, type Provisioned } from "./settings-service";
import type { Row } from "./schema";

export const STUDIO_BRIEF_MIGRATION =
  "The Studio brief store is not in this database yet. Apply docs/studio-briefs-schema.sql.";

export interface StudioContext {
  organizationId: ID;
  userId: ID;
}

export type BriefPersistenceDecision =
  | { operation: "update" }
  | { operation: "upsert"; onConflict: "organization_id,source_opportunity_id" }
  | { operation: "insert" };

/** Keep the persistence choice explicit: saved row, opportunity retry, or manual brief. */
export function decideBriefPersistence(
  brief: Pick<ContentBrief, "id" | "sourceOpportunityId">,
): BriefPersistenceDecision {
  if (brief.id) return { operation: "update" };
  if (brief.sourceOpportunityId !== null) {
    return { operation: "upsert", onConflict: "organization_id,source_opportunity_id" };
  }
  return { operation: "insert" };
}

function fail(error: { code?: string; message?: string } | null): never {
  throw new Error(
    missingRelation(error as never) ? STUDIO_BRIEF_MIGRATION : String(error?.message ?? "unknown"),
  );
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/* ------------------------------------------------------------ decisions */

/** Every recorded decision, keyed by opportunity id. */
export async function listOpportunityDecisions(
  organizationId: string,
): Promise<Provisioned<Record<string, OpportunityDecision>>> {
  const result = await supabase
    .from("studio_opportunity_decisions")
    .select("*")
    .eq("organization_id", organizationId)
    .limit(500);

  if (result.error) {
    if (missingRelation(result.error)) return { provisioned: false, value: {} };
    throw new Error(result.error.message);
  }

  const value: Record<string, OpportunityDecision> = {};
  for (const row of (result.data ?? []) as Row[]) {
    const id = text(row["opportunity_id"]);
    if (!id) continue;
    value[id] = {
      state: (text(row["state"]) || "open") as OpportunityDecisionState,
      ...(row["decided_by"] ? { decidedBy: String(row["decided_by"]) } : {}),
      ...(row["decided_at"] ? { decidedAt: String(row["decided_at"]) } : {}),
      ...(text(row["note"]) ? { note: text(row["note"]) } : {}),
    };
  }
  return { provisioned: true, value };
}

/** Record what a person decided about one opportunity. Explicit, attributed. */
export async function recordOpportunityDecision(
  context: StudioContext,
  input: {
    opportunityId: string;
    subjectLabel: string;
    state: OpportunityDecisionState;
    note?: string;
  },
): Promise<void> {
  const result = await supabase.from("studio_opportunity_decisions").upsert(
    {
      organization_id: context.organizationId,
      opportunity_id: input.opportunityId,
      subject_label: input.subjectLabel,
      state: input.state,
      note: input.note ?? null,
      decided_by: context.userId,
      decided_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,opportunity_id" },
  );

  if (result.error) fail(result.error);
}

/* --------------------------------------------------------------- briefs */

function toBrief(row: Row): ContentBrief {
  const json = <T>(key: string, fallback: T): T =>
    row[key] === null || row[key] === undefined ? fallback : (row[key] as T);

  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    coreIdea: text(row["core_idea"]),
    angle: text(row["angle"]),
    audienceLanguage: json<string[]>("audience_language", []),
    titleCandidates: json<ContentBrief["titleCandidates"]>("title_candidates", []),
    chosenTitle: (row["chosen_title"] as string | null) ?? null,
    opening: json<ContentBrief["opening"]>("opening", {
      firstParagraph: "",
      whyItEarnsParagraphTwo: "",
    }),
    spine: json<ContentBrief["spine"]>("spine", {
      end: "",
      beginning: "",
      middle: [],
      landing: "",
      structureChoice: "end_first",
      whyThisStructure: "",
    }),
    seo: json<ContentBrief["seo"]>("seo", {
      primaryLanguage: [],
      intent: "",
      evidenceRefs: [],
      overlapRisk: null,
    }),
    imagePlan: json<ContentBrief["imagePlan"]>("image_plan", {
      images: [],
      because: "No image earns its place in this story.",
    }),
    sourceOpportunityId: (row["source_opportunity_id"] as string | null) ?? null,
    state: (text(row["state"]) || "draft") as ContentBrief["state"],
    ...(row["approved_by"] ? { approvedBy: String(row["approved_by"]) } : {}),
    ...(row["approved_at"] ? { approvedAt: String(row["approved_at"]) } : {}),
  };
}

/** Kept briefs, newest first. */
export async function listBriefs(organizationId: string): Promise<Provisioned<ContentBrief[]>> {
  const result = await supabase
    .from("studio_content_briefs")
    .select("*")
    .eq("organization_id", organizationId)
    .neq("state", "discarded")
    .order("created_at", { ascending: false })
    .limit(100);

  if (result.error) {
    if (missingRelation(result.error)) return { provisioned: false, value: [] };
    throw new Error(result.error.message);
  }

  return { provisioned: true, value: ((result.data ?? []) as Row[]).map(toBrief) };
}

/** Keep a brief. The person's edits are already folded in by the caller. */
export async function saveBrief(
  context: StudioContext,
  brief: ContentBrief,
): Promise<ContentBrief> {
  const payload = {
    organization_id: context.organizationId,
    source_opportunity_id: brief.sourceOpportunityId,
    core_idea: brief.coreIdea,
    angle: brief.angle,
    audience_language: brief.audienceLanguage,
    title_candidates: brief.titleCandidates,
    chosen_title: brief.chosenTitle,
    opening: brief.opening,
    spine: brief.spine,
    seo: brief.seo,
    image_plan: brief.imagePlan,
    state: brief.state,
    created_by: context.userId,
    updated_at: new Date().toISOString(),
  };

  const persistence = decideBriefPersistence(brief);
  const result =
    persistence.operation === "update"
      ? await supabase
          .from("studio_content_briefs")
          .update(payload)
          .eq("id", brief.id)
          .eq("organization_id", context.organizationId)
          .select("*")
          .maybeSingle()
      : persistence.operation === "upsert"
        ? await supabase
            .from("studio_content_briefs")
            .upsert(payload, { onConflict: persistence.onConflict })
            .select("*")
            .maybeSingle()
        : await supabase.from("studio_content_briefs").insert(payload).select("*").maybeSingle();

  if (result.error) fail(result.error);
  if (!result.data) throw new Error(STUDIO_BRIEF_MIGRATION);
  return toBrief(result.data as Row);
}

export const studioBriefService = {
  listOpportunityDecisions,
  recordOpportunityDecision,
  listBriefs,
  saveBrief,
};
