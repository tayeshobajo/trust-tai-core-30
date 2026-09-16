/**
 * Whether the business itself is healthy, measured rather than asserted.
 *
 * Pulse already says what deserves attention. This says whether the agency is
 * sustainable: is there qualified pipeline, is it ageing, are proposals sitting
 * undecided, can delivery take more, is money owed, does any margin exist, and
 * is care due.
 *
 * Three laws hold every line here:
 *
 *   - **Unavailable is not zero.** A source that could not be read says so.
 *     It is never drawn as a zero, and it never counts towards a total.
 *   - **Nothing is invented.** No target, no cost, no forecast is made up. A
 *     missing cost means margin is unknown, never profit.
 *   - **Every number can be checked.** Each metric names its source, the
 *     period it covers, its denominator where one applies, when it was read,
 *     and the screen where the underlying records live.
 */

export type MetricReading =
  | {
      state: "measured";
      value: number;
      /** What the value is out of, when a share only means something against a base. */
      denominator?: { value: number; label: string };
    }
  | { state: "unavailable"; because: string };

export interface HealthMetric {
  id: string;
  label: string;
  /** The question a person is actually asking. */
  question: string;
  reading: MetricReading;
  /** How to render the number. */
  unit: "count" | "days" | "money_cents";
  /** Which room or table the number came from. */
  source: string;
  /** The window the number covers, in words. */
  period: string;
  /** When the source was read. Null when it was never read. */
  readAt: string | null;
  /** Where the underlying records are. */
  drilldownHref: string;
  drilldownLabel: string;
  /** Only a target a person set. Never an invented agency target. */
  target: number | null;
  /** Why there is no target, when there is none. */
  targetBecause?: string;
}

export function measured(value: number, denominator?: { value: number; label: string }): MetricReading {
  return denominator ? { state: "measured", value, denominator } : { state: "measured", value };
}

export function unavailable(because: string): MetricReading {
  return { state: "unavailable", because };
}

/** Every metric that could not be read, so the page can say so once, plainly. */
export function unavailableMetrics(metrics: HealthMetric[]): HealthMetric[] {
  return metrics.filter((metric) => metric.reading.state === "unavailable");
}

/* ------------------------------------------------------------------ margin */

/**
 * Margin only exists where a cost was recorded. A missing cost is not a zero
 * cost, and the difference is the difference between an honest unknown and a
 * fabricated profit.
 */
export function marginReading(input: {
  revenueCents: number | null;
  costCents: number | null;
}): MetricReading {
  if (input.revenueCents === null) return unavailable("No recorded revenue to measure against.");
  if (input.costCents === null) {
    return unavailable("No cost is recorded, so margin is unknown. Unknown cost is not zero cost.");
  }
  return measured(input.revenueCents - input.costCents, {
    value: input.revenueCents,
    label: "recorded revenue",
  });
}

/* ------------------------------------------------------------ stalled work */

export interface StalledCandidate {
  id: string;
  label: string;
  /** Where the work lives. */
  href: string;
  /** Named person, or null when nobody is recorded. */
  owner: string | null;
  /** When the work last moved. Null when nothing is recorded. */
  lastMovedAt: string | null;
  /** Days with no movement before this counts as stalled. */
  stallAfterDays: number;
  /** The practical move, written by the room that owns the work. */
  nextAction: string | null;
  /**
   * True only where somebody owes the client an answer. Silence from a client
   * is not a problem on its own, so a quiet client never becomes a risk here.
   */
  weOweAReply: boolean;
}

export interface StalledItem {
  id: string;
  label: string;
  href: string;
  /** Always a sentence a person can act on. */
  nextAction: string;
  /** A name, or the exception text when nobody owns it. */
  owner: string;
  ownerMissing: boolean;
  days: number;
}

export const NO_OWNER = "Needs an owner";

export function stalledWork(input: { candidates: StalledCandidate[]; now: Date }): StalledItem[] {
  const items: StalledItem[] = [];
  for (const candidate of input.candidates) {
    if (!candidate.lastMovedAt) continue;
    const moved = new Date(candidate.lastMovedAt);
    if (Number.isNaN(moved.getTime())) continue;
    const days = Math.floor((input.now.getTime() - moved.getTime()) / 86_400_000);
    if (days < candidate.stallAfterDays) continue;
    /* Waiting on the client is only stalled work when we owe them something. */
    if (!candidate.weOweAReply && candidate.nextAction === null) continue;
    items.push({
      id: candidate.id,
      label: candidate.label,
      href: candidate.href,
      nextAction: candidate.nextAction ?? "Reply to the client, or record why no reply is owed.",
      owner: candidate.owner ?? NO_OWNER,
      ownerMissing: candidate.owner === null,
      days,
    });
  }
  return items.sort((a, b) => b.days - a.days);
}

/* ---------------------------------------------------------------- growth */

export interface GrowthInput {
  clientId: string;
  /** Reviewed outcomes a person recorded for this client. */
  evidence: { label: string; href: string }[];
  /** Any complaint or service failure still open on this account. */
  unresolvedComplaints: number;
}

export type GrowthSuggestion =
  | { allowed: true; clientId: string; because: string; evidence: { label: string; href: string }[] }
  | { allowed: false; clientId: string; because: string };

/**
 * A growth conversation needs a result behind it, and never happens over the
 * top of an unresolved complaint.
 */
export function growthSuggestion(input: GrowthInput): GrowthSuggestion {
  if (input.unresolvedComplaints > 0) {
    return {
      allowed: false,
      clientId: input.clientId,
      because: "There is an unresolved complaint. Fix the service before suggesting more work.",
    };
  }
  if (input.evidence.length === 0) {
    return {
      allowed: false,
      clientId: input.clientId,
      because: "No reviewed outcome is recorded, so there is nothing to build a case on.",
    };
  }
  return {
    allowed: true,
    clientId: input.clientId,
    because: `${input.evidence.length} recorded outcome${
      input.evidence.length === 1 ? "" : "s"
    } support a growth conversation.`,
    evidence: input.evidence,
  };
}
