/**
 * Stored AI-discovery row → Scout candidate.
 *
 * Discovery rows carry the same observed / inferred / suggested shape as live
 * website research, so the research mapper does the work. What differs is
 * provenance: this company was sourced from the open web against a query, and
 * the board must say so plainly rather than implying a site was crawled.
 */

import type { CandidateSource, ProspectCandidate } from "@/domain/scout";

import { candidateFromResearchRow } from "./scout-research";
import type { ProspectRow, Row } from "./schema";

export const SCOUT_DISCOVERY_SOURCE = "scout_ai_discovery";

export function discoverySource(row: ProspectRow): CandidateSource {
  const metadata = (row.metadata ?? {}) as Row;
  const discovery = (metadata["scout_discovery"] ?? {}) as Row;
  const provenance = (row.provenance ?? {}) as Row;
  const citations = Array.isArray(discovery["citations"])
    ? (discovery["citations"] as string[])
    : Array.isArray(provenance["citations"])
      ? (provenance["citations"] as string[])
      : [];
  const query = typeof discovery["query"] === "string" ? discovery["query"] : "";
  const at =
    typeof discovery["at"] === "string" ? discovery["at"] : (row.updated_at ?? row.created_at);

  return {
    kind: "live_website",
    label: "AI market discovery",
    note: query
      ? `Sourced from the public web for “${query}” · ${citations.length} source${citations.length === 1 ? "" : "s"} cited`
      : `Sourced from the public web · ${citations.length} source${citations.length === 1 ? "" : "s"} cited`,
    pagesResearched: citations,
    ...(at ? { researchedAt: at } : {}),
  };
}

export function candidateFromDiscoveryRow(
  row: ProspectRow,
  activeIcpVersion: number | null = null,
): ProspectCandidate {
  const base = candidateFromResearchRow(row, activeIcpVersion);
  return { ...base, source: discoverySource(row) };
}
