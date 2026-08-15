/**
 * The engine loop, composed.
 *
 * Observe → understand → remember → judge → reason → verify → recommend.
 * Everything here is pure over a snapshot plus whatever the workspace has
 * already learned, so the same inputs always produce the same read. The model
 * stage is optional by design: with no reasoned hypotheses supplied the engine
 * degrades to its deterministic readings and says so, rather than going blank
 * or inventing something to fill the space.
 */

import {
  engineHeadline,
  MAX_HYPOTHESES,
  type EngineRead,
  type Hypothesis,
  type Observation,
  type Recommendation,
} from "@/domain/intelligence-engine";

import type { SuiteSnapshot } from "../derive";
import { buildEvidencePacket, deriveHypotheses } from "./hypothesise";
import { observeBusiness } from "./observe";
import { deriveRecommendations } from "./recommend";
import { contradicts } from "./verify";

export * from "./observe";
export * from "./hypothesise";
export * from "./verify";
export * from "./recommend";
export * from "./propose";
export * from "./learn";
export * from "./runs";
export * from "./audit";


export interface EngineOptions {
  /** Hypotheses a model produced, already verified against the packet. */
  reasoned?: Hypothesis[];
  /** Pattern keys a person has told the engine to stop raising. */
  suppressed?: string[];
  /** Pattern keys a person accepted before. Ordering only. */
  favoured?: string[];
  /** Statements a person decided. Inference never overrides these. */
  decided?: string[];
}

const CONFIDENCE_RANK = { unknown: 0, low: 1, moderate: 2, high: 3 } as const;

/** One complete read of the business. Honest when there is nothing to say. */
export function engineRead(snapshot: SuiteSnapshot, options: EngineOptions = {}): EngineRead {
  const now = snapshot.now;
  const suppressed = options.suppressed ?? [];
  const decided = options.decided ?? [];

  const observations = observeBusiness(snapshot);
  const derived = deriveHypotheses(observations, now).filter(
    (hypothesis) => !suppressed.includes(hypothesis.patternKey),
  );

  /* A person's decision outranks anything the engine worked out. */
  const surviving = derived.filter(
    (hypothesis) => !decided.some((statement) => contradicts(hypothesis.claim, statement)),
  );

  const reasoned = (options.reasoned ?? []).filter(
    (hypothesis) => !suppressed.includes(hypothesis.patternKey),
  );

  const hypotheses: Hypothesis[] = dedupe([...surviving, ...reasoned])
    .sort(
      (a, b) =>
        CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] ||
        b.observationRefs.length - a.observationRefs.length ||
        a.id.localeCompare(b.id),
    )
    .slice(0, MAX_HYPOTHESES);

  const recommendations: Recommendation[] = deriveRecommendations({
    hypotheses,
    observations,
    now,
    suppressed,
    ...(options.favoured ? { favoured: options.favoured } : {}),
  });

  return {
    organizationId: snapshot.organizationId,
    headline: engineHeadline(recommendations.length),
    observations,
    hypotheses,
    recommendations,
    withheld: snapshot.withheld.map((row) => ({ appId: row.appId, reason: row.reason })),
    suppressed,
    favoured: options.favoured ?? [],
    decided,
    reasoned: reasoned.length > 0,
    generatedAt: now,
  };
}

function dedupe(rows: Hypothesis[]): Hypothesis[] {
  const seen = new Set<string>();
  const out: Hypothesis[] = [];
  for (const row of rows) {
    const key = row.claim.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/** The packet a model may reason over, and nothing beyond it. */
export function packetFor(snapshot: SuiteSnapshot, options: EngineOptions = {}) {
  const observations: Observation[] = observeBusiness(snapshot);
  return buildEvidencePacket({
    organizationId: snapshot.organizationId,
    now: snapshot.now,
    observations,
    derived: deriveHypotheses(observations, snapshot.now),
    ...(options.decided ? { decided: options.decided } : {}),
    ...(options.suppressed ? { suppressed: options.suppressed } : {}),
    withheld: snapshot.withheld.map((row) => ({ appId: row.appId, reason: row.reason })),
  });
}

/**
 * Fold verified model readings into a read that was already taken.
 *
 * Used by the workspace so reasoning does not cost a second pass over the
 * suite: the deterministic read arrives first and is shown, and this replaces
 * it once the model stage returns. Pure, and safe to call with nothing.
 */
export function withReasoning(read: EngineRead, reasoned: Hypothesis[]): EngineRead {
  const additions = reasoned.filter(
    (hypothesis) => !read.suppressed.includes(hypothesis.patternKey),
  );
  if (additions.length === 0) return read;

  const hypotheses = dedupe([...read.hypotheses, ...additions])
    .sort(
      (a, b) =>
        CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] ||
        b.observationRefs.length - a.observationRefs.length ||
        a.id.localeCompare(b.id),
    )
    .slice(0, MAX_HYPOTHESES);

  const recommendations = deriveRecommendations({
    hypotheses,
    observations: read.observations,
    now: read.generatedAt,
    suppressed: read.suppressed,
    ...(read.favoured.length > 0 ? { favoured: read.favoured } : {}),
  });

  return {
    ...read,
    hypotheses,
    recommendations,
    headline: engineHeadline(recommendations.length),
    reasoned: true,
  };
}
