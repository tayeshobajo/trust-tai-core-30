/**
 * Scout — Supabase-backed service.
 *
 * Sourcing is still PREVIEW/MOCKED: candidates come from a fixed in-memory
 * catalogue and no external service (web, Apollo, LinkedIn, Clay, AI) is
 * contacted. Everything else is real: candidates are persisted to `prospects`,
 * status changes update those rows, and each change appends to `activities`.
 *
 * The current ICP is read from `icp_profiles` and carried alongside results so
 * future real sourcing/scoring can consume it without another redesign.
 */

import type { ID, Prospect, ProspectStatus } from "@/domain/entities";
import type { ProspectCandidate, ScoutSearchRequest, ScoutSearchResult } from "@/domain/scout";
import { PREVIEW_CANDIDATES, rankPreviewCandidates } from "@/data/scout-source";

import { supabaseActivity } from "./activities";
import { getCurrentIcp, type IcpProfile } from "./icp";
import { insertPreviewProspect, listProspects, updateProspectStatus } from "./prospects";

function evidenceForDomain(domain: string): Pick<ProspectCandidate, "signals" | "fit"> {
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

function merge(prospect: Prospect): ProspectCandidate {
  return { prospect, ...evidenceForDomain(prospect.domain) };
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
    const prospects = await listProspects(organizationId);
    return prospects.map(merge);
  },

  /**
   * Preview discovery. Ranks the demo catalogue against the plain-English
   * description and persists any candidate not already saved.
   */
  async search(request: ScoutSearchRequest): Promise<ScoutSearchResult> {
    const icp = await getCurrentIcp(request.organizationId);
    const existing = await listProspects(request.organizationId);
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
      candidates: saved.map(merge),
      source: {
        kind: "preview_demo",
        label: "Preview demo source",
        note: "A fixed in-memory set, saved to your workspace. No external service was searched and no AI scoring was applied.",
      },
      generatedAt: new Date().toISOString(),
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
      payload: { status: prospect.status, domain: prospect.domain, source: "scout_preview_demo" },
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
