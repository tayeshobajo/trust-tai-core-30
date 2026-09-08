/**
 * Watchlist staging and membership, pure.
 *
 * No React and no Supabase, so the honest parts (what is a duplicate, what
 * cannot be read, what is genuinely new) can be reasoned about and tested on
 * their own.
 *
 * Membership lives on the canonical prospect row's metadata under
 * `scout_watchlist`. There is no second company store.
 */

import type { StagedCompany, StagedState, WatchlistMarker } from "@/domain/scout-watchlist";
import type { ProspectCandidate } from "@/domain/scout";
import { normalizeWebsiteUrl } from "@/lib/website-url";

type Row = Record<string, unknown>;

/* ------------------------------------------------------------- membership */

export const WATCHLIST_METADATA_KEY = "scout_watchlist";

export function readWatchlistMarker(metadata: unknown): WatchlistMarker | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as Row)[WATCHLIST_METADATA_KEY];
  if (!raw || typeof raw !== "object") return null;
  const block = raw as Row;
  const method = block["method"] === "import" ? "import" : "manual";
  const by = typeof block["by"] === "string" ? block["by"] : "";
  const at = typeof block["at"] === "string" ? block["at"] : "";
  const sourceKey = typeof block["source_key"] === "string" ? block["source_key"] : "";
  if (!by || !at) return null;
  return {
    method,
    by,
    at,
    sourceKey,
    ...(typeof block["by_label"] === "string" ? { byLabel: block["by_label"] } : {}),
    ...(typeof block["note"] === "string" ? { note: block["note"] } : {}),
  };
}

/** Storage shape for a marker. Written whole, never merged field by field. */
export function watchlistMarkerRow(marker: WatchlistMarker): Row {
  return {
    method: marker.method,
    by: marker.by,
    by_label: marker.byLabel ?? null,
    at: marker.at,
    note: marker.note ?? null,
    source_key: marker.sourceKey,
  };
}

/**
 * Replay key for one curated addition. The same company added twice by the
 * same organization resolves to the same key, so a retried save is a no-op
 * rather than a second row.
 */
export function watchlistSourceKey(organizationId: string, identity: string): string {
  return `scout.watchlist:${organizationId}:${identity.trim().toLowerCase()}`;
}

/* ---------------------------------------------------------------- staging */

/** Split "Acme Dental, acme.com" style lines into name and website parts. */
function splitLine(line: string): { name: string; site: string | null } {
  const parts = line
    .split(/[\t,;|]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return { name: "", site: null };

  let site: string | null = null;
  const names: string[] = [];
  for (const part of parts) {
    const url = normalizeWebsiteUrl(part);
    if (url && !site) site = url;
    else names.push(part);
  }
  if (!site && parts.length === 1) {
    // A bare "acme.com" is both the name and the address.
    const url = normalizeWebsiteUrl(parts[0] ?? "");
    if (url) return { name: displayName(url), site: url };
  }
  return { name: names.join(" ").trim() || (site ? displayName(site) : ""), site };
}

function displayName(websiteUrl: string): string {
  return websiteUrl.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
}

function readable(name: string): boolean {
  return /[a-z]/i.test(name) && name.trim().length >= 2;
}

export interface ExistingCompany {
  name: string;
  websiteUrl: string | null;
}

/** Companies already on the board, in the shape the parser compares against. */
export function existingCompanies(candidates: ProspectCandidate[]): ExistingCompany[] {
  return candidates.map((candidate) => ({
    name: candidate.prospect.name,
    websiteUrl: normalizeWebsiteUrl(candidate.prospect.websiteUrl || candidate.prospect.domain),
  }));
}

function matches(existing: ExistingCompany[], name: string, site: string | null): boolean {
  const lowered = name.trim().toLowerCase();
  return existing.some((entry) => {
    if (site && entry.websiteUrl && entry.websiteUrl.toLowerCase() === site.toLowerCase()) {
      return true;
    }
    return Boolean(lowered) && entry.name.trim().toLowerCase() === lowered;
  });
}

/**
 * Turn pasted text into staged rows. Nothing is saved: every row carries its
 * own state so a person decides what happens to it.
 */
export function parseWatchlistImport(text: string, existing: ExistingCompany[]): StagedCompany[] {
  const seen: ExistingCompany[] = [];
  const staged: StagedCompany[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    const raw = line.trim();
    if (!raw) return;
    const { name, site } = splitLine(raw);
    let state: StagedState = "new";
    let because = "Not on the board yet.";

    if (!readable(name)) {
      state = "unreadable";
      because = "No company name or website could be read from this line.";
    } else if (matches(existing, name, site)) {
      state = "duplicate";
      because = "This company is already on the Scout board.";
    } else if (matches(seen, name, site)) {
      state = "duplicate";
      because = "This company appears earlier in the same list.";
    }

    if (state === "new") seen.push({ name, websiteUrl: site });

    staged.push({
      id: `staged-${index}-${raw.slice(0, 40).toLowerCase().replace(/\s+/g, "-")}`,
      raw,
      name,
      websiteUrl: site,
      state,
      because,
      keep: state === "new",
    });
  });

  return staged;
}

/** Re-read a single edited row against the board and the rest of the batch. */
export function restageRow(
  row: StagedCompany,
  patch: { name: string; websiteUrl: string | null },
  existing: ExistingCompany[],
  siblings: StagedCompany[],
): StagedCompany {
  const others = siblings
    .filter((entry) => entry.id !== row.id && entry.state === "new")
    .map((entry) => ({ name: entry.name, websiteUrl: entry.websiteUrl }));
  const name = patch.name.trim();
  const site = patch.websiteUrl ? normalizeWebsiteUrl(patch.websiteUrl) : null;

  if (!readable(name)) {
    return {
      ...row,
      name,
      websiteUrl: site,
      state: "unreadable",
      because: "A company name is still needed before this can be saved.",
      keep: false,
    };
  }
  if (matches(existing, name, site) || matches(others, name, site)) {
    return {
      ...row,
      name,
      websiteUrl: site,
      state: "duplicate",
      because: "This company is already on the Scout board.",
      keep: false,
    };
  }
  return {
    ...row,
    name,
    websiteUrl: site,
    state: "new",
    because: "Not on the board yet.",
    keep: true,
  };
}

/** The rows a person has actually approved for saving. */
export function approvedRows(staged: StagedCompany[]): StagedCompany[] {
  return staged.filter((row) => row.keep && row.state === "new");
}

export interface StagedCounts {
  total: number;
  ready: number;
  duplicate: number;
  unreadable: number;
}

/** Counts only. Never a percentage, never a health score. */
export function stagedCounts(staged: StagedCompany[]): StagedCounts {
  return {
    total: staged.length,
    ready: approvedRows(staged).length,
    duplicate: staged.filter((row) => row.state === "duplicate").length,
    unreadable: staged.filter((row) => row.state === "unreadable").length,
  };
}

/* ----------------------------------------------------------------- search */

export function filterWatchlist(entries: ProspectCandidate[], search: string): ProspectCandidate[] {
  const term = search.trim().toLowerCase();
  if (!term) return entries;
  return entries.filter((entry) =>
    `${entry.prospect.name} ${entry.prospect.domain}`.toLowerCase().includes(term),
  );
}
