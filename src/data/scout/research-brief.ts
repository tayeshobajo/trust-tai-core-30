/**
 * Scout research brief, pure logic.
 *
 * Four provenance classes, kept strictly apart and never promoted:
 *   STATED     the founder told us, in the website intake. Testimony.
 *   OBSERVED   Scout read it from a public page. Evidence.
 *   INFERRED   an interpretation of that evidence. Scout's read.
 *   SUGGESTED  a possible next move. Never approved work.
 *
 * Nothing here calls a model, writes state, or invents coverage. Where there
 * is no data, the shape says so instead of filling the gap.
 */

import type { ProspectCandidate, ScoutSignal } from "@/domain/scout";
import { STATED_LANE_LABEL, STATED_LANE_ORDER, type StatedLane } from "@/domain/stated";
import type { ConfidenceLevel } from "@/domain/confidence";

import type { EvidenceReview, ReviewedClaim } from "./research-workspace";

/* ------------------------------------------------------------- coverage --- */

export interface CoverageArea {
  key: string;
  label: string;
  /** What Scout would be looking for. Shown when nothing has been checked. */
  looksFor: string;
  checked: boolean;
  /** The observed signal that proves this area was actually checked. */
  evidence?: ScoutSignal;
}

const COVERAGE_AREAS: { key: string; label: string; looksFor: string; match: RegExp }[] = [
  {
    key: "positioning",
    label: "Website / positioning",
    looksFor: "How they describe what they do on their own pages.",
    match: /(positioning|headline|home ?page|about|service|offering|tagline|hero)/i,
  },
  {
    key: "search",
    label: "Search visibility",
    looksFor: "Whether they can be found for what they sell.",
    match: /(search|seo|organic|indexed|meta (title|description)|keyword|ranking)/i,
  },
  {
    key: "gbp",
    label: "Google Business Profile",
    looksFor: "A claimed local listing, when the business is local.",
    match: /(google business|business profile|gbp|maps listing|local listing)/i,
  },
  {
    key: "reviews",
    label: "Reviews / reputation",
    looksFor: "Public reviews, ratings, or testimonials.",
    match: /(review|rating|testimonial|reputation|trustpilot|stars)/i,
  },
  {
    key: "conversion",
    label: "Conversion path / lead capture",
    looksFor: "How an interested visitor actually gets in touch.",
    match: /(contact form|enquiry|inquiry|lead capture|call to action|\bcta\b|booking|quote form|phone number)/i,
  },
  {
    key: "social",
    label: "Social / public profiles",
    looksFor: "Active public profiles they point people to.",
    match: /(linkedin|instagram|facebook|social|youtube|tiktok|\bx\.com\b|twitter)/i,
  },
  {
    key: "content",
    label: "Content footprint",
    looksFor: "Whether they publish anything, and how recently.",
    match: /(blog|article|news|case stud|resource|guide|publish|content)/i,
  },
  {
    key: "tech",
    label: "Basic public tech footprint",
    looksFor: "The platform the public site runs on, and obvious age.",
    match: /(wordpress|shopify|webflow|squarespace|wix|react|platform|\bcms\b|https|ssl|framework|technology)/i,
  },
  {
    key: "competitors",
    label: "Competitors",
    looksFor: "Only checked when a comparison would change the read.",
    match: /(competitor|alternative to|versus|compared with)/i,
  },
];

/** The coverage area a piece of text belongs to, or null when it fits none. */
export function areaForText(text: string): string | null {
  if (!text.trim()) return null;
  return COVERAGE_AREAS.find((area) => area.match.test(text))?.key ?? null;
}

export const COVERAGE_AREA_LABEL: Record<string, string> = Object.fromEntries(
  COVERAGE_AREAS.map((area) => [area.key, area.label]),
);

/**
 * What has and has not been looked at. Derived only from observed signals and
 * recorded facts; absence is reported as not checked, never as a finding.
 */
export function evidenceCoverage(candidate: ProspectCandidate, observed: ScoutSignal[]): {
  areas: CoverageArea[];
  checkedCount: number;
  total: number;
} {
  const factText = Object.keys(candidate.facts ?? {}).join(" ");
  const areas = COVERAGE_AREAS.map((area) => {
    const evidence = observed.find(
      (signal) => area.match.test(signal.statement) || area.match.test(signal.sourceUrl ?? ""),
    );
    const inFacts = area.match.test(factText);
    return {
      key: area.key,
      label: area.label,
      looksFor: area.looksFor,
      checked: Boolean(evidence) || inFacts,
...(evidence ? { evidence }: {}),
    };
  });
  return {
    areas,
    checkedCount: areas.filter((area) => area.checked).length,
    total: areas.length,
  };
}

/* --------------------------------------------------------- research state - */

export type ResearchState = "not_started" | "ready" | "running" | "complete" | "needs_review";

export const RESEARCH_STATE_LABEL: Record<ResearchState, string> = {
  not_started: "Not started",
  ready: "Ready",
  running: "Running",
  complete: "Complete",
  needs_review: "Needs review",
};

export function researchState(input: {
  observedCount: number;
  canResearch: boolean;
  contradictions: number;
  checkedCount: number;
  running?: boolean;
}): ResearchState {
  if (input.running) return "running";
  if (input.observedCount === 0) return input.canResearch ? "ready": "not_started";
  if (input.contradictions > 0 || input.checkedCount < 3) return "needs_review";
  return "complete";
}

/** The most recent moment Scout actually read something public. */
export function lastResearchedAt(candidate: ProspectCandidate): string | null {
  const runs = candidate.history ?? [];
  const last = runs.length > 0 ? runs[runs.length - 1]: null;
  if (last?.at) return last.at;
  if (candidate.source.kind === "live_website") {
    return candidate.source.researchedAt ?? candidate.lastCheckedAt ?? null;
  }
  return null;
}

/* ------------------------------------------------------------ four lanes - */

export interface InferredRead {
  statement: string;
  /** The evidence the read rests on. Never empty. */
  because: string;
  confidence: ConfidenceLevel;
  sourceUrl?: string;
}

export interface SuggestedMove {
  statement: string;
  because: string;
}

export interface EvidenceTheme {
  key: string;
  label: string;
  stated: string[];
  observed: ScoutSignal[];
  inferred: InferredRead[];
  suggested: SuggestedMove[];
}

const STOPWORDS = new Set([
  "about", "after", "again", "their", "there", "these", "those", "which", "while",
  "with", "that", "this", "from", "have", "been", "they", "them", "into", "more",
  "than", "then", "when", "will", "would", "could", "should", "want", "wants",
  "need", "needs", "make", "making", "does", "doing", "just", "also", "very",
  "much", "some", "over", "under", "before", "because", "company", "business",
]);

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4 || STOPWORDS.has(raw)) continue;
    out.add(raw.endsWith("s") && raw.length > 4 ? raw.slice(0, -1): raw);
  }
  return out;
}

function overlaps(a: Set<string>, b: Set<string>, min = 2): boolean {
  let count = 0;
  for (const token of a) if (b.has(token)) count += 1;
  return count >= min;
}

/**
 * One readable sequence per business theme: what they said, what we read, what
 * it may mean, and what could be done next. Themes come from the founder's own
 * lanes, plus one closing theme for evidence nothing stated speaks to.
 */
export function evidenceThemes(
  candidate: ProspectCandidate,
  review: EvidenceReview,
): EvidenceTheme[] {
  const opportunities = candidate.intel?.opportunities ?? [];
  const themes: EvidenceTheme[] = [];
  const usedObserved = new Set<string>();

  for (const lane of STATED_LANE_ORDER) {
    const claims = review.claims.filter((claim) => claim.lane === lane);
    if (claims.length === 0) continue;

    const observed: ScoutSignal[] = [];
    for (const claim of claims) {
      for (const signal of claim.corroboration) {
        if (usedObserved.has(signal.id)) continue;
        usedObserved.add(signal.id);
        observed.push(signal);
      }
    }

    const laneTokens = tokens(claims.map((claim) => claim.statement).join(" "));
    const inferred: InferredRead[] = opportunities
.filter((opportunity) => overlaps(laneTokens, tokens(`${opportunity.statement} ${opportunity.evidence}`)))
.slice(0, 2)
.map((opportunity) => ({
        statement: opportunity.statement,
        because: opportunity.evidence,
        confidence: "moderate" as ConfidenceLevel,
...(opportunity.sourceUrl ? { sourceUrl: opportunity.sourceUrl }: {}),
      }));

    themes.push({
      key: lane,
      label: STATED_LANE_LABEL[lane],
      stated: claims.map((claim) => claim.statement),
      observed,
      inferred,
      suggested: laneSuggestions(lane, claims, observed.length > 0),
    });
  }

  const loose = review.observed.filter((signal) => !usedObserved.has(signal.id));
  if (loose.length > 0) {
    themes.push({
      key: "unclaimed_evidence",
      label: "What we read that they did not mention",
      stated: [],
      observed: loose,
      inferred: [],
      suggested:
        review.totalClaims > 0
          ? [
              {
                statement: "Ask whether any of this matters to them",
                because: "They never raised it, so its weight is unknown until they say.",
              },
            ]
: [],
    });
  }

  return themes;
}

function laneSuggestions(
  lane: StatedLane,
  claims: ReviewedClaim[],
  hasObserved: boolean,
): SuggestedMove[] {
  const unverified = claims.filter((claim) => claim.standing === "unverified");
  if (unverified.length === 0) return [];
  const first = unverified[0]!;
  if (!hasObserved && (lane === "pains" || lane === "desired_future" || lane === "goals")) {
    return [
      {
        statement: `Ask one more question about: ${first.statement}`,
        because: "Nothing public speaks to this yet, so only they can settle it.",
      },
    ];
  }
  return [
    {
      statement: `Look for public evidence of: ${first.statement}`,
      because: `${unverified.length} claim${unverified.length === 1 ? "": "s"} in this theme rest on their word alone.`,
    },
  ];
}

/* ------------------------------------------------------- contradictions -- */

export interface Contradiction {
  key: string;
  headline: string;
  stated: string;
  observed: string;
  sourceUrl?: string;
  /** Always calm: a mismatch is a question, not a verdict. */
  note: string;
}

const RULES: {
  key: string;
  headline: string;
  stated: RegExp;
  observed: RegExp;
  note: string;
}[] = [
  {
    key: "visibility",
    headline: "They think visibility is the problem, the site looks findable",
    stated: /(not (being )?found|invisible|no ?one finds|visibility|seo|search|traffic|ranking)/i,
    observed: /(strong|good|healthy|high|steady)\s+(search|seo|organic|visibility|traffic|ranking)/i,
    note: "The problem they feel may be conversion or lead quality rather than being found. Worth asking.",
  },
  {
    key: "capture",
    headline: "They want follow-up, but no capture path is visible",
    stated: /(follow ?up|automat|nurtur|lead|enquir|inquir|booking|crm)/i,
    observed: /((no|missing|without|lacks)\s+(contact form|enquiry form|inquiry form|lead capture|call to action|cta|booking))/i,
    note: "Automating follow-up assumes something to follow up on. Confirm how enquiries reach them today.",
  },
  {
    key: "audience",
    headline: "They describe premium or commercial work, the site speaks otherwise",
    stated: /(premium|high ?end|luxury|commercial|enterprise|corporate|b2b)/i,
    observed: /(residential|domestic|homeowner|budget|cheap|diy|consumer)/i,
    note: "The public site may be aimed at a different buyer than the one they want. Ask which is current.",
  },
];

const MEANINGFUL_WORDS = 4;

function meaningful(text: string): boolean {
  return text.trim().split(/\s+/).filter(Boolean).length >= MEANINGFUL_WORDS;
}

/**
 * A mismatch needs a real stated claim and a real observed signal. Weak
 * evidence produces nothing at all, deliberately.
 */
export function contradictions(review: EvidenceReview): Contradiction[] {
  const found: Contradiction[] = [];
  for (const rule of RULES) {
    const claim = review.claims.find(
      (entry) => meaningful(entry.statement) && rule.stated.test(entry.statement),
    );
    if (!claim) continue;
    const signal = review.observed.find(
      (entry) => meaningful(entry.statement) && rule.observed.test(entry.statement),
    );
    if (!signal) continue;
    found.push({
      key: rule.key,
      headline: rule.headline,
      stated: claim.statement,
      observed: signal.statement,
...(signal.sourceUrl ? { sourceUrl: signal.sourceUrl }: {}),
      note: rule.note,
    });
  }
  return found;
}

/* --------------------------------------------------------- the Scout read - */

export interface ScoutRead {
  appearsTrue: string[];
  stillUncertain: string[];
  deservesAttention: string[];
  doNotAssume: string[];
}

export function scoutRead(input: {
  review: EvidenceReview;
  coverage: { checkedCount: number; total: number; areas: CoverageArea[] };
  conflicts: Contradiction[];
  permissionState: string;
}): ScoutRead {
  const { review, coverage, conflicts } = input;

  const appearsTrue = review.claims
.filter((claim) => claim.standing === "corroborated")
.slice(0, 3)
.map((claim) => `Stated: ${claim.statement}, observed evidence speaks to it.`);

  const unverified = review.claims.filter((claim) => claim.standing === "unverified");
  const stillUncertain = unverified
.slice(0, 3)
.map((claim) => `Stated, unchecked: ${claim.statement}`);
  const unchecked = coverage.areas.filter((area) => !area.checked);
  if (unchecked.length > 0) {
    stillUncertain.push(
      `Not checked yet: ${unchecked.map((area) => area.label).join(", ")}.`,
    );
  }

  const deservesAttention = conflicts.map((conflict) => `Mismatch: ${conflict.headline}`);
  if (input.permissionState === "unknown") {
    deservesAttention.push(
      "Research permission was never asked in the intake. You decide before anything runs.",
    );
  }
  if (input.permissionState === "withheld") {
    deservesAttention.push("They declined research. Everything here is their testimony only.");
  }
  if (deservesAttention.length === 0 && review.observed.length === 0) {
    deservesAttention.push("Nothing public has been read about this company yet.");
  }

  const doNotAssume = [
    "Nothing marked Stated has been verified. It is first-person testimony.",
    "Anything marked Suggested is a possible next move, not approved work.",
  ];
  if (review.observed.length === 0) {
    doNotAssume.push("No inference on this page rests on public evidence, because none was read.");
  }

  return { appearsTrue, stillUncertain, deservesAttention, doNotAssume };
}
