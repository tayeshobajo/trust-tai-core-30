/**
 * Website room projections.
 *
 * Pure functions over real rows. The rule throughout: a number Core cannot
 * observe is `null`, never 0. An empty funnel stage and an unmeasured one are
 * different truths and the room says which is which.
 */

import type {
  KnownNumber,
  WebsiteEvent,
  WebsiteFunnelStage,
  WebsiteQuestionDropOff,
  WebsiteSourceRow,
  WebsiteSubmission,
} from "@/domain/website";

/** Scout statuses that mean a person has qualified the inbound company. */
const QUALIFIED = new Set(["qualified", "ready_for_comms", "converted"]);

export function isQualified(status: string | null | undefined): boolean {
  return QUALIFIED.has((status ?? "").trim().toLowerCase());
}

function countOf(events: WebsiteEvent[], name: WebsiteEvent["eventName"]): number {
  return events.filter((event) => event.eventName === name).length;
}

function sessions(events: WebsiteEvent[], name: WebsiteEvent["eventName"]): number {
  return new Set(
    events.filter((e) => e.eventName === name).map((e) => e.sessionId ?? e.eventKey),
  ).size;
}

/** Where traffic landed. Empty when no page views were ever received. */
export function topPaths(events: WebsiteEvent[], limit = 6): { path: string; views: number }[] {
  const tally = new Map<string, number>();
  for (const event of events) {
    if (event.eventName !== "page_view") continue;
    const path = event.path?.trim() || "/";
    tally.set(path, (tally.get(path) ?? 0) + 1);
  }
  return [...tally.entries()]
    .map(([path, views]) => ({ path, views }))
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);
}

export function topReferrers(
  events: WebsiteEvent[],
  limit = 6,
): { referrer: string; visits: number }[] {
  const tally = new Map<string, number>();
  for (const event of events) {
    if (event.eventName !== "page_view") continue;
    const utmSource = event.utm?.source?.trim();
    const label = utmSource || hostOf(event.referrer) || "Direct";
    tally.set(label, (tally.get(label) ?? 0) + 1);
  }
  return [...tally.entries()]
    .map(([referrer, visits]) => ({ referrer, visits }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, limit);
}

export function deviceSplit(events: WebsiteEvent[]): { device: string; visits: number }[] {
  const tally = new Map<string, number>();
  for (const event of events) {
    if (event.eventName !== "page_view") continue;
    const device = event.device?.trim();
    if (!device) continue;
    tally.set(device, (tally.get(device) ?? 0) + 1);
  }
  return [...tally.entries()]
    .map(([device, visits]) => ({ device, visits }))
    .sort((a, b) => b.visits - a.visits);
}

function hostOf(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * The intake funnel. Event-derived stages are `null` while no events have
 * ever been received, because "we cannot see it" is not "it did not happen".
 * Submissions and qualification are always known: Core holds those rows.
 */
export function intakeFunnel(
  events: WebsiteEvent[],
  submissions: WebsiteSubmission[],
): WebsiteFunnelStage[] {
  const measured = events.length > 0;
  const known = (value: number): KnownNumber => (measured ? value : null);

  return [
    {
      key: "intake_view",
      label: "Saw the intake",
      value: known(sessions(events, "intake_view")),
      ...(measured ? {} : { note: "No website events received yet." }),
    },
    { key: "intake_started", label: "Started", value: known(sessions(events, "intake_started")) },
    {
      key: "progress",
      label: "Made meaningful progress",
      value: known(
        new Set(
          events
            .filter((event) => event.eventName === "intake_answered")
            .map((event) => event.sessionId ?? event.eventKey),
        ).size,
      ),
      ...(measured ? { note: "Sessions that answered at least one question." } : {}),
    },
    { key: "submitted", label: "Submitted", value: submissions.length },
    {
      key: "qualified",
      label: "Qualified in Scout",
      value: submissions.filter((submission) => isQualified(submission.scoutStatus)).length,
      note: "Scout owns this decision; the Website room only reads it.",
    },
  ];
}

/** Text vs voice, and resume usage. Null when the events never arrived. */
export function modalityUsage(events: WebsiteEvent[]): {
  text: KnownNumber;
  voice: KnownNumber;
  resumed: KnownNumber;
} {
  const answered = events.filter((event) => event.eventName === "intake_answered");
  if (answered.length === 0 && countOf(events, "intake_resumed") === 0) {
    return { text: null, voice: null, resumed: null };
  }
  return {
    text: answered.filter((event) => event.modality === "text").length,
    voice: answered.filter((event) => event.modality === "voice").length,
    resumed: countOf(events, "intake_resumed"),
  };
}

/** Per-question abandonment, only where question-level events exist. */
export function questionDropOff(events: WebsiteEvent[]): WebsiteQuestionDropOff[] {
  const byQuestion = new Map<string, { reached: number; answered: number; text: string }>();
  for (const event of events) {
    if (!event.questionId) continue;
    if (event.eventName !== "intake_answered" && event.eventName !== "intake_abandoned") continue;
    const entry = byQuestion.get(event.questionId) ?? {
      reached: 0,
      answered: 0,
      text: String(event.properties["question_text"] ?? event.questionId),
    };
    entry.reached += 1;
    if (event.eventName === "intake_answered") entry.answered += 1;
    byQuestion.set(event.questionId, entry);
  }
  return [...byQuestion.entries()]
    .map(([questionId, entry]) => ({
      questionId,
      questionText: entry.text,
      reached: entry.reached,
      answered: entry.answered,
      abandoned: entry.reached - entry.answered,
    }))
    .sort((a, b) => b.abandoned - a.abandoned);
}

/**
 * Source → qualified. Submissions carry their own attribution, so those
 * columns are always real. Visits and starts stay null until events arrive.
 */
export function sourceToQualified(
  events: WebsiteEvent[],
  submissions: WebsiteSubmission[],
): WebsiteSourceRow[] {
  const measured = events.length > 0;
  const rows = new Map<string, WebsiteSourceRow>();

  const key = (source: string, campaign: string | null) => `${source}|${campaign ?? ""}`;
  const ensure = (source: string, campaign: string | null): WebsiteSourceRow => {
    const id = key(source, campaign);
    const existing = rows.get(id);
    if (existing) return existing;
    const created: WebsiteSourceRow = {
      source,
      campaign,
      visits: measured ? 0 : null,
      starts: measured ? 0 : null,
      submissions: 0,
      qualified: 0,
    };
    rows.set(id, created);
    return created;
  };

  for (const event of events) {
    if (event.eventName !== "page_view" && event.eventName !== "intake_started") continue;
    const source = event.utm?.source?.trim() || hostOf(event.referrer) || "Direct";
    const campaign = event.utm?.campaign?.trim() || null;
    const row = ensure(source, campaign);
    if (event.eventName === "page_view") row.visits = (row.visits ?? 0) + 1;
    else row.starts = (row.starts ?? 0) + 1;
  }

  for (const submission of submissions) {
    const utm = submission.attribution.utm ?? {};
    const source =
      utm.source?.trim() || hostOf(submission.attribution.entryReferrer) || "Direct";
    const campaign = utm.campaign?.trim() || null;
    const row = ensure(source, campaign);
    row.submissions = (row.submissions ?? 0) + 1;
    if (isQualified(submission.scoutStatus)) row.qualified = (row.qualified ?? 0) + 1;
  }

  return [...rows.values()].sort(
    (a, b) => (b.submissions ?? 0) - (a.submissions ?? 0) || (b.visits ?? 0) - (a.visits ?? 0),
  );
}

/** Hero metrics. Unknown stays unknown. */
export function websiteHeadline(
  events: WebsiteEvent[],
  submissions: WebsiteSubmission[],
): { visits: KnownNumber; submissions: number; awaitingReview: number; qualified: number } {
  return {
    visits: events.length > 0 ? sessions(events, "page_view") : null,
    submissions: submissions.length,
    awaitingReview: submissions.filter((submission) => submission.linkState === "unlinked").length,
    qualified: submissions.filter((submission) => isQualified(submission.scoutStatus)).length,
  };
}

export function formatKnown(value: KnownNumber): string {
  return value === null ? "—" : String(value);
}
