/**
 * Studio's opportunity read.
 *
 * One read per subject (Canon 27), composed over what the Website room already
 * observed (Canon 28). Pure: no fetching, no model call, no writes, no store.
 *
 * The truth law is applied by the shared contract, not restated here:
 *  - observed metrics enter as `observed` claims with their own window
 *  - intent, coverage judgment and the recommended action enter as `inferred`
 *  - a recorded human decision enters as a `decided` claim and therefore wins
 *  - competing pages stay visible as conflicts, never resolved away
 *  - an unread provider is `withheld`, and thin data is named, not smoothed
 *
 * Nothing here is consumed by a Studio surface yet, so no visible behaviour
 * changes in this pass.
 */

import {
  composeIntelligenceRead,
  type IntelligenceRead,
  type ReadClaim,
  type ReadSourceRef,
} from "@/domain/intelligence-read";
import {
  OPEN_DECISION,
  applyDecisions,
  opportunityId,
  type OpportunityAction,
  type OpportunityConfidence,
  type OpportunityConflict,
  type OpportunityDecision,
  type OpportunityEvidence,
  type OpportunitySubject,
  type StudioOpportunity,
} from "@/domain/content-opportunity";
import type { ContentDemandReading, ContentDemandSignal } from "@/data/website/content-demand";

export const STUDIO_ROOM = "studio";

const SEARCH_SOURCE: ReadSourceRef = { label: "Search Console", appId: "website" };
const INVENTORY_SOURCE: ReadSourceRef = { label: "Website page inventory", appId: "website" };

export interface OpportunityReadInput {
  organizationId: string;
  demand: ContentDemandReading;
  asOf: string;
  /** Recorded human decisions, keyed by opportunity id. They win. */
  decisions?: Record<string, OpportunityDecision>;
  /** Sources that could not be read at all. Unknown, never zero. */
  withheld?: { appId: string; reason: string }[];
}

/* ------------------------------------------------------- the opportunity */

function confidenceOf(signal: ContentDemandSignal): OpportunityConfidence {
  if (signal.thin) return "thin";
  return signal.coverage.inInventory === null ? "supported" : "observed";
}

function recommend(signal: ContentDemandSignal): {
  action: OpportunityAction;
  rationale: string;
  alternatives: { action: OpportunityAction; because: string }[];
} {
  if (signal.thin) {
    return {
      action: "no_action",
      rationale: "There is not enough observed demand behind this phrase to act on it yet.",
      alternatives: [],
    };
  }
  if (signal.competing.length > 1) {
    return {
      action: "internal_link",
      rationale:
        "More than one of our own pages shows for this phrase, so the pages need to agree before another one is written.",
      alternatives: [
        { action: "update_existing", because: "One page could be made the clear answer instead." },
      ],
    };
  }
  if (signal.coverage.inInventory === true && signal.weakCtr) {
    return {
      action: "update_existing",
      rationale:
        "A page already shows for this phrase and is rarely clicked, so it is the page that needs work, not the topic.",
      alternatives: [
        { action: "new_post", because: "Only if the page answers a genuinely different question." },
      ],
    };
  }
  if (signal.coverage.inInventory === true && signal.strikingDistance) {
    return {
      action: "update_existing",
      rationale:
        "A page of ours already sits close behind on this phrase, so improving it moves further than starting again.",
      alternatives: [{ action: "internal_link", because: "Supporting links may be enough." }],
    };
  }
  if (signal.coverage.inInventory === false || signal.coverage.path === null) {
    return {
      action: "new_post",
      rationale: "People are arriving with this language and nothing in the inventory answers it.",
      alternatives: [
        { action: "faq", because: "A plain answer may serve the reader better than an article." },
      ],
    };
  }
  return {
    action: "no_action",
    rationale: "Coverage for this phrase cannot be judged without the page inventory.",
    alternatives: [],
  };
}

function conflictsOf(signal: ContentDemandSignal): OpportunityConflict[] {
  if (signal.competing.length <= 1) return [];
  return [
    {
      kind: "competing_pages",
      detail: `${signal.competing.length} of our own pages show for "${signal.query}".`,
      paths: signal.competing.map((entry) => entry.path),
    },
  ];
}

function evidenceOf(signal: ContentDemandSignal): OpportunityEvidence[] {
  const refs: OpportunityEvidence[] = [
    {
      ref: `search:${signal.query}`,
      label: `Search Console rows for "${signal.query}"`,
      sourceLabel: "Search Console",
      ...(signal.window.end ? { at: signal.window.end } : {}),
    },
  ];
  if (signal.coverage.path && signal.coverage.inInventory !== null) {
    refs.push({
      ref: `page:${signal.coverage.path}`,
      label: signal.coverage.title ?? signal.coverage.path,
      sourceLabel: "Website page inventory",
    });
  }
  return refs;
}

/** Derive one opportunity per observed phrase. Pure and deterministic. */
export function deriveOpportunities(input: OpportunityReadInput): StudioOpportunity[] {
  const derived = input.demand.signals.map((signal) => {
    const subject: OpportunitySubject = {
      kind: "query_cluster",
      key: signal.query,
      label: signal.query,
    };
    const { action, rationale, alternatives } = recommend(signal);
    return {
      id: opportunityId(subject, signal.window.start),
      organizationId: input.organizationId,
      subject,
      audienceLanguage: [signal.query],
      observed: {
        impressions: signal.window.read ? signal.impressions : null,
        clicks: signal.window.read ? signal.clicks : null,
        ctr: signal.window.read ? signal.ctr : null,
        averagePosition: signal.window.read ? signal.averagePosition : null,
        change: signal.change,
        window: {
          start: signal.window.start,
          end: signal.window.end,
          daysWithData: signal.window.daysWithData,
          read: signal.window.read,
        },
        paths: signal.competing.length
          ? signal.competing
          : signal.coverage.path
            ? [{ path: signal.coverage.path, impressions: signal.impressions }]
            : [],
      },
      intent: null,
      action,
      rationale,
      alternatives,
      conflicts: conflictsOf(signal),
      confidence: confidenceOf(signal),
      because: [...signal.thinBecause, ...input.demand.because],
      evidence: evidenceOf(signal),
      decision: OPEN_DECISION,
    } satisfies StudioOpportunity;
  });

  return applyDecisions(derived, input.decisions ?? {});
}

/* --------------------------------------------------------------- the read */

/** One `IntelligenceRead` for one opportunity. Claims carry their own tier. */
export function composeOpportunityRead(
  organizationId: string,
  opportunity: StudioOpportunity,
  asOf: string,
  withheld: { appId: string; reason: string }[] = [],
): IntelligenceRead {
  const observedAt = opportunity.observed.window.end ?? asOf;
  const claims: ReadClaim[] = [];

  if (opportunity.observed.impressions !== null) {
    claims.push({
      id: `${opportunity.id}:demand`,
      aspect: "demand",
      statement: `"${opportunity.subject.label}" was seen ${opportunity.observed.impressions} time${
        opportunity.observed.impressions === 1 ? "" : "s"
      } and clicked ${opportunity.observed.clicks ?? 0} time${
        opportunity.observed.clicks === 1 ? "" : "s"
      }.`,
      tier: "observed",
      origin: "observed",
      at: observedAt,
      evidenceRefs: opportunity.evidence.map((entry) => entry.ref),
      sources: [SEARCH_SOURCE],
    });
  }

  if (opportunity.observed.averagePosition !== null) {
    claims.push({
      id: `${opportunity.id}:position`,
      aspect: "position",
      statement: `Average position ${opportunity.observed.averagePosition.toFixed(1)} over the observed window.`,
      tier: "observed",
      origin: "observed",
      at: observedAt,
      evidenceRefs: [`search:${opportunity.subject.key}`],
      sources: [SEARCH_SOURCE],
    });
  }

  for (const conflict of opportunity.conflicts) {
    claims.push({
      id: `${opportunity.id}:coverage:observed`,
      aspect: "coverage",
      statement: conflict.detail,
      tier: "observed",
      origin: "observed",
      at: observedAt,
      evidenceRefs: conflict.paths.map((path) => `page:${path}`),
      sources: [INVENTORY_SOURCE],
    });
    claims.push({
      id: `${opportunity.id}:coverage:inferred`,
      aspect: "coverage",
      statement: "One page should be the clear answer to this phrase.",
      tier: "inferred",
      origin: "deterministic",
      at: asOf,
      evidenceRefs: conflict.paths.map((path) => `page:${path}`),
      sources: [INVENTORY_SOURCE],
      because: "Two of our own pages sharing a phrase split the same demand.",
    });
  }

  claims.push({
    id: `${opportunity.id}:action:inferred`,
    aspect: "action",
    statement: opportunity.rationale,
    tier: "inferred",
    origin: "deterministic",
    at: asOf,
    evidenceRefs: opportunity.evidence.map((entry) => entry.ref),
    sources: [SEARCH_SOURCE],
    because: "Derived from observed demand and the page inventory, with no model consulted.",
  });

  if (opportunity.decision.state !== "open") {
    claims.push({
      id: `${opportunity.id}:action:decided`,
      aspect: "action",
      statement:
        opportunity.decision.note?.trim() ||
        `A person set this opportunity to ${opportunity.decision.state.replace("_", " ")}.`,
      tier: "decided",
      origin: "human",
      at: opportunity.decision.decidedAt ?? asOf,
      evidenceRefs: [],
      sources: [{ label: "Studio decision", appId: STUDIO_ROOM }],
    });
  }

  const unknowns: string[] = [];
  if (!opportunity.observed.window.read) {
    unknowns.push("Search has not been read for this window, so demand is unknown, not zero.");
  }
  if (opportunity.confidence === "thin") {
    unknowns.push(...opportunity.because);
  }
  if (opportunity.intent === null) {
    unknowns.push("Reader intent has not been interpreted for this phrase.");
  }

  return composeIntelligenceRead({
    organizationId,
    room: STUDIO_ROOM,
    subject: {
      type: "content_opportunity",
      label: opportunity.subject.label,
      key: opportunity.subject.key,
    },
    asOf,
    claims,
    unknowns,
    withheld,
    capabilities: {
      executable: [],
      unavailable: [
        { operation: "draft", because: "A brief has to be approved by a person first." },
        { operation: "publish", because: "Publishing stays behind the existing approval gate." },
      ],
      externalSurfaces: [],
      readOnly: true,
    },
  });
}

/** Every opportunity in the reading, each with its own read. */
export function composeOpportunityReads(input: OpportunityReadInput): {
  opportunities: StudioOpportunity[];
  reads: IntelligenceRead[];
} {
  const withheld = [...(input.withheld ?? [])];
  if (!input.demand.window.read) {
    withheld.push({
      appId: "website",
      reason: "Search Console returned no rows for this window, so demand could not be read.",
    });
  }
  const opportunities = deriveOpportunities(input);
  return {
    opportunities,
    reads: opportunities.map((opportunity) =>
      composeOpportunityRead(input.organizationId, opportunity, input.asOf, withheld),
    ),
  };
}
