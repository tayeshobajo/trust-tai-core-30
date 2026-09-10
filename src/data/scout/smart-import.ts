/**
 * Smart Import, the pure part.
 *
 * Everything here can be reasoned about without a network, a model or a
 * browser: what source we can honestly read, what a model is allowed to
 * return, whether what it returned is actually present in the source, and
 * what the reviewed staged batch looks like.
 *
 * Grounding is the law of this module: a company Scout cannot point at in the
 * source is dropped with a reason, never reshaped into something plausible.
 */

import type {
  ExtractedCompany,
  ExtractionConfidence,
  SmartImportSource,
} from "@/domain/scout-smart-import";
import type { StagedCompany, StagedState } from "@/domain/scout-watchlist";
import { matches, type ExistingCompany } from "@/data/scout/watchlist";
import { normalizeWebsiteUrl } from "@/lib/website-url";

/* ------------------------------------------------------------------ links */

export type LinkRead =
  | { readable: true; url: string; kind: "google_sheet" | "google_doc" | "web" }
  | { readable: false; because: string };

const SHEET = /^https?:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;
const DOC = /^https?:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9-_]+)/;
const DRIVE_FILE = /^https?:\/\/drive\.google\.com\//;

/**
 * What we would fetch for a pasted link. Google files are read through their
 * public export addresses, which only answer for a link that is genuinely
 * shared. A private file is refused in words rather than half-read.
 */
export function readLink(raw: string): LinkRead {
  const link = raw.trim();
  if (!link) return { readable: false, because: "Paste a link first." };
  if (!/^https?:\/\//i.test(link)) {
    return { readable: false, because: "That is not a web address. Links start with https://" };
  }

  const sheet = SHEET.exec(link);
  if (sheet) {
    return {
      readable: true,
      kind: "google_sheet",
      url: `https://docs.google.com/spreadsheets/d/${sheet[1]}/export?format=csv`,
    };
  }
  const doc = DOC.exec(link);
  if (doc) {
    return {
      readable: true,
      kind: "google_doc",
      url: `https://docs.google.com/document/d/${doc[1]}/export?format=txt`,
    };
  }
  if (DRIVE_FILE.test(link)) {
    return {
      readable: false,
      because:
        "Drive files cannot be read yet. Open the file in Google Docs or Sheets and paste that link, or export it and upload the file.",
    };
  }
  return { readable: true, kind: "web", url: link };
}

export const LINK_KIND_LABEL: Record<"google_sheet" | "google_doc" | "web", string> = {
  google_sheet: "Google Sheet",
  google_doc: "Google Doc",
  web: "Web page",
};

/* ------------------------------------------------------------- the prompt */

export const SMART_IMPORT_INSTRUCTIONS = `You read one source document and list the companies a business development
person could add to a watchlist. The source may be a spreadsheet export, a list, a report, or plain
prose. It may be messy.

Laws you must obey:
1. Use only the source text given to you. Never add a company, a website or a fact that is not in it.
2. For every company, return "excerpt": a short span of text copied VERBATIM from the source that
   mentions it. If you cannot copy such a span, do not return that company at all.
3. Only put a website in "websiteUrl" if it appears in the source. If you are reading the domain from
   the company name or from context, set "websiteConfidence" to "inferred". Never guess a domain that
   is not in the source; leave websiteUrl null instead.
4. Do not include people, job titles, products, cities or the author's own organisation.
5. Do not rank, score, or decide who is worth contacting. That is a person's decision.
6. If the source contains no companies, return an empty list. Silence is a valid answer.

Return strict JSON only:
{"companies":[{"name":"...","websiteUrl":"... or null","websiteConfidence":"observed|inferred",
"note":"one short line from the source, or null","because":"one sentence","excerpt":"verbatim span"}]}

At most 60 companies.`;

/** How much source text we are willing to send to the model in one pass. */
export const SMART_IMPORT_TEXT_LIMIT = 120_000;

/* -------------------------------------------------------------- grounding */

function flatten(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function str(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value.trim() : "";
}

export interface VerifiedExtraction {
  companies: ExtractedCompany[];
  /** Rows the model returned that could not be traced back to the source. */
  dropped: { name: string; because: string }[];
}

/**
 * Keep only what the source actually says. A row without a verbatim excerpt,
 * or whose excerpt is not in the source, is dropped and counted, never
 * silently repaired.
 */
export function verifyExtraction(raw: unknown, sourceText: string): VerifiedExtraction {
  const source = flatten(sourceText);
  const list =
    raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>)["companies"])
      ? ((raw as Record<string, unknown>)["companies"] as unknown[])
      : [];

  const companies: ExtractedCompany[] = [];
  const dropped: VerifiedExtraction["dropped"] = [];

  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const name = str(row, "name");
    const excerpt = str(row, "excerpt");

    if (!name) {
      dropped.push({ name: "(unnamed)", because: "No company name was returned." });
      continue;
    }
    if (!excerpt || !source.includes(flatten(excerpt))) {
      dropped.push({ name, because: "Scout could not point at this in the source." });
      continue;
    }

    const site = normalizeWebsiteUrl(str(row, "websiteUrl"));
    const claimed = str(row, "websiteConfidence") === "observed" ? "observed" : "inferred";
    // Observed means literally present. We check rather than take its word.
    const present = site ? source.includes(flatten(site.replace(/^https?:\/\//i, ""))) : false;
    const websiteConfidence: ExtractionConfidence =
      site && present && claimed === "observed" ? "observed" : "inferred";

    companies.push({
      name,
      websiteUrl: site,
      websiteConfidence,
      note: str(row, "note") || null,
      because: str(row, "because") || "Named in the source.",
      excerpt,
    });
  }

  return { companies, dropped };
}

/* ---------------------------------------------------------------- staging */

/**
 * Turn verified extractions into the same staged rows the review UI already
 * understands. Duplicates are decided against the canonical board and against
 * the rest of this batch. Nothing is saved here.
 */
export function stageExtracted(
  companies: ExtractedCompany[],
  existing: ExistingCompany[],
  source: SmartImportSource,
): StagedCompany[] {
  const seen: ExistingCompany[] = [];
  return companies.map((company, index) => {
    const site = company.websiteUrl;
    let state: StagedState = "new";
    let because = company.because;

    if (matches(existing, company.name, site)) {
      state = "duplicate";
      because = "This company is already on the Scout board.";
    } else if (matches(seen, company.name, site)) {
      state = "duplicate";
      because = "This company appears more than once in this source.";
    } else {
      seen.push({ name: company.name, websiteUrl: site });
    }

    return {
      id: `smart-${index}-${company.name.toLowerCase().replace(/\s+/g, "-").slice(0, 40)}`,
      raw: company.excerpt || `${company.name} (${source.label})`,
      name: company.name,
      websiteUrl: site,
      state,
      because,
      keep: state === "new",
      extraction: company,
    };
  });
}

/** How the staged banner names where the batch came from. */
export function sourceLabel(source: SmartImportSource): string {
  return source.kind === "text" ? "the pasted text" : source.label;
}
