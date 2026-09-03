/**
 * Scout, Supabase-backed service.
 *
 * Two clearly separated sources:
 *  - PREVIEW DISCOVERY: plain-English prompts rank a fixed in-memory catalogue.
 *    No external service is searched and no AI scoring is applied. Candidates
 *    are still really persisted to `prospects`, tagged as preview/demo.
 *  - LIVE WEBSITE RESEARCH: pasting a website calls the managed `scout-research`
 *    Edge Function, which reads that company's PUBLIC pages only.
 *
 * Live research never falls back to preview data: a failure surfaces as an error.
 *
 * The current ICP is read from `icp_profiles` and carried into provenance so
 * future real scoring can consume it without another redesign.
 */

import type { ID, Prospect, ProspectStatus } from "@/domain/entities";
import {
  PREVIEW_SOURCE,
  type ProspectCandidate,
  type ScoutResearchRequest,
  type ScoutResearchResult,
  type ScoutSearchRequest,
  type ScoutSearchResult,
} from "@/domain/scout";
import { PREVIEW_CANDIDATES, rankPreviewCandidates } from "@/data/scout-source";
import { inboundOrigin, withInboundOrigin } from "@/data/scout/inbound";
import { readResearchConsent } from "@/data/scout/research-consent";
import {
  buildRelationshipBrief,
  planRelationshipPreparation,
  readRelationshipDevelopment,
  relationshipDevelopmentRow,
  relationshipEvidenceAt,
  RELATIONSHIP_BRIEF_VERSION,
} from "@/data/relationship-development";
import type { RelationshipResearchMarker } from "@/domain/relationship-development";
import type { DecisionMoveKey } from "@/data/scout/decision-state";

import { areasCovered, mergeObservedRows, type ResearchRunPlan } from "@/data/scout/research-run";
import { evaluateScoutFit } from "@/data/scout-fit-evaluator";
import { appendResearchRun, runFromEvaluation } from "@/data/prospect-modules";
import type { HandoffDraft, HandoffRecord } from "@/domain/comms-handoff";
import { HANDOFF_INTENT_LABEL } from "@/domain/comms-handoff";

import { supabaseActivity } from "./activities";
import { emitSuiteEvent } from "@/data/events/suite-events";
import { fetchCompanyIdentity } from "./company-identity";
import { getCurrentIcp, type IcpProfile } from "./icp";
import { peopleService } from "./people-service";
import {
  SCOUT_LIVE_SOURCE,
  findProspectRowByWebsite,
  getProspectRow,
  insertPreviewProspect,
  listProspectRows,
  normalizeWebsiteUrl,
  saveHandoffRecord,
  saveResearchConsent,
  saveProspectMetadataPatch,
  saveResearchProspect,
  toProspect,
  setProspectFitOverride,
  updateProspectStatus,
} from "./prospects";
import {
  candidateFromResearchRow,
  companyNameFromResearch,
  pageCount,
  researchProvenance,
  researchVersion,
  researchWebsite,
  intelFromResearch,
} from "./scout-research";
import { SCOUT_DISCOVERY_SOURCE, candidateFromDiscoveryRow } from "./scout-discovery-map";
import {
  discover as runDiscover,
  discoveryStatus,
  listDiscoveryRuns,
  listProspectEvaluations,
  recordProspectEvaluation,
  recordScoutFeedback,
  type DiscoverInput,
  type FeedbackInput,
} from "./scout-discovery";
import type { ProspectRow } from "./schema";

function previewEvidence(domain: string): Pick<ProspectCandidate, "signals" | "fit"> {
  const match = PREVIEW_CANDIDATES.find(
    (c) => c.prospect.domain.toLowerCase() === domain.toLowerCase(),
  );
  return {
    signals: match?.signals ?? [],
    fit: match?.fit ?? {
      whyItFits: "No preview evidence is attached to this prospect.",
      recommendation: "Open it when Comms is built, or pass for now.",
    },
  };
}

/** Preview rows cannot honestly be scored against the live evidence model. */
function previewEvaluation(icpVersion: number | null, at: string) {
  return evaluateScoutFit({
    observed: [],
    inferred: {},
    suggested: {},
    scoreable: false,
    icpVersion,
    at,
  });
}

/** Stored row → candidate, using the row's own source to pick the evidence. */
function toCandidate(row: ProspectRow, icpVersion: number | null): ProspectCandidate {
  const origin = inboundOrigin({ source: row.source, metadata: row.metadata });
  const base = baseCandidate(row, icpVersion);
  const candidate = origin ? withInboundOrigin(base, origin) : base;
  const consent = readResearchConsent(row.metadata);
  const development = readRelationshipDevelopment(row.metadata);
  return {
    ...(consent ? { ...candidate, researchConsent: consent } : candidate),
    ...(development.watch || development.research ? { development } : {}),
  };
}

function baseCandidate(row: ProspectRow, icpVersion: number | null): ProspectCandidate {
  if (row.source === SCOUT_DISCOVERY_SOURCE) return candidateFromDiscoveryRow(row, icpVersion);
  if (row.source === SCOUT_LIVE_SOURCE) return candidateFromResearchRow(row, icpVersion);
  const prospect = toProspect(row);
  const lastCheckedAt = row.updated_at ?? row.created_at;
  const inbound = inboundOrigin({ source: row.source, metadata: row.metadata });
  return {
    prospect,
    // An inbound company has told us things but we have observed nothing yet,
    // so it must never borrow the preview demo's evidence.
    ...(inbound
      ? { signals: [], fit: { whyItFits: "", recommendation: "" } }
      : previewEvidence(prospect.domain)),
    source: PREVIEW_SOURCE,
    evaluation: previewEvaluation(icpVersion, lastCheckedAt),
    lastCheckedAt,
  };
}

function mergePreview(prospect: Prospect, icpVersion: number | null): ProspectCandidate {
  const lastCheckedAt = prospect.updatedAt ?? prospect.createdAt;
  return {
    prospect,
    ...previewEvidence(prospect.domain),
    source: PREVIEW_SOURCE,
    evaluation: previewEvaluation(icpVersion, lastCheckedAt),
    lastCheckedAt,
  };
}

export interface ScoutContext {
  organizationId: ID;
  userId: ID;
}

/** Plain summaries for the decision ledger. No em dash, no assistant voice. */
const DECISION_SUMMARY: Record<DecisionMoveKey, (name: string) => string> = {
  qualify: (name) => `${name} was qualified in Scout by a person here. Nothing was sent.`,
  pass: (name) => `${name} was passed by a person here. The history is preserved.`,
  hold: (name) => `${name} was held in Scout by a person here. Nothing advanced.`,
  ask_question: (name) =>
    `A question for ${name} was drafted for review. Nothing was sent from Scout.`,
  explore_roadmap: (name) =>
    `A person here marked ${name} as worth exploring in Roadmap. No Roadmap was created.`,
};

export const scoutService = {
  /** The targeting definition Scout is currently working from. */
  async icp(organizationId: ID): Promise<IcpProfile | null> {
    return getCurrentIcp(organizationId);
  },

  /** Everything already saved for this organization. Survives reloads. */
  async list(organizationId: ID): Promise<ProspectCandidate[]> {
    const [rows, icp] = await Promise.all([
      listProspectRows(organizationId),
      getCurrentIcp(organizationId),
    ]);
    return rows.map((row) => toCandidate(row, icp?.version ?? null));
  },

  /** Recorded history for one company: research, decisions, overrides. */
  async activity(organizationId: ID, prospectId: ID, limit = 12) {
    return supabaseActivity.list({
      organizationId,
      subjectType: "prospect",
      subjectId: prospectId,
      limit,
    });
  },

  /**
   * Notes are not a second store: they are `prospect.commented` entries on the
   * shared activity stream, so company history stays in one ledger.
   */
  async addNote(
    input: { prospectId: ID; companyName: string; body: string },
    context: ScoutContext,
  ) {
    const body = input.body.trim();
    if (!body) throw new Error("A note needs some words before it can be saved.");
    const occurredAt = new Date().toISOString();
    return supabaseActivity.record({
      organizationId: context.organizationId,
      name: "prospect.commented",
      subject: { type: "prospect", id: input.prospectId, label: input.companyName },
      summary: body,
      payload: { note: body },
      provenance: {
        appId: "scout",
        actor: { type: "user", id: context.userId },
        observedAt: occurredAt,
        confidence: "observed",
      },
      occurredAt,
    });
  },

  /**
   * Settle the research question a founder was never asked. Written to the
   * company itself and recorded on the shared activity stream, so the reason
   * research was or was not run stays auditable.
   */
  async setResearchConsent(
    input: {
      prospectId: ID;
      companyName: string;
      decision: "granted" | "withheld";
      actorLabel?: string;
    },
    context: ScoutContext,
  ) {
    const at = new Date().toISOString();
    const record = {
      decision: input.decision,
      by: context.userId,
      byLabel: input.actorLabel ?? null,
      at,
    };
    await saveResearchConsent(input.prospectId, record);
    await supabaseActivity.record({
      organizationId: context.organizationId,
      name: "prospect.decided",
      subject: { type: "prospect", id: input.prospectId, label: input.companyName },
      summary:
        input.decision === "granted"
          ? `Public research authorised for ${input.companyName} by a person here, because the intake never asked.`
          : `Public research withheld for ${input.companyName} by a person here.`,
      payload: { scout_research_consent: record },
      provenance: {
        appId: "scout",
        actor: { type: "user", id: context.userId },
        observedAt: at,
        confidence: "observed",
      },
      occurredAt: at,
    });
    return record;
  },

  /**
   * Record what a person decided about this company.
   *
   * Approval is not execution. Qualify and Pass move the existing Scout status
   * through the canonical path; Hold, Ask one more question and Explore
   * Roadmap are recorded as history and markers only. No Roadmap, no project,
   * and no outbound message is created here.
   */
  async recordDecision(
    input: {
      prospectId: ID;
      companyName: string;
      move: DecisionMoveKey;
      note?: string | undefined;
      previousStatus: ProspectStatus;
      evidence?: string[];
    },
    context: ScoutContext,
  ) {
    const at = new Date().toISOString();
    const note = input.note?.trim() || null;

    if (input.move === "qualify") {
      await this.setStatus(input.prospectId, "qualified", context);
    } else if (input.move === "pass") {
      await this.setStatus(input.prospectId, "passed", context);
    } else if (input.move === "explore_roadmap") {
      await saveProspectMetadataPatch(input.prospectId, {
        scout_roadmap_intent: { by: context.userId, at, note },
      });
    } else if (input.move === "ask_question") {
      await saveProspectMetadataPatch(input.prospectId, {
        scout_question_draft: { body: note, by: context.userId, at },
      });
    }

    const name =
      input.move === "ask_question"
        ? "prospect.question_drafted"
        : input.move === "explore_roadmap"
          ? "prospect.roadmap_intent"
          : "prospect.decided";

    const summary = DECISION_SUMMARY[input.move](input.companyName);

    await supabaseActivity.record({
      organizationId: context.organizationId,
      name,
      subject: { type: "prospect", id: input.prospectId, label: input.companyName },
      summary: note ? `${summary} Reason given: ${note}` : summary,
      payload: {
        scout_decision_move: input.move,
        previous_status: input.previousStatus,
        note,
        evidence: input.evidence ?? [],
      },
      provenance: {
        appId: "scout",
        actor: { type: "user", id: context.userId },
        observedAt: at,
        confidence: "observed",
      },
      occurredAt: at,
    });

    return { move: input.move, at, note };
  },

  /**
   * Record a person's pacing decision on a relationship opportunity: worth
   * watching, or not for now. Stored on the prospect's metadata and in the
   * shared activity stream. It changes no status and routes nothing.
   */
  async setWatch(
    input: {
      prospectId: ID;
      companyName: string;
      watch: "watching" | "not_now" | null;
    },
    context: ScoutContext,
  ) {
    const at = new Date().toISOString();
    // The stored metadata merge is shallow, so the whole block is rewritten
    // with the research marker preserved, a pacing decision must never
    // silently drop a prepared brief.
    const row = await getProspectRow(input.prospectId);
    await saveProspectMetadataPatch(input.prospectId, {
      relationship_development: relationshipDevelopmentRow({
        ...readRelationshipDevelopment(row?.metadata),
        watch: input.watch,
        by: context.userId,
        at,
      }),
    });
    await supabaseActivity.record({
      organizationId: context.organizationId,
      name: "prospect.decided",
      subject: { type: "prospect", id: input.prospectId, label: input.companyName },
      summary:
        input.watch === "watching"
          ? `${input.companyName} marked worth watching.`
          : input.watch === "not_now"
            ? `${input.companyName} set aside for now.`
            : `Watch decision cleared for ${input.companyName}.`,
      payload: { relationship_watch: input.watch },
      provenance: {
        appId: "scout",
        actor: { type: "user", id: context.userId },
        observedAt: at,
        confidence: "observed",
      },
      occurredAt: at,
    });
    return { watch: input.watch, at };
  },

  /**
   * Prepare the deeper relationship-development brief for one prospect from
   * the evidence already stored on it.
   *
   * The gate is the full eligibility read: 60% ICP fit AND a traceable
   * founder or decision maker. The work runs when eligibility is newly
   * reached, when the underlying evidence moved, when the brief went stale,
   * or when a person explicitly asks, never on every render. This is
   * research only: it never sends, never creates a Comms relationship, never
   * marks ready-for-comms, and never approves outreach.
   */
  async prepareRelationshipDevelopment(
    input: { prospectId: ID; force?: boolean },
    context: ScoutContext,
  ): Promise<RelationshipResearchMarker> {
    const [row, icp, people] = await Promise.all([
      getProspectRow(input.prospectId),
      getCurrentIcp(context.organizationId),
      peopleService.list(context.organizationId, input.prospectId),
    ]);
    if (!row) throw new Error("That company is no longer on your board.");

    const candidate = toCandidate(row, icp?.version ?? null);
    const existing = candidate.development?.research;
    const plan = planRelationshipPreparation({
      candidate,
      people,
      ...(input.force !== undefined ? { force: input.force } : {}),
    });
    if (plan.action === "none" && existing) return existing;

    const at = new Date().toISOString();
    const evidenceAt = relationshipEvidenceAt(candidate);
    const marker: RelationshipResearchMarker = plan.eligible
      ? {
          state: "prepared",
          because: plan.because,
          version: RELATIONSHIP_BRIEF_VERSION,
          eligibleSince: existing?.eligibleSince ?? at,
          preparedAt: at,
          ...(evidenceAt ? { evidenceAt } : {}),
          brief: buildRelationshipBrief({ candidate, people }),
        }
      : {
          state: "not_eligible",
          because: plan.because,
          version: RELATIONSHIP_BRIEF_VERSION,
          ...(existing?.eligibleSince ? { eligibleSince: existing.eligibleSince } : {}),
        };

    await saveProspectMetadataPatch(input.prospectId, {
      relationship_development: relationshipDevelopmentRow({
        ...readRelationshipDevelopment(row.metadata),
        research: marker,
      }),
    });

    if (marker.state === "prepared") {
      await supabaseActivity.record({
        organizationId: context.organizationId,
        name: "prospect.relationship_brief_prepared",
        subject: { type: "prospect", id: input.prospectId, label: candidate.prospect.name },
        summary: `${candidate.prospect.name} became eligible for deeper relationship research, so a brief was prepared from the stored public evidence. Nothing was sent.`,
        payload: {
          action: plan.action,
          eligible_since: marker.eligibleSince ?? null,
          evidence_at: marker.evidenceAt ?? null,
          brief_version: marker.version,
        },
        provenance: {
          appId: "scout",
          actor: { type: "user", id: context.userId },
          observedAt: at,
          confidence: "observed",
        },
        occurredAt: at,
      });
    }

    return marker;
  },

  /** Is live market discovery connected? */
  async discoveryStatus() {
    return discoveryStatus();
  },

  /**
   * Real AI market sourcing. Finds companies on the open web for a
   * plain-English target, evaluates each against the active ICP, and saves what
   * it can verify. Never falls back to demo data.
   */
  async discover(input: DiscoverInput) {
    return runDiscover(input);
  },

  /** Every sourcing pass this organization has run. */
  async runs(organizationId: ID) {
    return listDiscoveryRuns(organizationId);
  },

  /** Evaluation history for one company, newest first. */
  async evaluations(prospectId: ID) {
    return listProspectEvaluations(prospectId);
  },

  /** Record a human decision as calibration for later runs. */
  async feedback(input: FeedbackInput) {
    return recordScoutFeedback(input);
  },

  /**
   * Preview discovery. Ranks the demo catalogue against the plain-English
   * description and persists any candidate not already saved.
   */
  async search(request: ScoutSearchRequest): Promise<ScoutSearchResult> {
    const icp = await getCurrentIcp(request.organizationId);
    const existing = (await listProspectRows(request.organizationId)).map(toProspect);
    const byDomain = new Map(existing.map((p) => [p.domain.toLowerCase(), p]));

    const ranked = rankPreviewCandidates(request.query);
    const saved: Prospect[] = [];

    for (const candidate of ranked) {
      const key = candidate.prospect.domain.toLowerCase();
      const current = byDomain.get(key);
      if (current) {
        saved.push(current);
        continue;
      }
      const created = await insertPreviewProspect({
        organizationId: request.organizationId,
        userId: request.userId,
        name: candidate.prospect.name,
        websiteUrl: candidate.prospect.websiteUrl || `https://${candidate.prospect.domain}`,
        observed: candidate.signals.map((signal) => ({
          id: signal.id,
          statement: signal.statement,
          provenance: signal.provenance,
        })),
        inferred: { why_it_fits: candidate.fit.whyItFits, confidence: "inferred" },
        suggested: { recommendation: candidate.fit.recommendation },
        ...(icp ? { icpVersion: icp.version } : {}),
      });
      saved.push(created);
    }

    return {
      request,
      candidates: saved.map((prospect) => mergePreview(prospect, icp?.version ?? null)),
      source: {
        ...PREVIEW_SOURCE,
        note: "A fixed in-memory set, saved to your workspace. No external service was searched and no AI scoring was applied.",
      },
      generatedAt: new Date().toISOString(),
    };
  },

  /**
   * Live public-website research for one company. Reuses the organization's
   * existing prospect for the same website instead of creating a duplicate.
   */
  async research(request: ScoutResearchRequest): Promise<ScoutResearchResult> {
    const websiteUrl = normalizeWebsiteUrl(request.websiteUrl);
    if (!websiteUrl) {
      throw new Error(
        "That does not look like a company website. Paste an address such as example.com or https://example.com.",
      );
    }

    const icp = await getCurrentIcp(request.organizationId);
    const payload = await researchWebsite(websiteUrl);

    // Identity enrichment is non-blocking: a failure never stops the save, and
    // nothing is written unless the company's own site really declared it.
    const identity = await fetchCompanyIdentity(payload.website_url || websiteUrl);

    const existing = await findProspectRowByWebsite(request.organizationId, websiteUrl);

    // A re-run updates evidence, it does not reset a company. Observations the
    // new pass did not reach are preserved, and the founder's stated packet and
    // the research consent decision live in metadata, which is merged, never
    // replaced.
    const priorObserved = Array.isArray(existing?.observed) ? (existing.observed as unknown[]) : [];
    const merge = mergeObservedRows({
      previous: priorObserved,
      incoming: payload.observed ?? [],
    });
    const observed = merge.merged;

    const evaluation = evaluateScoutFit({
      observed,
      inferred: payload.inferred ?? {},
      suggested: payload.suggested ?? {},
      scoreable: true,
      icpVersion: icp?.version ?? null,
      pagesResearched: pageCount(payload),
      researchVersion: researchVersion(payload),
    });
    const row = await saveResearchProspect({
      organizationId: request.organizationId,
      userId: request.userId,
      companyName: existing?.company_name ?? companyNameFromResearch(payload, websiteUrl),
      websiteUrl: payload.website_url || websiteUrl,
      observed,
      inferred: payload.inferred ?? {},
      suggested: payload.suggested ?? {},
      provenance: researchProvenance(payload, {
        userId: request.userId,
        icpVersion: icp?.version ?? null,
      }),
      fitScore: evaluation.score,
      metadata: {
        scout_fit: evaluation,
        ...(identity ? { identity } : {}),
        ...(intelFromResearch(payload) ? { scout_intel: intelFromResearch(payload) } : {}),
        research_history: appendResearchRun(
          existing?.metadata,
          runFromEvaluation(evaluation, evaluation.evaluatedAt),
        ),
      },

      existing,
    });

    const candidate = candidateFromResearchRow(row, icp?.version ?? null);
    const occurredAt = new Date().toISOString();

    // Every scored pass is recorded, so fit over time is auditable rather than
    // only visible as the latest number on the row.
    await recordProspectEvaluation({
      organizationId: request.organizationId,
      prospectId: row.id,
      userId: request.userId,
      evaluation,
      citations: candidate.source.pagesResearched ?? [],
      observed: payload.observed ?? [],
      inferred: payload.inferred ?? {},
      suggested: payload.suggested ?? {},
    });

    await supabaseActivity.record({
      organizationId: request.organizationId,
      name: "prospect.researched",
      subject: { type: "prospect", id: row.id, label: candidate.prospect.name },
      summary: `${candidate.prospect.name} was researched from its public website.`,
      payload: {
        source: SCOUT_LIVE_SOURCE,
        page_count: pageCount(payload),
        website_url: candidate.prospect.websiteUrl,
        icp_version: icp?.version ?? null,
        fit_score: evaluation.score,
        fit_light: evaluation.light,
        research_version: researchVersion(payload),
        evidence_count: evaluation.evidenceCount,
        observations_added: merge.added,
        observations_replaced: merge.replaced,
        observations_preserved: merge.kept,
        areas_updated: areasCovered(payload.observed ?? []),
      },
      provenance: {
        appId: "scout",
        actor: { type: "user", id: request.userId },
        observedAt: occurredAt,
        confidence: "observed",
      },
      occurredAt,
    });

    // When a research pass newly crosses the eligibility line (60% fit AND a
    // traceable founder or decision maker), the deeper brief is prepared from
    // the evidence just gathered. Research only: nothing is sent and no
    // relationship is created. Idempotent against the stored marker, and a
    // failure here never fails the research run, the explicit Prepare action
    // on the company page remains available.
    try {
      await this.prepareRelationshipDevelopment(
        { prospectId: row.id },
        { organizationId: request.organizationId, userId: request.userId },
      );
    } catch {
      // Best-effort automatic preparation; the governed manual action remains.
    }

    return {
      request,
      candidate,
      source: candidate.source,
      generatedAt: occurredAt,
    };
  },

  /**
   * A controlled run for one company already on the board.
   *
   * Permission is enforced here as well as in the UI, so no surface can start
   * a pass a founder declined or nobody authorised. The plan decides what the
   * pass is for; the merge inside `research` decides what survives it.
   */
  async runResearch(
    input: { candidate: ProspectCandidate; plan: ResearchRunPlan },
    context: ScoutContext,
  ): Promise<ScoutResearchResult> {
    const { candidate, plan } = input;
    if (!plan.allowed) {
      throw new Error(
        plan.blockedBecause ??
          "Scout will not read anything about this company until research permission is settled.",
      );
    }
    const websiteUrl = candidate.prospect.websiteUrl || candidate.prospect.domain;
    if (!websiteUrl) {
      throw new Error("This company has no website on file, so there is nothing public to read.");
    }
    return this.research({
      organizationId: context.organizationId,
      userId: context.userId,
      websiteUrl,
    });
  },

  /**
   * Route a prepared brief to Comms. The brief is stored on the prospect with
   * full provenance and the company moves to `ready_for_comms`. Nothing is
   * sent: Comms opens the conversation, a person still writes it.
   *
   * Returns the relationship the handoff opened (or the one already carried
   * across) so the caller can land Tai on exactly that person in Comms, * never on whoever happened to sort first.
   */
  async routeToComms(
    draft: HandoffDraft,
    context: ScoutContext,
  ): Promise<{ record: HandoffRecord; relationshipId: ID }> {
    if (!draft.ready) {
      throw new Error("This brief is not ready for Comms yet. Clear what is missing first.");
    }

    const routedAt = new Date().toISOString();
    const record: HandoffRecord = { draft, routedAt, routedBy: context.userId };
    await saveHandoffRecord(draft.prospectId, record as unknown as Record<string, unknown>);

    // Shared vocabulary, written once. The dedupe key makes a retried handoff
    // a no-op rather than a second event in the suite's history.
    await emitSuiteEvent({
      key: "PROSPECT_HANDED_OVER",
      organizationId: context.organizationId,
      actor: { type: "user", id: context.userId },
      subject: { type: "prospect", id: draft.prospectId, label: draft.companyName },
      summary: `${draft.companyName} was handed to Comms with ${draft.contact?.fullName ?? "no named contact"} as the contact. Nothing was sent.`,
      sourceEventKey: `prospect.handed_over:${draft.prospectId}`,
      metadata: {
        intent: draft.intent,
        intent_label: HANDOFF_INTENT_LABEL[draft.intent],
        contact_name: draft.contact?.fullName ?? null,
        contact_email_status: draft.contact?.emailStatus ?? null,
        confidence: draft.confidence.level,
        context_items: draft.requiredContext.length,
      },
      occurredAt: routedAt,
    });

    // Open the relationship in Comms with the brief's context intact. If Comms
    // is not provisioned in this backend, the handoff still stands in Scout.
    const { receiveScoutHandoff } = await import("./comms-handoff-receiver");
    const relationship = await receiveScoutHandoff(draft, {
      organizationId: context.organizationId,
      userId: context.userId,
    });

    return { record, relationshipId: relationship.id };
  },

  /** Manual ICP fit override. Always available, never automatic. */
  async overrideFit(
    id: ID,
    light: "green" | "yellow" | "red" | "neutral" | null,
    context: ScoutContext,
  ): Promise<void> {
    await setProspectFitOverride(id, light, context.userId);
    // A human disagreeing with the machine is the most valuable calibration
    // signal there is. It sharpens interpretation; it never rewrites the ICP.
    await recordScoutFeedback({
      organizationId: context.organizationId,
      userId: context.userId,
      prospectId: id,
      decision: "fit_override",
      humanFit: light,
    });
  },

  /** Qualify / Pass. Writes the row, then appends the activity record. */
  async setStatus(id: ID, status: ProspectStatus, context: ScoutContext): Promise<Prospect | null> {
    const prospect = await updateProspectStatus(id, status);

    const occurredAt = new Date().toISOString();
    // Qualification is a cross-app moment in the shared vocabulary; every other
    // status move stays Scout's own history.
    if (prospect.status === "qualified") {
      await emitSuiteEvent({
        key: "PROSPECT_QUALIFIED",
        organizationId: context.organizationId,
        actor: { type: "user", id: context.userId },
        subject: { type: "prospect", id, label: prospect.name },
        summary: `${prospect.name} was qualified in Scout. No contact has been made.`,
        sourceEventKey: `prospect.qualified:${id}`,
        metadata: { status: prospect.status, domain: prospect.domain },
        occurredAt,
      });
    } else {
      await supabaseActivity.record({
        organizationId: context.organizationId,
        name: "prospect.status_changed",
        subject: { type: "prospect", id, label: prospect.name },
        summary:
          prospect.status === "passed"
            ? `${prospect.name} was passed by Scout.`
            : `${prospect.name} moved to ${prospect.status.replace(/_/g, " ")}.`,
        payload: { status: prospect.status, domain: prospect.domain },
        provenance: {
          appId: "scout",
          actor: { type: "user", id: context.userId },
          observedAt: occurredAt,
          confidence: "observed",
        },
        occurredAt,
      });
    }

    if (prospect.status === "qualified" || prospect.status === "passed") {
      await recordScoutFeedback({
        organizationId: context.organizationId,
        userId: context.userId,
        prospectId: id,
        decision: prospect.status,
        companyName: prospect.name,
        domain: prospect.domain,
      });
    }

    return prospect;
  },
};
