/**
 * Evidence provenance, pure logic.
 *
 * Every observed, inferred or suggested claim in the research workspace must
 * be able to answer four questions without anyone opening a database:
 *
 *   Where did it come from?   url + title + kind
 *   When was it read?         timestamp
 *   What exactly was read?    snippet
 *   How sure are we?          confidence
 *
 * Nothing here invents any of those. Where a value is genuinely unknown the
 * audit says so, because a blank audit trail is more honest than a guessed one.
 */

import type { ConfidenceLevel } from "@/domain/confidence";
import type { ScoutSignal } from "@/domain/scout";

export type EvidenceKind = "page" | "provider" | "computed" | "human" | "testimony";

export const EVIDENCE_KIND_LABEL: Record<EvidenceKind, string> = {
  page: "Public page",
  provider: "External provider",
  computed: "Derived from evidence",
  human: "Recorded by a person",
  testimony: "Founder testimony",
};

export interface EvidenceAudit {
  /** The page the claim was read from, when a real public URL exists. */
  url?: string;
  /** Readable title: page path, provider name, or what produced the claim. */
  title: string;
  kind: EvidenceKind;
  /** ISO timestamp of when the claim was read, or null when never recorded. */
  observedAt: string | null;
  /** The exact wording the claim rests on. Never paraphrased here. */
  snippet: string;
  confidence: ConfidenceLevel;
  /** Who or what produced it, e.g. `scout.research`. */
  actor: string;
}

const MAX_SNIPPET = 240;

function clip(text: string): string {
  const value = text.trim();
  return value.length <= MAX_SNIPPET ? value : `${value.slice(0, MAX_SNIPPET - 1)}…`;
}

/** Human title for a URL: host plus the readable last path segment. */
export function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const segment = parsed.pathname.split("/").filter(Boolean).pop();
    if (!segment) return `${host} · home page`;
    const readable = segment
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[-_]+/g, " ")
      .trim();
    return readable ? `${host} · ${readable}` : host;
  } catch {
    return url;
  }
}

function actorOf(signal: ScoutSignal): string {
  const actor = signal.provenance.actor;
  return actor.label ?? actor.id ?? actor.type;
}

/**
 * The audit trail for one observed signal. A signal Scout read from a public
 * page is `page`; anything echoed back from the website intake is testimony
 * and is labelled as such, never as observation.
 */
export function auditForSignal(signal: ScoutSignal): EvidenceAudit {
  const fromIntake = signal.provenance.appId === "website";
  const url = signal.sourceUrl;
  const kind: EvidenceKind = fromIntake ? "testimony" : url ? "page" : "provider";
  return {
    ...(url ? { url } : {}),
    title: url ? titleFromUrl(url) : fromIntake ? "TrustTai.com intake" : signal.provenance.appId,
    kind,
    observedAt: signal.provenance.observedAt || null,
    snippet: clip(signal.statement),
    confidence: fromIntake ? "unknown" : (signal.provenance.confidence ?? "moderate") as ConfidenceLevel,
    actor: actorOf(signal),
  };
}

const STOP = /[^a-z0-9]+/;

function keyTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(STOP)) {
    if (raw.length >= 5) out.add(raw);
  }
  return out;
}

/** The observed signal an interpretation most plausibly rests on, if any. */
export function supportingSignal(
  because: string,
  sourceUrl: string | undefined,
  observed: ScoutSignal[],
): ScoutSignal | null {
  if (sourceUrl) {
    const byUrl = observed.find((signal) => signal.sourceUrl === sourceUrl);
    if (byUrl) return byUrl;
  }
  const wanted = keyTokens(because);
  if (wanted.size === 0) return null;
  let best: { signal: ScoutSignal; score: number } | null = null;
  for (const signal of observed) {
    const tokens = keyTokens(signal.statement);
    let score = 0;
    for (const token of wanted) if (tokens.has(token)) score += 1;
    if (score >= 2 && (!best || score > best.score)) best = { signal, score };
  }
  return best?.signal ?? null;
}

/**
 * Audit for an inference. An inference is always `computed`: it points at the
 * observation underneath it rather than pretending to be that observation.
 */
export function auditForInferred(
  read: { statement: string; because: string; confidence: ConfidenceLevel; sourceUrl?: string },
  observed: ScoutSignal[],
): EvidenceAudit {
  const support = supportingSignal(read.because, read.sourceUrl, observed);
  const url = read.sourceUrl ?? support?.sourceUrl;
  return {
    ...(url ? { url } : {}),
    title: url ? titleFromUrl(url) : "Scout interpretation",
    kind: "computed",
    observedAt: support?.provenance.observedAt ?? null,
    snippet: clip(read.because),
    // An interpretation can never be more certain than the evidence beneath it.
    confidence: support ? read.confidence : "low",
    actor: "scout.research",
  };
}

/** Audit for a suggestion. A suggestion is a proposal, never approved work. */
export function auditForSuggested(
  move: { statement: string; because: string },
  observed: ScoutSignal[],
): EvidenceAudit {
  const support = supportingSignal(move.because, undefined, observed);
  const url = support?.sourceUrl;
  return {
    ...(url ? { url } : {}),
    title: url ? titleFromUrl(url) : "Proposed by Scout",
    kind: "computed",
    observedAt: support?.provenance.observedAt ?? null,
    snippet: clip(move.because),
    confidence: "unknown",
    actor: "scout.research",
  };
}
