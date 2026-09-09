/**
 * LinkedIn candidate ranking — pure, no transport, no network.
 *
 * This is the identity-confidence layer that sits between "some source
 * proposed these profiles" and "a human is shown a shortlist". It was written
 * for the Linki lookup (P1.10, 2026-08-26) and is deliberately kept whole here:
 * the ranking never depended on Linki, only on candidate cards, so it outlives
 * the transport that first fed it.
 *
 * Matching doctrine: the NAME is the only identity anchor. Company, title,
 * location, and domain are RANKING EVIDENCE — they raise confidence in a
 * name-matched candidate and can never conjure one.
 *
 * Fail closed. When nothing clears the bar the answer is an empty list plus an
 * explicit reason, never a best guess. Ranking is display order only; a human
 * still confirms identity before anything becomes a route.
 */

export interface LinkedinCandidate {
  linkedinUrl: string;
  fullName: string;
  headline: string | null;
  location: string | null;
  degree: string | null;
  company: string | null;
}

/** The person we are trying to reach. Only `fullName` is an identity anchor. */
export interface LinkedinLookupInput {
  fullName: string;
  companyName?: string;
  companyDomain?: string;
  roleTitle?: string;
  location?: string;
}

/**
 * Ranked candidate for display. `why` is the human-readable evidence trail
 * ("Why this may be the person"). `nameSimilarity` is kept for tests and
 * ordering transparency, never persisted anywhere.
 */
export interface RankedLinkedinCandidate extends LinkedinCandidate {
  score: number;
  why: string[];
  nameSimilarity: number;
}

/**
 * Normalize a human name for comparison: fold the several Unicode dashes
 * LinkedIn and CRMs disagree about, collapse whitespace, NFKC full-width forms
 * down to ASCII.
 */
export function normalizeName(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[‐‑‒–—−﹘﹣－]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokens used for evidence overlap: lowercase, alphanumeric words, ≥3 chars. */
function tokenize(value: string | null | undefined): string[] {
  if (!value) return [];
  return (value.toLowerCase().match(/[a-z0-9][a-z0-9&'’.-]*/g) ?? []).filter((t) => t.length >= 3);
}

/** Strip corporate suffix noise so "Acme Insurance Group" overlaps "Acme". */
const CORPORATE_SUFFIXES = new Set([
  "inc",
  "llc",
  "ltd",
  "limited",
  "co",
  "corp",
  "corporation",
  "company",
  "group",
  "holdings",
  "partners",
  "solutions",
  "services",
  "the",
]);

function companyTokens(value: string | null | undefined): string[] {
  return tokenize(value).filter((t) => !CORPORATE_SUFFIXES.has(t));
}

/**
 * Name similarity in [0,1]: 1 when the token sets are identical (order
 * ignored), scaled by overlap otherwise. Hyphens are separators — LinkedIn
 * normalizes "Anne-Marie" and "Anne Marie" the same way in profile URLs.
 */
function nameSimilarity(a: string, b: string): number {
  const split = (v: string) =>
    normalizeName(v)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2);
  const ta = split(a);
  const tb = split(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const setB = new Set(tb);
  const shared = ta.filter((t) => setB.has(t)).length;
  return shared / Math.max(ta.length, tb.length);
}

/**
 * Human identity gate for multi-part names: the visible first and last name
 * must agree before company/title evidence can help. This blocks false
 * positives like "Jonathan Muller" for "Jonathan Mull" and fabricated names
 * that share only one token.
 */
function hasStrongHumanNameMatch(a: string, b: string): boolean {
  const split = (v: string) =>
    normalizeName(v)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2);
  const ta = split(a);
  const tb = split(b);
  if (ta.length === 0 || tb.length === 0) return false;
  if (ta.length === 1 || tb.length === 1) return ta[0] === tb[0];
  return ta[0] === tb[0] && ta[ta.length - 1] === tb[tb.length - 1];
}

/** Evidence overlap between a candidate's card text and one reference field. */
function overlap(haystackTokens: string[], reference: string[]): string[] {
  const ref = new Set(reference);
  return [...new Set(haystackTokens.filter((t) => ref.has(t)))];
}

export const NO_CONFIDENT_MATCH_REASON = "No confident LinkedIn match found";

/**
 * Rank raw candidates against the person we are looking for.
 *
 * Evidence (all optional, all additive):
 *   +2.0 per matched company token (company name / candidate company field)
 *   +1.5 per matched role-title token (title vs headline)
 *   +0.75 per matched location token
 *   +0.5 per matched domain root (acme.com → "acme") anywhere on the card
 *   + name similarity × 1.0 (identity anchor — a very different name can
 *     never rank top on evidence alone)
 *
 * FAIL CLOSED: a candidate must (a) fuzzy-match the name (similarity ≥ 0.5)
 * AND (b) score ≥ 1.5 to be offered — strictly above the 1.0 a perfect name
 * match alone earns, so at least one real piece of evidence (company, role,
 * location, or domain) is required. Otherwise the result is an empty list
 * with the explicit no-match reason. Nothing is ever auto-picked, and ranking
 * is display-order only — a human still confirms identity.
 */
export function rankCandidates(
  person: LinkedinLookupInput,
  candidates: LinkedinCandidate[],
): { ranked: RankedLinkedinCandidate[]; noMatchReason: string | null } {
  const companyRef = companyTokens(person.companyName);
  const titleRef = tokenize(person.roleTitle);
  const locationRef = tokenize(person.location);
  const domainRoot = person.companyDomain
    ? (person.companyDomain
        .toLowerCase()
        .replace(/^www\./, "")
        .split(".")[0] ?? "")
    : "";

  const ranked: RankedLinkedinCandidate[] = [];
  for (const candidate of candidates) {
    const similarity = nameSimilarity(person.fullName, candidate.fullName);
    if (similarity < 0.5 || !hasStrongHumanNameMatch(person.fullName, candidate.fullName)) {
      continue; // wrong-person shield: first/last human name must still agree
    }

    const cardCompany = companyTokens(candidate.company);
    const cardHeadline = tokenize(candidate.headline);
    const cardLocation = tokenize(candidate.location);
    const cardAll = [...cardHeadline, ...cardCompany, ...cardLocation];

    const why: string[] = [];
    let score = similarity; // identity anchor

    const companyHits = overlap(cardCompany.length ? cardCompany : cardHeadline, companyRef);
    if (companyHits.length > 0) {
      score += companyHits.length * 2;
      why.push(`Company match: ${companyHits.join(", ")}`);
    }
    const titleHits = overlap(cardHeadline, titleRef);
    if (titleHits.length > 0) {
      score += titleHits.length * 1.5;
      why.push(`Role match: ${titleHits.join(", ")}`);
    }
    const locationHits = overlap(cardLocation, locationRef);
    if (locationHits.length > 0) {
      score += locationHits.length * 0.75;
      why.push(`Location match: ${locationHits.join(", ")}`);
    }
    if (domainRoot.length >= 3 && cardAll.includes(domainRoot)) {
      score += 0.5;
      why.push(`Website match: ${domainRoot}`);
    }

    if (score < 1.5) continue; // below threshold → name alone is never enough

    ranked.push({
      ...candidate,
      score: Math.round(score * 100) / 100,
      why,
      nameSimilarity: similarity,
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  if (ranked.length === 0) {
    return { ranked: [], noMatchReason: NO_CONFIDENT_MATCH_REASON };
  }
  return { ranked, noMatchReason: null };
}
