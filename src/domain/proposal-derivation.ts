/**
 * Turning an approved roadmap version into a proposal that can be reviewed.
 *
 * Roadmap owns the strategy. Comms owns the reviewed expression. This module
 * is the join between them: it derives the proposal from exactly one frozen
 * roadmap version, and keeps the thread back to it visible line by line.
 *
 * What it refuses to do:
 *
 * - price or date anything without a real estimate and a real capacity check
 * - add up amounts in different currencies, or treat an unknown one as zero
 * - overwrite what a person typed when the roadmap moves underneath them
 */

import { priceProposal, type ProposalArithmetic, type ProposalLine } from "./comms-proposal";
import type { ID, ISODateTime } from "./entities";
import type { RoadmapChange, RoadmapVersion } from "./roadmap-preparation";

export interface DerivedLine {
  text: string;
  /** Where this came from: the roadmap version and the phase inside it. */
  fromVersionId: string;
  fromPhaseId: string | null;
  /** True once a person has rewritten it. Never replaced by a later derive. */
  editedByPerson: boolean;
}

export interface ProposalPricing {
  currency: string | null;
  lines: ProposalLine[];
  /** Named when amounts arrive in more than one currency. Never added up. */
  mixedCurrencies: string[];
  arithmetic: ProposalArithmetic | null;
  /** Said plainly when a figure is missing, so nobody reads it as nothing. */
  unknownAmounts: string[];
}

export interface DerivedProposal {
  organizationId: ID;
  clientRef: string;
  fromVersionId: string;
  fromVersionStamp: string;
  scope: DerivedLine[];
  exclusions: DerivedLine[];
  deliverables: DerivedLine[];
  acceptanceCriteria: DerivedLine[];
  assumptions: DerivedLine[];
  responsibilities: DerivedLine[];
  pricing: ProposalPricing;
  nextSteps: DerivedLine[];
  /** Set when the roadmap has moved since this was derived. */
  staleBecause: RoadmapChange[];
  derivedAt: ISODateTime;
}

/* ------------------------------------------------- estimates and capacity */

export interface PhaseEstimate {
  phaseId: string;
  /** Effort in days, as recorded by a person. Never invented here. */
  days: number;
  currency?: string;
  /** Amount as typed, in the currency above. Blank means not priced yet. */
  amount?: string;
  recordedBy: ID;
}

export interface CapacityCheck {
  phaseId: string;
  /** A real recorded check against real availability. */
  checkedBy: ID;
  checkedAt: ISODateTime;
  canStartFrom: ISODateTime | null;
  note: string;
}

export interface ReadinessOutcome {
  ready: boolean;
  /** What is missing before dates or prices can be approved. */
  missing: string[];
}

/**
 * Dates and prices can only be approved once every phase carries both an
 * estimate and a capacity check. Availability is never assumed.
 */
export function quoteReadiness(input: {
  version: RoadmapVersion;
  estimates: PhaseEstimate[];
  capacity: CapacityCheck[];
}): ReadinessOutcome {
  const missing: string[] = [];
  for (const phase of input.version.roadmap.phases) {
    const estimate = input.estimates.find((entry) => entry.phaseId === phase.id);
    if (!estimate || !estimate.recordedBy) {
      missing.push(`No estimate for ${phase.title}.`);
    }
    const check = input.capacity.find((entry) => entry.phaseId === phase.id);
    if (!check || !check.checkedBy) {
      missing.push(`No capacity check for ${phase.title}.`);
    }
  }
  return { ready: missing.length === 0, missing };
}

/* ------------------------------------------------------------- derivation */

function line(text: string, versionId: string, phaseId: string | null): DerivedLine {
  return { text, fromVersionId: versionId, fromPhaseId: phaseId, editedByPerson: false };
}

function buildPricing(version: RoadmapVersion, estimates: PhaseEstimate[]): ProposalPricing {
  const priced = estimates.filter((entry) => (entry.amount ?? "").trim() !== "");
  const currencies = [...new Set(priced.map((entry) => entry.currency ?? "").filter(Boolean))];
  const unknownAmounts = version.roadmap.phases
    .filter((phase) => !priced.some((entry) => entry.phaseId === phase.id))
    .map((phase) => `${phase.title}: amount not recorded yet.`);

  if (currencies.length > 1) {
    return {
      currency: null,
      lines: [],
      mixedCurrencies: currencies,
      arithmetic: null,
      unknownAmounts,
    };
  }

  const currency = currencies[0] ?? null;
  const lines: ProposalLine[] = version.roadmap.phases.map((phase) => {
    const estimate = priced.find((entry) => entry.phaseId === phase.id);
    return {
      label: phase.title,
      quantity: estimate ? "1" : "",
      unitPrice: estimate?.amount ?? "",
    };
  });

  const arithmetic = currency
    ? priceProposal({
        currency,
        scope: "",
        deliverables: [],
        lines,
        assumptions: [],
        nextSteps: [],
        discount: "",
      })
    : null;

  return { currency, lines, mixedCurrencies: [], arithmetic, unknownAmounts };
}

/** Derive a proposal from exactly one approved, frozen roadmap version. */
export function deriveProposal(input: {
  version: RoadmapVersion;
  estimates: PhaseEstimate[];
  at: ISODateTime;
}): DerivedProposal {
  const { version } = input;
  const versionId = version.versionId;
  const roadmap = version.roadmap;
  const ordered = roadmap.approvedOrder
    ? roadmap.approvedOrder
        .map((id) => roadmap.phases.find((phase) => phase.id === id))
        .filter((phase): phase is NonNullable<typeof phase> => Boolean(phase))
    : roadmap.phases.slice().sort((a, b) => a.position - b.position);

  const scope = ordered.map((phase) => line(`${phase.title}: ${phase.intent}`, versionId, phase.id));
  const exclusions = roadmap.unknowns.map((unknown) =>
    line(`Not included until confirmed: ${unknown}`, versionId, null),
  );
  const deliverables = ordered.flatMap((phase) =>
    phase.options
      .filter((option) => phase.dependsOn.length === 0 || true)
      .map((option) => line(`${phase.title}: ${option.label}`, versionId, phase.id)),
  );
  const acceptanceCriteria = ordered.map((phase) =>
    line(`${phase.title} is done when ${phase.intent} is in place and agreed.`, versionId, phase.id),
  );
  const assumptions = ordered
    .flatMap((phase) => phase.dependsOn.map((dependency) => ({ phase, dependency })))
    .map(({ phase, dependency }) =>
      line(`${phase.title} assumes ${dependency} is in place first.`, versionId, phase.id),
    );
  const responsibilities = ordered.map((phase) =>
    line(`${phase.title}: owner to be named before work starts.`, versionId, phase.id),
  );
  const nextSteps = roadmap.firstMove
    ? [line(roadmap.firstMove.statement, versionId, null)]
    : [line("Agree the first move.", versionId, null)];

  return {
    organizationId: roadmap.organizationId,
    clientRef: roadmap.clientRef,
    fromVersionId: versionId,
    fromVersionStamp: version.stamp,
    scope,
    exclusions,
    deliverables,
    acceptanceCriteria,
    assumptions,
    responsibilities,
    pricing: buildPricing(version, input.estimates),
    nextSteps,
    staleBecause: [],
    derivedAt: input.at,
  };
}

/* ------------------------------------------------- changes and invalidation */

const SECTIONS = [
  "scope",
  "exclusions",
  "deliverables",
  "acceptanceCriteria",
  "assumptions",
  "responsibilities",
  "nextSteps",
] as const;

type SectionKey = (typeof SECTIONS)[number];

/** A person rewrites a line. It is theirs from then on. */
export function editLine(
  proposal: DerivedProposal,
  section: SectionKey,
  index: number,
  text: string,
): DerivedProposal {
  const lines = proposal[section].slice();
  const existing = lines[index];
  if (!existing) return proposal;
  lines[index] = { ...existing, text, editedByPerson: true };
  return { ...proposal, [section]: lines };
}

export interface RederiveResult {
  proposal: DerivedProposal;
  /** What moved on the roadmap, in plain words, for the reviewer to read. */
  changes: RoadmapChange[];
  /** Lines a person wrote that the new roadmap no longer matches. */
  keptHumanEdits: string[];
  /** Review readiness is withdrawn whenever the roadmap moves. */
  reviewReadinessWithdrawn: boolean;
}

/**
 * The roadmap moved. Rebuild the derived lines, keep every human edit exactly
 * as written, and show what changed rather than quietly swapping it out.
 */
export function rederiveAgainst(input: {
  proposal: DerivedProposal;
  previousVersion: RoadmapVersion;
  nextVersion: RoadmapVersion;
  estimates: PhaseEstimate[];
  at: ISODateTime;
  changes: RoadmapChange[];
}): RederiveResult {
  const fresh = deriveProposal({
    version: input.nextVersion,
    estimates: input.estimates,
    at: input.at,
  });

  const keptHumanEdits: string[] = [];
  const merged = { ...fresh } as DerivedProposal;

  for (const section of SECTIONS) {
    const edited = input.proposal[section].filter((entry) => entry.editedByPerson);
    const freshLines = fresh[section].slice();
    for (const entry of edited) {
      const slot = freshLines.findIndex(
        (candidate) => candidate.fromPhaseId === entry.fromPhaseId && !candidate.editedByPerson,
      );
      if (slot >= 0) {
        freshLines[slot] = { ...entry, fromVersionId: input.nextVersion.versionId };
      } else {
        freshLines.push({ ...entry, fromVersionId: input.nextVersion.versionId });
      }
      keptHumanEdits.push(entry.text);
    }
    (merged[section] as DerivedLine[]) = freshLines;
  }

  const changes = input.changes.length > 0 ? input.changes : [];
  merged.staleBecause = changes;

  return {
    proposal: merged,
    changes,
    keptHumanEdits,
    reviewReadinessWithdrawn: changes.length > 0,
  };
}

/** A proposal is only ready for review while it matches a frozen version. */
export function proposalReviewReadiness(input: {
  proposal: DerivedProposal;
  currentVersion: RoadmapVersion;
  readiness: ReadinessOutcome;
}): ReadinessOutcome {
  const missing = [...input.readiness.missing];
  if (input.proposal.fromVersionId !== input.currentVersion.versionId) {
    missing.push("The roadmap has a newer approved version than this proposal.");
  }
  if (input.proposal.fromVersionStamp !== input.currentVersion.stamp) {
    missing.push("The roadmap changed after this proposal was written.");
  }
  if (input.proposal.staleBecause.length > 0) {
    missing.push("Read what changed on the roadmap before sending this for review.");
  }
  if (input.proposal.pricing.mixedCurrencies.length > 0) {
    missing.push(
      `Amounts are in more than one currency (${input.proposal.pricing.mixedCurrencies.join(", ")}). They are not added up.`,
    );
  }
  return { ready: missing.length === 0, missing };
}
