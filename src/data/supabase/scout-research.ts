/**
 * Scout — live public-website research.
 *
 * Calls the managed `scout-research` Edge Function with the signed-in user's
 * JWT. The function reads a company's PUBLIC website pages only: there is no
 * search-engine discovery, no LinkedIn/Apollo/Clay, and no private data. Its
 * inference is deterministic heuristic analysis, not AI scoring.
 *
 * This module owns the call, the response shape, and the translation into the
 * Scout candidate contract. Route components never talk to Supabase directly.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";
import type { CandidateSource, ProspectCandidate, ScoutSignal } from "@/domain/scout";
import type { ProspectRow, Row } from "./schema";
import { toProspect } from "./prospects";

/** Raw payload returned by the Edge Function. */
export interface ScoutResearchPayload {
  source: string;
  website_url: string;
  hostname: string;
  pages_researched?: string[];
  observed?: unknown[];
  inferred?: Row;
  suggested?: Row;
  provenance?: Row;
  error?: string;
  message?: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Invoke the Edge Function. Failures are surfaced as calm, specific messages —
 * there is never a silent fall back to preview data.
 */
export async function researchWebsite(websiteUrl: string): Promise<ScoutResearchPayload> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    throw new Error("Your session has expired. Sign in again to run live website research.");
  }

  const { data, error } = await supabase.functions.invoke<ScoutResearchPayload>("scout-research", {
    body: { website_url: websiteUrl },
  });

  if (error) {
    throw new Error(
      `Scout could not research ${websiteUrl}. The research service returned an error: ${error.message}`,
    );
  }
  if (!data) {
    throw new Error(`Scout received no research back for ${websiteUrl}. Nothing was saved.`);
  }
  const failure = text(data.error) || (data.source ? "" : text(data.message));
  if (failure) {
    throw new Error(`Scout could not research ${websiteUrl}. ${failure}`);
  }
  if (!Array.isArray(data.observed) || data.observed.length === 0) {
    throw new Error(
      `Scout reached ${websiteUrl} but found no readable public pages to observe. The site may be unreachable or may not serve HTML.`,
    );
  }
  return data;
}

/** Human company name derived from the researched hostname. */
export function companyNameFromResearch(payload: ScoutResearchPayload, fallback: string): string {
  const host = text(payload.hostname) || fallback;
  const label = host.replace(/^www\./, "").split(".")[0] ?? host;
  if (!label) return host;
  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Provenance stored on the prospect: the function's own record plus context. */
export function researchProvenance(
  payload: ScoutResearchPayload,
  context: { userId: ID; icpVersion: number | null },
): Row {
  return {
    ...(payload.provenance ?? {}),
    app_key: "scout",
    source_kind: "live_website",
    website_url: payload.website_url,
    hostname: payload.hostname,
    pages: payload.provenance?.["pages"] ?? payload.pages_researched ?? [],
    icp_version: context.icpVersion,
    researched_by: context.userId,
  };
}

export function pageCount(payload: ScoutResearchPayload): number {
  const pages = payload.pages_researched ?? (payload.provenance?.["pages"] as unknown[] | undefined);
  return Array.isArray(pages) ? pages.length : 0;
}

function researchNote(pages: number): string {
  return pages === 1
    ? "Public website only · 1 page checked"
    : `Public website only · ${pages} pages checked`;
}

/** Source descriptor shown on live-research cards. */
export function liveSource(pages: number, pagesResearched: string[], researchedAt?: string): CandidateSource {
  return {
    kind: "live_website",
    label: "Live website research",
    note: researchNote(pages),
    pagesResearched,
    ...(researchedAt ? { researchedAt } : {}),
  };
}

function toSignals(observed: unknown[], observedAtFallback: string): ScoutSignal[] {
  return observed.map((item, index) => {
    const entry = (item ?? {}) as Row;
    const statement =
      text(entry["statement"]) || text(entry["fact"]) || text(entry["text"]) || String(item ?? "");
    const sourceUrl = text(entry["source_url"]);
    const observedAt = text(entry["observed_at"]) || observedAtFallback;
    return {
      id: text(entry["id"]) || `obs_${index}`,
      statement,
      ...(sourceUrl ? { sourceUrl } : {}),
      provenance: {
        appId: "scout",
        actor: { type: "system" as const, id: "scout.research" },
        observedAt,
        confidence: "observed" as const,
        ...(sourceUrl ? { externalRef: sourceUrl } : {}),
      },
    };
  });
}

/**
 * Build a candidate from a stored live-research row. The stored payloads are the
 * source of truth so a reload shows exactly what was researched.
 */
export function candidateFromResearchRow(row: ProspectRow): ProspectCandidate {
  const provenance = (row.provenance ?? {}) as Row;
  const observed = Array.isArray(row.observed) ? row.observed : [];
  const inferred = (row.inferred ?? {}) as Row;
  const suggested = (row.suggested ?? {}) as Row;
  const pages = Array.isArray(provenance["pages"]) ? (provenance["pages"] as string[]) : [];
  const researchedAt =
    text(provenance["fetched_at"]) || text(provenance["researched_at"]) || row.updated_at;

  return {
    prospect: toProspect(row),
    signals: toSignals(observed, researchedAt),
    fit: {
      whyItFits:
        text(inferred["why_it_fits"]) ||
        text(inferred["summary"]) ||
        text(inferred["notes"]) ||
        "No inference was recorded for this website.",
      recommendation:
        text(suggested["recommendation"]) ||
        text(suggested["next_move"]) ||
        text(suggested["summary"]) ||
        "Review the observed pages and decide whether to qualify.",
    },
    source: liveSource(pages.length, pages, researchedAt),
  };
}
