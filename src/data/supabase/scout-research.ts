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
import { evaluateScoutFit, storedEvaluation, withOverride } from "@/data/scout-fit-evaluator";
import type { ProspectRow, Row } from "./schema";
import { toProspect } from "./prospects";
import { readCompanyIdentity } from "@/lib/company-identity";
import { readResearchHistory } from "@/data/prospect-modules";
import { readScoutIntel } from "@/data/scout-intel";


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

/** `provenance.research_version` reported by the Edge Function, when present. */
export function researchVersion(payload: ScoutResearchPayload): number | null {
  const version = payload.provenance?.["research_version"];
  return typeof version === "number" ? version : null;
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

function formatObservationValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) {
    const parts = value
      .map((v) => (typeof v === "string" ? v.trim() : formatObservationValue(v)))
      .filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : "—";
  }
  // Object fallback for nested or loosely-typed values.
  const obj = value as Record<string, unknown>;
  const nested = text(obj["value"]) || text(obj["text"]) || text(obj["label"]);
  if (nested) return nested;
  return "—";
}

function renderObservationStatement(entry: Row, item: unknown): string {
  // v2 observation shape: { key, label, value, evidence?, source_url, observed_at }
  const label = text(entry["label"]) || text(entry["key"]);
  if (label) {
    const valueText = formatObservationValue(entry["value"]);
    const evidence = text(entry["evidence"]);
    return evidence ? `${label}: ${valueText} — ${evidence}` : `${label}: ${valueText}`;
  }

  // Legacy / fallback shapes.
  const legacy =
    text(entry["statement"]) || text(entry["fact"]) || text(entry["text"]);
  if (legacy) return legacy;
  if (typeof item === "string") return item;

  return "";
}

function toSignals(observed: unknown[], observedAtFallback: string): ScoutSignal[] {
  return observed.map((item, index) => {
    const entry = (item ?? {}) as Row;
    const sourceUrl = text(entry["source_url"]);
    const observedAt = text(entry["observed_at"]) || observedAtFallback;
    const statement = renderObservationStatement(entry, item);

    // Safety net: never render "[object Object]" or an empty string.
    const safeStatement =
      statement && statement !== "[object Object]"
        ? statement
        : "Observation recorded";

    return {
      id: text(entry["id"]) || text(entry["key"]) || `obs_${index}`,
      statement: safeStatement,
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

function inferWhyItFits(inferred: Row): string {
  const why = text(inferred["why_it_fits"]);
  if (why) return why;

  const notes = inferred["notes"];
  if (Array.isArray(notes) && notes.length > 0) {
    const paragraph = notes
      .map((n) => (typeof n === "string" ? n.trim() : ""))
      .filter(Boolean)
      .join(". ");
    if (!paragraph) return "No inference was recorded for this website.";
    return paragraph.endsWith(".") ? paragraph : `${paragraph}.`;
  }

  const summary = text(inferred["summary"]);
  if (summary) return summary;

  return "No inference was recorded for this website.";
}

/**
 * Build a candidate from a stored live-research row. The stored payloads are the
 * source of truth so a reload shows exactly what was researched.
 */
export function candidateFromResearchRow(
  row: ProspectRow,
  activeIcpVersion: number | null = null,
): ProspectCandidate {
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
      whyItFits: inferWhyItFits(inferred),
      recommendation:
        text(suggested["recommendation"]) ||
        text(suggested["next_move"]) ||
        text(suggested["summary"]) ||
        "Review the observed pages and decide whether to qualify.",
    },
    source: liveSource(pages.length, pages, researchedAt),
    evaluation: withOverride(
      storedEvaluation(row.metadata) ??
      evaluateScoutFit({
        observed,
        inferred,
        suggested,
        scoreable: true,
        icpVersion:
          activeIcpVersion ??
          (typeof provenance["icp_version"] === "number"
            ? (provenance["icp_version"] as number)
            : null),
        at: researchedAt,
        pagesResearched: pages.length,
        researchVersion:
          typeof provenance["research_version"] === "number"
            ? (provenance["research_version"] as number)
            : null,
      }),
      row.metadata,
    ),
    lastCheckedAt: researchedAt,
    identity: readCompanyIdentity({
      metadata: row.metadata,
      provenance,
      inferred,
      observed,
    }),
    facts: observationFacts(observed),
    profile: companyProfile(inferred, observationFacts(observed)),

    history: readResearchHistory(row.metadata),
    intel: readScoutIntel(row.metadata),
  };
}

/** Observation key → raw value, so coverage flags can be read structurally. */
export function observationFacts(observed: unknown[]): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
  for (const item of observed) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Row;
    const key = text(entry["key"]) || text(entry["id"]);
    if (!key || key in facts) continue;
    facts[key] = entry["value"];
  }
  return facts;
}


/**
 * Buying signals, digital opportunities and people the research function
 * reported. The Edge Function's payload shape has grown over versions, so a
 * few known key spellings are accepted — but nothing is inferred: if the
 * payload does not state it, it is simply absent.
 */
export function intelFromResearch(payload: ScoutResearchPayload): Row | null {
  const inferred = (payload.inferred ?? {}) as Row;
  const pick = (...keys: string[]): Record<string, unknown>[] => {
    for (const key of keys) {
      const value = inferred[key];
      if (Array.isArray(value) && value.length > 0) {
        return value.filter(
          (entry): entry is Record<string, unknown> => !!entry && typeof entry === "object",
        );
      }
    }
    return [];
  };

  const buying = pick("buying_signals", "signals", "timing_signals");
  const opportunities = pick("digital_opportunities", "opportunities", "issues", "problems");
  const people = pick("people", "team", "decision_makers");
  const unknowns = Array.isArray(inferred["unknowns"]) ? (inferred["unknowns"] as string[]) : [];

  if (buying.length === 0 && opportunities.length === 0 && people.length === 0) return null;

  return {
    buying_signals: buying,
    opportunities,
    people,
    unknowns,
    citations: Array.isArray(payload.pages_researched) ? payload.pages_researched : [],
    collected_at: new Date().toISOString(),
  };
}
