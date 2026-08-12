/**
 * Scout — Supabase-backed service.
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

import { supabaseActivity } from "./activities";
import { getCurrentIcp, type IcpProfile } from "./icp";
import {
  SCOUT_LIVE_SOURCE,
  findProspectRowByWebsite,
  insertPreviewProspect,
  listProspectRows,
  normalizeWebsiteUrl,
  saveResearchProspect,
  toProspect,
  updateProspectStatus,
} from "./prospects";
import {
  candidateFromResearchRow,
  companyNameFromResearch,
  pageCount,
  researchProvenance,
  researchWebsite,
} from "./scout-research";
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

/** Stored row → candidate, using the row's own source to pick the evidence. */
function toCandidate(row: ProspectRow): ProspectCandidate {
  if (row.source === SCOUT_LIVE_SOURCE) return candidateFromResearchRow(row);
  const prospect = toProspect(row);
  return { prospect, ...previewEvidence(prospect.domain), source: PREVIEW_SOURCE };
}

function mergePreview(prospect: Prospect): ProspectCandidate {
  return { prospect, ...previewEvidence(prospect.domain), source: PREVIEW_SOURCE };
}

export interface ScoutContext {
  organizationId: ID;
  userId: ID;
}

export const scoutService = {
  /** The targeting definition Scout is currently working from. */
  async icp(organizationId: ID): Promise<IcpProfile | null> {
    return getCurrentIcp(organizationId);
  },

  /** Everything already saved for this organization. Survives reloads. */
  async list(organizationId: ID): Promise<ProspectCandidate[]> {
    const rows = await listProspectRows(organizationId);
    return rows.map(toCandidate);
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
      candidates: saved.map(mergePreview),
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

    const existing = await findProspectRowByWebsite(request.organizationId, websiteUrl);
    const row = await saveResearchProspect({
      organizationId: request.organizationId,
      userId: request.userId,
      companyName:
        existing?.company_name ?? companyNameFromResearch(payload, websiteUrl),
      websiteUrl: payload.website_url || websiteUrl,
      observed: payload.observed ?? [],
      inferred: payload.inferred ?? {},
      suggested: payload.suggested ?? {},
      provenance: researchProvenance(payload, {
        userId: request.userId,
        icpVersion: icp?.version ?? null,
      }),
      existing,
    });

    const candidate = candidateFromResearchRow(row);
    const occurredAt = new Date().toISOString();

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
      },
      provenance: {
        appId: "scout",
        actor: { type: "user", id: request.userId },
        observedAt: occurredAt,
        confidence: "observed",
      },
      occurredAt,
    });

    return {
      request,
      candidate,
      source: candidate.source,
      generatedAt: occurredAt,
    };
  },

  /** Qualify / Pass. Writes the row, then appends the activity record. */
  async setStatus(
    id: ID,
    status: ProspectStatus,
    context: ScoutContext,
  ): Promise<Prospect | null> {
    const prospect = await updateProspectStatus(id, status);

    const occurredAt = new Date().toISOString();
    await supabaseActivity.record({
      organizationId: context.organizationId,
      name: "prospect.status_changed",
      subject: { type: "prospect", id, label: prospect.name },
      summary:
        prospect.status === "passed"
          ? `${prospect.name} was passed by Scout.`
          : `${prospect.name} is qualified and ready for Comms.`,
      payload: { status: prospect.status, domain: prospect.domain },
      provenance: {
        appId: "scout",
        actor: { type: "user", id: context.userId },
        observedAt: occurredAt,
        confidence: "observed",
      },
      occurredAt,
    });

    return prospect;
  },
};
