/**
 * Stage four: verify.
 *
 * A model may express and connect. It may not introduce. Every claim that
 * comes back is checked against the packet it was given: unknown observation
 * ids, numbers nobody counted, and names nowhere on record are grounds for
 * dropping the claim entirely rather than for editing it into shape.
 *
 * Human-decided truth wins. A reading that contradicts something a person
 * decided is suppressed, not debated.
 */

import type { ConfidenceLevel } from "@/domain/confidence";
import {
  confidenceFromEvidence,
  MAX_HYPOTHESES,
  type BusinessTheme,
  type Hypothesis,
  type Observation,
} from "@/domain/intelligence-engine";

const THEMES: BusinessTheme[] = [
  "capacity",
  "delivery",
  "pipeline",
  "follow_through",
  "friction",
  "client_risk",
  "opportunity",
];

const CONFIDENCE_ORDER: ConfidenceLevel[] = ["unknown", "low", "moderate", "high"];

function capConfidence(level: ConfidenceLevel, cap: ConfidenceLevel): ConfidenceLevel {
  return CONFIDENCE_ORDER.indexOf(level) > CONFIDENCE_ORDER.indexOf(cap) ? cap : level;
}

/** Every number a claim may legitimately contain. */
function allowedNumbers(observations: Observation[]): Set<string> {
  const allowed = new Set<string>();
  for (const row of observations) {
    if (row.magnitude !== undefined) allowed.add(String(row.magnitude));
    for (const match of row.statement.matchAll(/\d+/g)) allowed.add(match[0]);
  }
  return allowed;
}

/** True when the text states a number nobody counted. */
export function inventsNumber(text: string, observations: Observation[]): boolean {
  const allowed = allowedNumbers(observations);
  for (const match of text.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const raw = match[0];
    /* Years and dates are not claims about the business. */
    if (/^(19|20)\d{2}$/.test(raw)) continue;
    if (!allowed.has(raw)) return true;
  }
  return false;
}

/** Money, percentages and rates are never in the packet, so never in a claim. */
const FABRICATION_MARKERS = /[£$€]\s?\d|\d+\s?%|\bper cent\b|\brevenue of\b|\bworth\b\s+[£$€]/i;

/** Causal certainty the evidence cannot carry. */
const CAUSAL_MARKERS =
  /\b(proves?|proven|definitely|certainly|guarantee[sd]?|will (?:definitely|certainly))\b/i;

export interface RawHypothesis {
  claim?: unknown;
  because?: unknown;
  theme?: unknown;
  observationRefs?: unknown;
  contradicts?: unknown;
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Keep only what the packet supports.
 *
 * Returns the survivors and, so failures are legible rather than mysterious,
 * why each rejected claim was dropped.
 */
export function verifyHypotheses(input: {
  raw: RawHypothesis[];
  observations: Observation[];
  now: string;
  /** Statements a person decided. A claim contradicting one is dropped. */
  decided?: string[];
  suppressed?: string[];
}): { hypotheses: Hypothesis[]; rejected: { claim: string; because: string }[] } {
  const byId = new Map(input.observations.map((row) => [row.id, row]));
  const hypotheses: Hypothesis[] = [];
  const rejected: { claim: string; because: string }[] = [];
  const suppressed = new Set(input.suppressed ?? []);
  const seen = new Set<string>();

  for (const [index, entry] of input.raw.entries()) {
    const claim = typeof entry.claim === "string" ? entry.claim.trim() : "";
    const because = typeof entry.because === "string" ? entry.because.trim() : "";
    const refs = stringsOf(entry.observationRefs).filter((ref) => byId.has(ref));
    const theme = THEMES.includes(entry.theme as BusinessTheme)
      ? (entry.theme as BusinessTheme)
      : undefined;

    if (!claim) continue;
    if (refs.length === 0) {
      rejected.push({ claim, because: "No observation on record supports it." });
      continue;
    }
    if (!theme) {
      rejected.push({ claim, because: "It did not name a theme the engine reasons in." });
      continue;
    }
    if (inventsNumber(`${claim} ${because}`, input.observations)) {
      rejected.push({ claim, because: "It stated a number nobody counted." });
      continue;
    }
    if (FABRICATION_MARKERS.test(`${claim} ${because}`)) {
      rejected.push({ claim, because: "It stated a figure the suite does not hold." });
      continue;
    }
    if (CAUSAL_MARKERS.test(claim)) {
      rejected.push({ claim, because: "It claimed certainty the evidence cannot carry." });
      continue;
    }

    const contradictedByPerson = (input.decided ?? []).find((statement) =>
      contradicts(claim, statement),
    );
    if (contradictedByPerson) {
      rejected.push({ claim, because: `A person decided otherwise: “${contradictedByPerson}”.` });
      continue;
    }

    const key = claim.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);

    const supporting = refs.map((ref) => byId.get(ref)!);
    const rooms = new Set(supporting.flatMap((row) => row.sourceApps));
    const patternKey = `engine:reasoned:${theme}`;
    if (suppressed.has(patternKey)) continue;

    hypotheses.push({
      id: `hyp:reasoned:${theme}:${index}`,
      theme,
      claim,
      because: because || supporting.map((row) => row.statement).join(" "),
      /* A reasoned reading is capped at the confidence its evidence earns,
         and never above moderate: a model connected it, nobody confirmed it. */
      confidence: capConfidence(
        confidenceFromEvidence({
          observationCount: supporting.length,
          roomCount: rooms.size,
          stalenessDays: 0,
        }),
        "moderate",
      ),
      observationRefs: refs,
      sourceApps: [...rooms],
      ...(stringsOf(entry.contradicts).filter((ref) => byId.has(ref)).length > 0
        ? { contradicts: stringsOf(entry.contradicts).filter((ref) => byId.has(ref)) }
        : {}),
      patternKey,
      origin: "reasoned" as const,
      at: input.now,
    });
  }

  return { hypotheses: hypotheses.slice(0, MAX_HYPOTHESES), rejected };
}

/**
 * A crude, deliberate contradiction test: the same subject, opposite polarity.
 *
 * It is intentionally conservative. Missing a contradiction costs a person one
 * correction; inventing one silences something true.
 */
export function contradicts(claim: string, decided: string): boolean {
  const a = claim.toLowerCase();
  const b = decided.toLowerCase();
  const subject = b
    .replace(/^(no longer true:|confirmed as true:|put right by a person:)/, "")
    .replace(/[“”"’'.]/g, "")
    .split(/\s+/)
    .filter((word) => word.length > 4);
  if (subject.length < 2) return false;
  const overlap = subject.filter((word) => a.includes(word)).length / subject.length;
  if (overlap < 0.6) return false;
  const negated = /\b(no|not|never|nothing|without)\b/;
  return negated.test(a) !== negated.test(b);
}
