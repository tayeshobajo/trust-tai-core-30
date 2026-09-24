/**
 * The World Card: what the system honestly knows about a prospect's world
 * before it decides anything.
 *
 * Pure types and pure checks only. Composition from stored evidence lives in
 * src/data/world-card.ts; nothing here fetches or writes.
 *
 * Laws:
 *  - Every entry on the card carries or references observed evidence.
 *  - A field with no evidence stays empty, and `unknowns` says what is
 *    missing. Absence is unknown, never a claim.
 *  - The card is the only source a written intro may draw statements from.
 */

export interface WorldCardEvidence {
  /** The statement exactly as it may be relied on. */
  statement: string;
  /** Where it was read: a URL, or the named stored field it came from. */
  source: string;
}

export interface WorldCard {
  /** What the company is visibly building or selling. */
  building: string[];
  /** What they visibly care about: proof, values, community, craft. */
  caresAbout: string[];
  /** Recent observed changes: launches, hires, funding, announcements. */
  recentChanges: string[];
  /** Observed signs their vision has outgrown their current system. */
  visionOutgrewSystem: string[];
  /** Momentum paired with an observed gap: the honest reason to talk. */
  whyTrustTai: string[];
  /** What is genuinely not known yet, named plainly. */
  unknowns: string[];
  /** Every statement above, with its source. */
  evidence: WorldCardEvidence[];
  composedAt: string;
  evaluatorVersion: string;
  /** When the underlying intel was collected, when the row records it. */
  intelCollectedAt: string | null;
}

/** Total evidence-backed entries across the substantive fields. */
export function worldCardEvidenceCount(card: WorldCard): number {
  return (
    card.building.length +
    card.caresAbout.length +
    card.recentChanges.length +
    card.visionOutgrewSystem.length +
    card.whyTrustTai.length
  );
}

/** True when what is missing outweighs what is known. */
export function unknownsDominate(card: WorldCard): boolean {
  return card.unknowns.length > worldCardEvidenceCount(card);
}

/* ------------------------------------------------- truth discipline check */

export type TruthViolationKind = "unresolved_placeholder" | "unevidenced_claim";

export interface TruthViolation {
  kind: TruthViolationKind;
  detail: string;
}

export interface TruthCheck {
  passes: boolean;
  violations: TruthViolation[];
}

/**
 * Phrases that mark a sentence as claiming something observed about the
 * recipient. Any sentence carrying one must be traceable to card evidence.
 */
const CLAIM_MARKERS =
  /\b(i saw|i noticed|i read|i came across|you recently|your new|your recent|you launched|you just|just launched|congratulations|congrats|i see (that )?you)\b/i;

const STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "because",
  "being",
  "could",
  "every",
  "having",
  "really",
  "recently",
  "should",
  "their",
  "there",
  "these",
  "thing",
  "think",
  "those",
  "through",
  "which",
  "while",
  "would",
  "yours",
]);

function significantTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 5 && !STOPWORDS.has(token));
}

function splitSentences(body: string): string[] {
  return body
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/**
 * SEE, CONNECT, OFFER, LEAVE ROOM: the SEE part may only state what the
 * World Card evidences. This is a Phase A heuristic, honestly limited:
 *
 *  - Unresolved placeholders ({{name}}, {name}, [NAME]) always fail: a
 *    placeholder is a claim with no referent at all.
 *  - A sentence carrying a claim marker (see CLAIM_MARKERS) must share at
 *    least one significant token with some evidence statement on the card.
 *    Token overlap is a proxy for grounding, not proof of it; a paraphrase
 *    with no shared vocabulary will be flagged even when true, and a false
 *    claim reusing an evidenced word can slip through. The human review and
 *    the voice gate remain downstream; Phase B replaces this with a
 *    judgment-layer check.
 *  - Sentences with no claim marker (generic offer or sign-off language)
 *    pass; they claim nothing observed.
 */
export function checkIntroTruth(body: string, card: WorldCard): TruthCheck {
  const violations: TruthViolation[] = [];

  const placeholders = body.match(/\{\{[^}]*\}\}|\{[a-z_ ]+\}|\[[A-Z][A-Z _-]{2,}\]/g) ?? [];
  for (const placeholder of placeholders) {
    violations.push({
      kind: "unresolved_placeholder",
      detail: `The draft still contains the placeholder ${placeholder}, which no evidence resolves.`,
    });
  }

  const evidenceTokens = new Set(
    card.evidence.flatMap((entry) => significantTokens(entry.statement)),
  );

  for (const sentence of splitSentences(body)) {
    if (!CLAIM_MARKERS.test(sentence)) continue;
    const grounded = significantTokens(sentence).some((token) => evidenceTokens.has(token));
    if (!grounded) {
      violations.push({
        kind: "unevidenced_claim",
        detail: `No evidence on the World Card backs: "${sentence.slice(0, 160)}"`,
      });
    }
  }

  return { passes: violations.length === 0, violations };
}
