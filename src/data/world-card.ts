/**
 * World Card composer: one deterministic read of everything already stored
 * about a prospect, arranged as the world Tai would see before deciding.
 *
 * Pure, no fetching, no model call. Phase A composes entirely from the
 * structured signals Scout already persisted: `metadata.scout_intel`,
 * `metadata.scout_fit`, and the prospect's `observed` rows. When those are
 * not enough, the fields stay empty and `unknowns` names what is missing;
 * the card never fills a gap with inference. A Phase B judgment layer may
 * enrich the card, but it must fail closed to this deterministic compose.
 */

import type { WorldCard, WorldCardEvidence } from "@/domain/world-card";
import type { ScoutFitEvaluation } from "@/domain/scout-fit";
import { SCOUT_EVALUATOR_VERSION } from "@/domain/scout-fit";
import { readScoutIntel } from "@/data/scout-intel";
import { storedEvaluation } from "@/data/scout-fit-evaluator";

type Row = Record<string, unknown>;

export interface WorldCardInput {
  /** The prospect's metadata jsonb: scout_intel and scout_fit live here. */
  metadata: unknown;
  /** The prospect's observed rows, as stored on the row. */
  observed: unknown;
  /** A fresher evaluation than metadata.scout_fit, when the caller has one. */
  evaluation?: ScoutFitEvaluation | null;
  now?: string;
}

interface ObservedStatement {
  key: string;
  statement: string;
  source: string;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function observedStatements(observed: unknown): ObservedStatement[] {
  if (!Array.isArray(observed)) return [];
  const out: ObservedStatement[] = [];
  observed.forEach((item, index) => {
    if (typeof item === "string" && item.trim()) {
      out.push({ key: `obs_${index}`, statement: item.trim(), source: "prospect.observed" });
      return;
    }
    if (!item || typeof item !== "object") return;
    const row = item as Row;
    const statement = str(row["evidence"]) || str(row["statement"]) || str(row["fact"]);
    if (!statement) return;
    const key = str(row["key"]) || str(row["id"]) || `obs_${index}`;
    const source = str(row["source_url"]) || str(row["sourceUrl"]) || "prospect.observed";
    out.push({ key: key.toLowerCase(), statement, source });
  });
  return out;
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

const BUILDING_KEYS = /(active_business|service|product|offer|business_model|what_they_do|about)/;
const CARES_KEYS = /(proof|testimonial|review|value|mission|community|award|case_stud|craft)/;
const CHANGE_KEYS = /(launch|hiring|hire|funding|expansion|news|announce|new_location|award_recent)/;
const CONSTRAINT_KEYS = /(constraint|limitation|outdated|broken|missing|manual|milestone_opportun)/;

/**
 * Compose the World Card from stored evidence. Every entry placed on a field
 * is itself an evidence statement, so the card cannot say more than the
 * evidence does. Empty fields are answered in `unknowns`.
 */
export function composeWorldCard(input: WorldCardInput): WorldCard {
  const now = input.now ?? new Date().toISOString();
  const intel = readScoutIntel(input.metadata);
  const evaluation = input.evaluation ?? storedEvaluation(input.metadata);
  const observed = observedStatements(input.observed);
  const evidence: WorldCardEvidence[] = [];

  const cite = (statement: string, source: string): string => {
    if (!evidence.some((entry) => entry.statement === statement)) {
      evidence.push({ statement, source });
    }
    return statement;
  };

  const building = dedupe(
    observed
      .filter((entry) => BUILDING_KEYS.test(entry.key))
      .map((entry) => cite(entry.statement, entry.source)),
  );

  const caresAbout = dedupe(
    observed
      .filter((entry) => CARES_KEYS.test(entry.key))
      .map((entry) => cite(entry.statement, entry.source)),
  );

  const recentChanges = dedupe([
    ...intel.buyingSignals.map((signal) =>
      cite(signal.statement, signal.sourceUrl ?? "prospects.metadata.scout_intel.buying_signals"),
    ),
    ...observed
      .filter((entry) => CHANGE_KEYS.test(entry.key))
      .map((entry) => cite(entry.statement, entry.source)),
  ]);

  const visionOutgrewSystem = dedupe([
    ...intel.opportunities.map((item) =>
      cite(item.statement, item.sourceUrl ?? "prospects.metadata.scout_intel.opportunities"),
    ),
    ...observed
      .filter((entry) => CONSTRAINT_KEYS.test(entry.key))
      .map((entry) => cite(entry.statement, entry.source)),
  ]);

  /* The honest reason to talk exists only when momentum and an observed gap
     are both on record. One side alone is not a reason; it stays empty. */
  const gap = evaluation?.opportunityGap;
  const whyTrustTai: string[] = [];
  if (gap && (gap.gap === "high" || gap.gap === "medium")) {
    const momentum = gap.momentumEvidence[0];
    const weakness = gap.maturityEvidence[0];
    if (momentum && weakness) {
      whyTrustTai.push(
        cite(
          `The business is moving (${momentum}) while the digital side has fallen behind (${weakness}).`,
          "prospects.metadata.scout_fit.opportunityGap",
        ),
      );
    }
  }

  const unknowns = dedupe([
    ...intel.unknowns,
    ...(building.length === 0 ? ["What this company is building has not been observed yet."] : []),
    ...(caresAbout.length === 0 ? ["What they visibly care about has not been observed yet."] : []),
    ...(recentChanges.length === 0 ? ["No recent change has been observed."] : []),
    ...(visionOutgrewSystem.length === 0
      ? ["No system constraint has been observed; a gap may not exist."]
      : []),
    ...(whyTrustTai.length === 0
      ? ["Momentum and a digital gap have not both been evidenced, so there is no proven reason to reach out yet."]
      : []),
  ]);

  return {
    building,
    caresAbout,
    recentChanges,
    visionOutgrewSystem,
    whyTrustTai,
    unknowns,
    evidence,
    composedAt: now,
    evaluatorVersion: evaluation?.evaluatorVersion ?? SCOUT_EVALUATOR_VERSION,
    intelCollectedAt: intel.collectedAt ?? null,
  };
}

/** The serialized shape persisted at `prospects.metadata.world_card`. */
export function worldCardForStorage(card: WorldCard): Row {
  return {
    building: card.building,
    cares_about: card.caresAbout,
    recent_changes: card.recentChanges,
    vision_outgrew_system: card.visionOutgrewSystem,
    why_trust_tai: card.whyTrustTai,
    unknowns: card.unknowns,
    evidence: card.evidence.map((entry) => ({ statement: entry.statement, source: entry.source })),
    composed_at: card.composedAt,
    evaluator_version: card.evaluatorVersion,
    intel_collected_at: card.intelCollectedAt,
  };
}

/** One-line summary used in correction records and activity rows. */
export function worldCardSummary(card: WorldCard): string {
  const parts = [
    `building:${card.building.length}`,
    `cares:${card.caresAbout.length}`,
    `changes:${card.recentChanges.length}`,
    `outgrew:${card.visionOutgrewSystem.length}`,
    `why:${card.whyTrustTai.length}`,
    `unknowns:${card.unknowns.length}`,
  ];
  return parts.join(" ");
}
