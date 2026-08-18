/**
 * Judgment: what deserves this person's attention now.
 *
 * Pure functions over canonical truth other rooms already own, commitments,
 * projects, relationships and Ops activity. Nothing here writes, nothing
 * invents an owner, a date or a completion, and nothing scores a human.
 *
 * The engine's job is mostly refusal. Most open work does not earn an
 * interruption, and "nothing needs you right now" is a correct answer that has
 * to be reachable.
 */

import { dueState, isActive, type Relationship } from "@/domain/comms";
import type { EvidenceRef } from "@/domain/confidence";
import type { OpsEvent } from "@/domain/ops";
import { OPS_CLEARING_EVENTS, OPS_CLEARS, OPS_RISK_EVENTS } from "@/domain/ops";
import { isOpenProject, recommendedMove, type ExecutionProject } from "@/domain/projects";
import type { TruthTier } from "@/domain/signals";
import { personKeyOf, type Commitment } from "@/domain/steward";
import {
  ACTIONABLE_STATES,
  AT_RISK_WINDOW_DAYS,
  judgmentHeadline,
  MAX_ATTENTION_ITEMS,
  MAX_WAITING_ITEMS,
  STATE_STRENGTH,
  WAITING_FOLLOW_UP_DAYS,
  type AttentionItem,
  type JudgmentRead,
  type JudgmentState,
  type WatchNote,
} from "@/domain/steward-judgment";
import { patternKeyOf, type MemoryBelief } from "@/domain/steward-memory";

const DAY = 86_400_000;

/* ------------------------------------------------------------------ input */

export interface JudgmentViewer {
  /** Lowercased email when known, otherwise the normalized name. */
  personKey: string;
  name: string;
  userId?: string;
}

export interface JudgmentInput {
  organizationId: string;
  now: string;
  viewer: JudgmentViewer;
  commitments: Commitment[];
  projects?: ExecutionProject[];
  relationships?: Relationship[];
  /** Ops rows already parsed through `readOpsEvents`. */
  opsEvents?: OpsEvent[];
  /** Memory, used only to respect decisions people already made. */
  memory?: MemoryBelief[];
  /** Shapes of reading a person has repeatedly dismissed as context. */
  suppressedPatternKeys?: string[];
}

/* ---------------------------------------------------------------- helpers */

function days(from: string | undefined, to: string): number {
  if (!from) return 0;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / DAY);
}

function computed(label: string): EvidenceRef {
  return { label, kind: "computed" };
}

function human(label: string): EvidenceRef {
  return { label, kind: "human" };
}

function nameKey(name: string | undefined | null): string {
  return personKeyOf({ name: name ?? "" });
}

/** True when the viewer is the person this record names. */
function isViewer(viewer: JudgmentViewer, input: { email?: string; name?: string; userId?: string }): boolean {
  if (input.userId && viewer.userId && input.userId === viewer.userId) return true;
  const email = (input.email ?? "").trim().toLowerCase();
  if (email && email === viewer.personKey) return true;
  const key = nameKey(input.name);
  if (!key) return false;
  if (key === viewer.personKey) return true;
  const viewerName = nameKey(viewer.name);
  if (!viewerName) return false;
  if (key === viewerName) return true;
  /* Forgiving first-name match, the same law Memory already uses. */
  const first = viewerName.split(" ")[0] ?? "";
  return first.length > 2 && key === first;
}

function subjectOf(statement: string): string {
  return statement.trim().toLowerCase().slice(0, 80);
}

function patternFor(
  relation: "carries" | "depends_on" | "hands_off_to",
  personKey: string,
  subject: string,
): string {
  return patternKeyOf({ relation, personKey, subject: subjectOf(subject) });
}

/** Ordering only: state first, then the oldest change, then id. Deterministic. */
function orderOf(state: JudgmentState, changedAt: string | undefined, now: string): number {
  const age = Math.max(0, days(changedAt, now));
  return STATE_STRENGTH[state] * 1000 + Math.min(999, age);
}

/* -------------------------------------------------- decisions people made */

const CLOSED_OUTCOMES = new Set(["marked_kept", "released", "belief_retired"]);

/**
 * Commitments a person has already settled through Memory. A human decision
 * always outranks a stale reading, so these never resurface as attention.
 */
export function decidedClosures(memory: MemoryBelief[]): Set<string> {
  const closed = new Set<string>();
  for (const belief of memory) {
    if (belief.authority !== "human") continue;
    const commitmentId = belief.meta.commitmentId;
    if (!commitmentId) continue;
    if (belief.meta.retired === true || CLOSED_OUTCOMES.has(belief.meta.outcome ?? "")) {
      closed.add(commitmentId);
    }
  }
  return closed;
}

/* -------------------------------------------------------------- ops reads */

interface OpsChainRead {
  chainKey: string;
  projectId?: string;
  cleared: OpsEvent;
  risk: OpsEvent;
}

/**
 * Chains where a recorded blocker was cleared by a later Ops event. This is
 * observed state, not a guess: both rows exist in the shared activity table.
 */
export function clearedOpsChains(events: OpsEvent[], now: string): OpsChainRead[] {
  const byChain = new Map<string, OpsEvent[]>();
  for (const event of events) {
    const list = byChain.get(event.chainKey) ?? [];
    list.push(event);
    byChain.set(event.chainKey, list);
  }

  const reads: OpsChainRead[] = [];
  for (const [chainKey, list] of byChain) {
    const ordered = [...list].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    const latest = ordered[ordered.length - 1];
    if (!latest || !OPS_CLEARING_EVENTS.includes(latest.name)) continue;
    /* Only a genuinely recent change counts as "newly". */
    if (days(latest.at, now) > WAITING_FOLLOW_UP_DAYS) continue;

    const clears = OPS_CLEARS[latest.name] ?? [];
    const risk = [...ordered]
      .reverse()
      .find(
        (event) =>
          event !== latest && OPS_RISK_EVENTS.includes(event.name) && clears.includes(event.name),
      );
    if (!risk) continue;
    reads.push({
      chainKey,
      ...(latest.canonicalProjectId ? { projectId: latest.canonicalProjectId } : {}),
      cleared: latest,
      risk,
    });
  }
  return reads.sort((a, b) => a.chainKey.localeCompare(b.chainKey));
}

/* --------------------------------------------------------------- readings */

function commitmentItems(input: JudgmentInput, closed: Set<string>): AttentionItem[] {
  const { viewer, now } = input;
  const items: AttentionItem[] = [];

  for (const commitment of input.commitments) {
    if (commitment.organizationId && commitment.organizationId !== input.organizationId) continue;
    if (commitment.status === "kept" || commitment.status === "released") continue;
    if (closed.has(commitment.id)) continue;

    const owned = isViewer(viewer, {
      ...(commitment.ownerEmail ? { email: commitment.ownerEmail } : {}),
      name: commitment.ownerName,
      ...(commitment.ownerUserId ? { userId: commitment.ownerUserId } : {}),
    });
    const forViewer =
      !owned && commitment.beneficiary ? isViewer(viewer, { name: commitment.beneficiary }) : false;
    if (!owned && !forViewer) continue;

    const base = {
      forPersonKey: viewer.personKey,
      forName: viewer.name,
      refs: {
        commitmentId: commitment.id,
        ...(commitment.conversationId ? { conversationId: commitment.conversationId } : {}),
        ...(commitment.projectId ? { projectId: commitment.projectId } : {}),
        ...(commitment.decisionId ? { decisionId: commitment.decisionId } : {}),
        personKey: nameKey(commitment.ownerName),
      },
      sourceApps: ["steward"],
      tier: "decided" as TruthTier,
      destination: { appId: "steward", label: "Open in Steward", route: "/modules/steward" },
      changedAt: commitment.updatedAt,
      ...(commitment.beneficiary ? { beneficiary: commitment.beneficiary } : {}),
    };

    /* Someone else carries it; the viewer is the one being waited for. */
    if (!owned && forViewer) {
      items.push({
        ...base,
        id: `commitment:${commitment.id}:${viewer.personKey}`,
        state: "waiting",
        headline: commitment.what,
        whyNow: `${commitment.ownerName} is carrying this for you. Nothing to chase yet, Steward will bring it back when it moves.`,
        evidence: [...commitment.evidence, computed(`Carried by ${commitment.ownerName}`)],
        waitingOn: { name: commitment.ownerName, personKey: nameKey(commitment.ownerName) },
        order: orderOf("waiting", commitment.updatedAt, now),
        patternKey: patternFor("depends_on", viewer.personKey, commitment.what),
      });
      continue;
    }

    const overdueBy = commitment.dueAt ? days(commitment.dueAt, now) : null;

    /* A promise only goes at risk against a date a person actually set. */
    if (overdueBy !== null && overdueBy >= -AT_RISK_WINDOW_DAYS) {
      items.push({
        ...base,
        id: `commitment:${commitment.id}:${viewer.personKey}`,
        state: "promise_at_risk",
        headline: commitment.what,
        whyNow:
          overdueBy > 0
            ? `The date you set (${commitment.dueAt!.slice(0, 10)}) passed ${overdueBy} day${overdueBy === 1 ? "" : "s"} ago and this is still open.`
            : overdueBy === 0
              ? "This is due today and still open."
              : "This is due tomorrow and still open.",
        evidence: [
          ...commitment.evidence,
          human(`Due date set for ${commitment.dueAt!.slice(0, 10)}`),
        ],
        ...(commitment.beneficiary
          ? { waitingOn: { name: commitment.beneficiary, personKey: nameKey(commitment.beneficiary) } }
          : {}),
        order: orderOf("promise_at_risk", commitment.dueAt, now),
        patternKey: patternFor("carries", viewer.personKey, commitment.what),
      });
      continue;
    }

    if (commitment.status === "waiting") {
      const idle = days(commitment.updatedAt, now);
      const meaningful = idle >= WAITING_FOLLOW_UP_DAYS;
      items.push({
        ...base,
        id: `commitment:${commitment.id}:${viewer.personKey}`,
        state: "waiting",
        headline: commitment.what,
        whyNow: meaningful
          ? `This has been waiting on someone else for ${idle} days, so a follow-up is now a reasonable thing to do.`
          : "This is correctly waiting on someone else. There is nothing to chase yet.",
        evidence: [...commitment.evidence, human("Marked waiting by a person")],
        ...(meaningful ? { nextMove: "Ask where this stands, or set a date." } : {}),
        order: orderOf("waiting", commitment.updatedAt, now),
        patternKey: patternFor("depends_on", viewer.personKey, commitment.what),
      });
      continue;
    }

    /* An open promise made to a named person is someone else's blocked move. */
    if (commitment.beneficiary) {
      items.push({
        ...base,
        id: `commitment:${commitment.id}:${viewer.personKey}`,
        state: "needs_you",
        headline: commitment.what,
        whyNow: `${commitment.beneficiary} is waiting on you for this. It was promised in a conversation and is still open.`,
        evidence: [...commitment.evidence, computed(`Promised to ${commitment.beneficiary}`)],
        waitingOn: { name: commitment.beneficiary, personKey: nameKey(commitment.beneficiary) },
        order: orderOf("needs_you", commitment.updatedAt, now),
        patternKey: patternFor("hands_off_to", viewer.personKey, commitment.what),
      });
      continue;
    }

    /*
     * Open, no date anyone set, nobody named as waiting. It exists, and that
     * is not a reason to interrupt someone.
     */
  }

  return items;
}

function projectItems(input: JudgmentInput): AttentionItem[] {
  const { viewer, now } = input;
  const items: AttentionItem[] = [];

  for (const project of input.projects ?? []) {
    if (project.organizationId !== input.organizationId) continue;
    if (!isOpenProject(project)) continue;
    const owned = isViewer(viewer, {
      ...(project.ownerUserId ? { userId: project.ownerUserId } : {}),
      ...(project.ownerLabel ? { name: project.ownerLabel } : {}),
    });
    if (!owned) continue;
    if (project.state !== "blocked") continue;

    const move = recommendedMove(project, new Date(now));
    items.push({
      id: `project:${project.id}:${viewer.personKey}`,
      forPersonKey: viewer.personKey,
      forName: viewer.name,
      state: "needs_you",
      headline: project.name,
      whyNow: project.blockedBecause?.trim()
        ? `This is recorded as blocked: ${project.blockedBecause.trim()} You carry it, so it can only move through you.`
        : "This is recorded as blocked with no reason written down, and you carry it.",
      refs: { projectId: project.id },
      evidence: [...project.evidence, human("Marked blocked in Projects")],
      sourceApps: ["projects"],
      nextMove: move.move,
      changedAt: project.lastMovedAt,
      tier: "decided",
      destination: { appId: "projects", label: "Open in Projects", route: "/modules/projects" },
      order: orderOf("needs_you", project.lastMovedAt, now),
      patternKey: patternFor("carries", viewer.personKey, project.name),
    });
  }

  return items;
}

function opsItems(input: JudgmentInput): AttentionItem[] {
  const { viewer, now } = input;
  const projects = input.projects ?? [];
  const items: AttentionItem[] = [];

  for (const chain of clearedOpsChains(input.opsEvents ?? [], now)) {
    const project = chain.projectId ? projects.find((row) => row.id === chain.projectId) : undefined;
    const commitment = chain.projectId
      ? input.commitments.find(
          (row) => row.projectId === chain.projectId && row.status !== "kept" && row.status !== "released",
        )
      : undefined;

    const ownedByProject =
      project !== undefined &&
      isViewer(viewer, {
        ...(project.ownerUserId ? { userId: project.ownerUserId } : {}),
        ...(project.ownerLabel ? { name: project.ownerLabel } : {}),
      });
    const ownedByCommitment =
      commitment !== undefined &&
      isViewer(viewer, {
        ...(commitment.ownerEmail ? { email: commitment.ownerEmail } : {}),
        name: commitment.ownerName,
      });
    if (!ownedByProject && !ownedByCommitment) continue;

    items.push({
      id: `ops:${chain.chainKey}:${viewer.personKey}`,
      forPersonKey: viewer.personKey,
      forName: viewer.name,
      state: "newly_unblocked",
      headline: commitment?.what ?? project?.name ?? chain.cleared.subjectLabel,
      whyNow: `${chain.risk.summary} That is now cleared: ${chain.cleared.summary} You can move on this.`,
      refs: {
        opsChainKey: chain.chainKey,
        ...(chain.projectId ? { projectId: chain.projectId } : {}),
        ...(commitment ? { commitmentId: commitment.id } : {}),
        activityId: chain.cleared.id,
      },
      evidence: [
        { label: chain.risk.summary, kind: "provider", url: chain.risk.destinationUrl },
        { label: chain.cleared.summary, kind: "provider", url: chain.cleared.destinationUrl },
      ],
      sourceApps: commitment ? ["ops", "steward"] : ["ops"],
      changedAt: chain.cleared.at,
      tier: chain.cleared.humanDecision ? "decided" : "observed",
      destination: { appId: "ops", label: "Open in Ops", route: "/modules/ops" },
      order: orderOf("newly_unblocked", chain.cleared.at, now),
      patternKey: patternFor("carries", viewer.personKey, commitment?.what ?? chain.chainKey),
    });
  }

  return items;
}

function commsItems(input: JudgmentInput): AttentionItem[] {
  const { viewer, now } = input;
  const items: AttentionItem[] = [];
  const at = new Date(now);

  for (const relationship of input.relationships ?? []) {
    if (relationship.organizationId !== input.organizationId) continue;
    if (!isActive(relationship)) continue;
    if (!relationship.ownerUserId || relationship.ownerUserId !== viewer.userId) continue;

    /* Only a real recorded date counts. Silence is not a deadline. */
    const due = relationship.responseDueAt ?? relationship.followUpDueAt;
    if (!due) continue;
    const state = dueState(relationship, at);
    if (state !== "overdue" && state !== "today") continue;

    const overdueBy = days(due, now);
    items.push({
      id: `relationship:${relationship.id}:${viewer.personKey}`,
      forPersonKey: viewer.personKey,
      forName: viewer.name,
      state: state === "overdue" ? "promise_at_risk" : "needs_you",
      headline: relationship.nextAction?.trim()
        ? `${relationship.nextAction.trim()} · ${relationship.fullName}`
        : `Reply to ${relationship.fullName}`,
      whyNow:
        state === "overdue"
          ? `A reply was due ${due.slice(0, 10)}, ${overdueBy} day${overdueBy === 1 ? "" : "s"} ago, and nothing has gone out.`
          : `A reply to ${relationship.fullName} is due today.`,
      refs: {
        relationshipId: relationship.id,
        ...(relationship.contactId ? { personKey: relationship.contactId } : {}),
      },
      evidence: [human(`Reply due ${due.slice(0, 10)}, recorded in Comms`)],
      sourceApps: ["comms"],
      ...(relationship.nextAction?.trim() ? { nextMove: relationship.nextAction.trim() } : {}),
      waitingOn: { name: relationship.fullName },
      changedAt: relationship.lastTouchAt ?? relationship.updatedAt,
      tier: "decided",
      destination: { appId: "comms", label: "Open in Comms", route: "/modules/comms" },
      order: orderOf(state === "overdue" ? "promise_at_risk" : "needs_you", due, now),
      patternKey: patternFor("hands_off_to", viewer.personKey, relationship.fullName),
    });
  }

  return items;
}

/* ----------------------------------------------------------- the collapse */

function dedupeKey(item: AttentionItem): string {
  const refs = item.refs;
  return (
    refs.commitmentId ??
    refs.projectId ??
    refs.relationshipId ??
    refs.opsChainKey ??
    item.id
  );
}

/**
 * One canonical piece of work produces one judgment. When several rooms are
 * talking about the same thing, the stronger state wins and the other room's
 * evidence is folded in, so the item gets richer rather than repeated.
 */
export function collapse(items: AttentionItem[]): AttentionItem[] {
  const byKey = new Map<string, AttentionItem>();

  for (const item of items) {
    const key = dedupeKey(item);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }
    const winner = STATE_STRENGTH[item.state] > STATE_STRENGTH[existing.state] ? item : existing;
    const other = winner === item ? existing : item;
    const evidence = [...winner.evidence];
    for (const ref of other.evidence) {
      if (!evidence.some((seen) => seen.label === ref.label)) evidence.push(ref);
    }
    byKey.set(key, {
      ...winner,
      evidence,
      refs: { ...other.refs, ...winner.refs },
      sourceApps: [...new Set([...winner.sourceApps, ...other.sourceApps])],
      ...(winner.nextMove ?? other.nextMove ? { nextMove: winner.nextMove ?? other.nextMove } : {}),
    });
  }

  return [...byKey.values()];
}

/* ------------------------------------------------------------- the answer */

/** The whole judgment for one person. Reads canonical truth, writes nothing. */
export function judge(input: JudgmentInput): JudgmentRead {
  const closed = decidedClosures(input.memory ?? []);
  const suppressed = new Set(input.suppressedPatternKeys ?? []);

  const raw = [
    ...commitmentItems(input, closed),
    ...projectItems(input),
    ...opsItems(input),
    ...commsItems(input),
  ];

  const collapsed = collapse(raw).filter((item) => !suppressed.has(item.patternKey));

  const sorted = [...collapsed].sort(
    (a, b) => b.order - a.order || a.id.localeCompare(b.id),
  );

  const actionable = sorted.filter((item) => ACTIONABLE_STATES.includes(item.state));
  const waiting = sorted.filter((item) => item.state === "waiting");

  const shown = actionable.slice(0, MAX_ATTENTION_ITEMS);
  const watching: WatchNote[] = waiting.slice(0, MAX_WAITING_ITEMS).map((item) => ({
    label: item.headline,
    because: item.whyNow,
  }));

  return {
    forPersonKey: input.viewer.personKey,
    forName: input.viewer.name,
    headline: judgmentHeadline(shown.length),
    items: shown,
    waiting: waiting.slice(0, MAX_WAITING_ITEMS),
    deferred: Math.max(0, actionable.length - shown.length),
    watching,
    generatedAt: input.now,
  };
}

/**
 * Judgment in the shared signal shape, so Pulse and Intelligence can read it
 * later without Steward reaching into their rooms. Not wired into Pulse yet.
 */
export function judgmentContextBlocks(read: JudgmentRead) {
  return read.items.map((item) => ({
    id: `steward-judgment-${item.id}`,
    appId: "steward" as const,
    entity: {
      type: "task" as const,
      id: item.refs.commitmentId ?? item.refs.projectId ?? item.id,
      label: item.headline,
    },
    fact: `${item.forName}: ${item.headline}. ${item.whyNow}`,
    tier: item.tier,
    evidence: item.evidence,
    at: item.changedAt ?? read.generatedAt,
    confidence: "high" as const,
  }));
}
