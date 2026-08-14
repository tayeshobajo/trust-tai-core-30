/**
 * Deterministic cross-app retrieval and reasoning.
 *
 * Everything in this file is a pure function over a snapshot of what the three
 * live rooms already hold. No model is called, nothing is invented, and every
 * signal carries the context blocks it rests on. If the evidence is not in the
 * snapshot, the answer says so.
 */

import { dueState, isActive, type Relationship } from "@/domain/comms";
import type { EvidenceRef } from "@/domain/confidence";
import type { ActivityEvent } from "@/domain/activity";
import type { EntityRef, ID } from "@/domain/entities";
import type { Roadmap, RoadmapDecision } from "@/domain/roadmap";
import type { ExecutionProject } from "@/domain/projects";
import { isOpenProject, projectHealth, recommendedMove } from "@/domain/projects";
import type { ProspectCandidate } from "@/domain/scout";
import { readOpsEvents } from "@/domain/ops";
import { deriveOpsSignals, opsContextBlocks } from "./ops-signals";
import type {
  AskAnswer,
  AskQuestionId,
  ContextBlock,
  ContextBundle,
  ContextSourceApp,
  Signal,
  WithheldSource,
} from "@/domain/signals";

const DAY = 86_400_000;

export interface SuiteSnapshot {
  organizationId: ID;
  now: string;
  candidates: ProspectCandidate[];
  relationships: Relationship[];
  roadmaps: Roadmap[];
  openDecisions: RoadmapDecision[];
  projects: ExecutionProject[];
  events: ActivityEvent[];
  /** Rows written by the Ops specialist app into the shared activity table. */
  opsActivities: ActivityEvent[];
  withheld: WithheldSource[];
}

export function emptySnapshot(organizationId: ID, now = new Date().toISOString()): SuiteSnapshot {
  return {
    organizationId,
    now,
    candidates: [],
    relationships: [],
    roadmaps: [],
    openDecisions: [],
    projects: [],
    events: [],
    opsActivities: [],
    withheld: [],
  };
}

function daysOld(at: string, now: string): number {
  const a = new Date(at).getTime();
  const b = new Date(now).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.floor((b - a) / DAY));
}

function block(input: Omit<ContextBlock, "stalenessDays"> & { now: string }): ContextBlock {
  const { now, ...rest } = input;
  return { ...rest, stalenessDays: daysOld(rest.at, now) };
}

function human(label: string): EvidenceRef {
  return { label, kind: "human" };
}

function computed(label: string): EvidenceRef {
  return { label, kind: "computed" };
}

/* ------------------------------------------------------------ context read */

/** Ops rows, de-duplicated and scoped to this organization. */
export function opsEventsOf(snapshot: SuiteSnapshot) {
  return readOpsEvents([...snapshot.events, ...snapshot.opsActivities], snapshot.organizationId);
}

export function contextBlocks(snapshot: SuiteSnapshot): ContextBlock[] {
  const now = snapshot.now;
  const blocks: ContextBlock[] = [];

  for (const candidate of snapshot.candidates) {
    const prospect = candidate.prospect;
    const entity: EntityRef = { type: "prospect", id: prospect.id, label: prospect.name };
    blocks.push(
      block({
        now,
        id: `scout:status:${prospect.id}`,
        appId: "scout",
        entity,
        fact: `${prospect.name} is at "${prospect.status.replace(/_/g, " ")}" in Scout.`,
        tier: "decided",
        evidence: [human("Scout board status")],
        at: prospect.updatedAt ?? prospect.createdAt,
      }),
    );

    if (candidate.evaluation.scoreable) {
      blocks.push(
        block({
          now,
          id: `scout:fit:${prospect.id}`,
          appId: "scout",
          entity,
          fact: `ICP fit reads ${candidate.evaluation.score}/100 (${candidate.evaluation.light}). ${candidate.evaluation.explanation}`,
          tier: "inferred",
          evidence: [computed(`Evaluator ${candidate.evaluation.evaluatorVersion}`)],
          at: candidate.evaluation.evaluatedAt,
          confidence:
            candidate.evaluation.evidenceCount >= 4
              ? "moderate"
              : candidate.evaluation.evidenceCount > 0
                ? "low"
                : "unknown",
        }),
      );
    }

    for (const signal of candidate.signals.slice(0, 3)) {
      blocks.push(
        block({
          now,
          id: `scout:signal:${signal.id}`,
          appId: "scout",
          entity,
          fact: signal.statement,
          tier: "observed",
          evidence: [
            signal.sourceUrl
              ? { label: "Public page read by Scout", kind: "page", url: signal.sourceUrl }
              : { label: `Read by ${signal.provenance.appId}`, kind: "provider" },
          ],
          at: signal.provenance.observedAt,
        }),
      );
    }
  }

  for (const relationship of snapshot.relationships) {
    const entity: EntityRef = {
      type: "relationship",
      id: relationship.id,
      label: relationship.fullName,
    };
    const state = dueState(relationship, new Date(now));
    blocks.push(
      block({
        now,
        id: `comms:stage:${relationship.id}`,
        appId: "comms",
        entity,
        fact: `${relationship.fullName}${relationship.companyName ? ` (${relationship.companyName})` : ""} is at stage "${relationship.stage.replace(/_/g, " ")}" and reads ${state.replace(/_/g, " ")}.`,
        tier: "decided",
        evidence: [human("Comms relationship record")],
        at: relationship.updatedAt,
      }),
    );
    if (relationship.lastTouchAt) {
      blocks.push(
        block({
          now,
          id: `comms:touch:${relationship.id}`,
          appId: "comms",
          entity,
          fact: `Last contact with ${relationship.fullName} was ${daysOld(relationship.lastTouchAt, now)} days ago.`,
          tier: "observed",
          evidence: [computed("Logged touches in Comms")],
          at: relationship.lastTouchAt,
        }),
      );
    }
    for (const item of relationship.decided.slice(0, 2)) {
      blocks.push(
        block({
          now,
          id: `comms:decided:${relationship.id}:${item.label}`,
          appId: "comms",
          entity,
          fact: `${item.label}: ${item.value}`,
          tier: "decided",
          evidence: item.evidence.length > 0 ? item.evidence : [human("Recorded by a person")],
          at: item.at ?? relationship.updatedAt,
        }),
      );
    }
  }

  for (const roadmap of snapshot.roadmaps) {
    const entity: EntityRef = { type: "roadmap", id: roadmap.id, label: roadmap.subjectLabel };
    blocks.push(
      block({
        now,
        id: `roadmap:status:${roadmap.id}`,
        appId: "roadmap",
        entity,
        fact: `Roadmap "${roadmap.title}" for ${roadmap.subjectLabel} is ${roadmap.status.replace(/_/g, " ")}.`,
        tier: "decided",
        evidence: [human("Roadmap record")],
        at: roadmap.updatedAt,
      }),
    );
    if (roadmap.nextMove?.action) {
      blocks.push(
        block({
          now,
          id: `roadmap:next:${roadmap.id}`,
          appId: "roadmap",
          entity,
          fact: `Next move on record: ${roadmap.nextMove.action}. ${roadmap.nextMove.because}`,
          tier: roadmap.nextMove.tier,
          evidence: [computed("Composed from roadmap evidence")],
          at: roadmap.updatedAt,
        }),
      );
    }
  }

  for (const project of snapshot.projects) {
    const entity: EntityRef = { type: "project", id: project.id, label: project.name };
    const health = projectHealth(project, new Date(now));
    blocks.push(
      block({
        now,
        id: `projects:state:${project.id}`,
        appId: "projects",
        entity,
        fact: `${project.name} is ${project.state.replace(/_/g, " ")} in Projects, carried by ${project.ownerLabel ?? "no one yet"}.`,
        tier: "decided",
        evidence: [human("Projects delivery record")],
        at: project.updatedAt,
      }),
    );
    blocks.push(
      block({
        now,
        id: `projects:health:${project.id}`,
        appId: "projects",
        entity,
        fact: `Delivery health reads ${health.level.replace(/_/g, " ")}. ${health.because}`,
        tier: "inferred",
        evidence: [computed("Derived from the Projects record")],
        at: project.lastMovedAt,
        confidence: project.nextMove ? "moderate" : "low",
      }),
    );
  }

  for (const opsBlock of opsContextBlocks(opsEventsOf(snapshot), now)) {
    blocks.push(opsBlock);
  }

  for (const decision of snapshot.openDecisions) {
    blocks.push(
      block({
        now,
        id: `roadmap:decision:${decision.id}`,
        appId: "roadmap",
        entity: { type: "decision", id: decision.id, label: decision.question },
        fact: `Open decision: ${decision.question}. ${decision.whyItMatters}`,
        tier: "inferred",
        evidence: decision.evidence.length > 0 ? decision.evidence : [computed("Raised by Roadmap")],
        at: decision.createdAt,
      }),
    );
  }

  return blocks.sort((a, b) => (a.at < b.at ? 1 : -1));
}

function matches(entity: EntityRef, subject: EntityRef, label: string): boolean {
  if (entity.type === subject.type && entity.id === subject.id) return true;
  const needle = label.trim().toLowerCase();
  if (!needle) return false;
  return (entity.label ?? "").toLowerCase().includes(needle);
}

export function bundleFor(
  snapshot: SuiteSnapshot,
  options: { subject?: EntityRef | undefined; question?: string | undefined } = {},
): ContextBundle {
  const all = contextBlocks(snapshot);
  const subject = options.subject;
  const blocks = subject ? all.filter((b) => matches(b.entity, subject, subject.label ?? "")) : all;
  const contributing = [...new Set(blocks.map((b) => b.appId))] as ContextSourceApp[];
  const emptyRooms: WithheldSource[] = (["scout", "comms", "roadmap", "projects", "ops"] as ContextSourceApp[])
    .filter((app) => !contributing.includes(app))
    .filter((app) => !snapshot.withheld.some((w) => w.appId === app))
    .map((appId) => ({ appId, reason: "no_data" as const }));

  return {
    organizationId: snapshot.organizationId,
    ...(subject ? { subject } : {}),
    ...(options.question ? { question: options.question } : {}),
    blocks,
    contributingApps: contributing,
    withheld: [...snapshot.withheld, ...emptyRooms],
    generatedAt: snapshot.now,
  };
}

/* ----------------------------------------------------------------- signals */

function signalId(parts: string[]): string {
  return parts.join(":");
}

export function deriveSignals(snapshot: SuiteSnapshot): Signal[] {
  const now = snapshot.now;
  const nowDate = new Date(now);
  const blocks = contextBlocks(snapshot);
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const signals: Signal[] = [];

  const relationshipsByProspect = new Map<string, Relationship>();
  for (const relationship of snapshot.relationships) {
    if (relationship.prospectId) relationshipsByProspect.set(relationship.prospectId, relationship);
  }
  const roadmapSubjects = new Set<string>();
  for (const roadmap of snapshot.roadmaps) {
    if (roadmap.prospectId) roadmapSubjects.add(roadmap.prospectId);
    if (roadmap.relationshipId) roadmapSubjects.add(roadmap.relationshipId);
    if (roadmap.clientId) roadmapSubjects.add(roadmap.clientId);
  }

  /* Relationship: a reply or a follow-up is late. */
  for (const relationship of snapshot.relationships) {
    const state = dueState(relationship, nowDate);
    const ref = `comms:stage:${relationship.id}`;
    if (!byId.has(ref)) continue;
    if (state === "overdue" || state === "today") {
      signals.push({
        id: signalId(["comms", "due", relationship.id]),
        category: "relationship",
        title:
          state === "overdue"
            ? `${relationship.fullName} is waiting on you`
            : `${relationship.fullName} is due today`,
        why:
          state === "overdue"
            ? "A commitment you made has passed its date. Silence after a promise costs more than a slow answer."
            : "You committed to come back to this person today.",
        subject: { type: "relationship", id: relationship.id, label: relationship.fullName },
        evidence: [human("Due date recorded in Comms")],
        contextRefs: [ref],
        confidence: "high",
        recommendedNextMove:
          relationship.nextAction?.trim() || "Send the reply you owe, or move the date honestly.",
        destination: { appId: "comms", label: "Open in Comms", route: "/modules/comms" },
        status: "new",
        urgency: state === "overdue" ? 100 : 90,
        at: relationship.updatedAt,
      });
    } else if (state === "dormant" && isActive(relationship)) {
      signals.push({
        id: signalId(["comms", "dormant", relationship.id]),
        category: "relationship",
        title: `${relationship.fullName} has gone quiet`,
        why: "An active relationship with no contact for weeks quietly becomes a cold one.",
        subject: { type: "relationship", id: relationship.id, label: relationship.fullName },
        evidence: [computed("Last logged touch in Comms")],
        contextRefs: [ref],
        confidence: relationship.lastTouchAt ? "moderate" : "low",
        recommendedNextMove: "Reach out with something useful, or archive it deliberately.",
        destination: { appId: "comms", label: "Open in Comms", route: "/modules/comms" },
        status: "new",
        urgency: 45,
        at: relationship.updatedAt,
      });
    }
  }

  /* Delivery: a decision is sitting open. */
  for (const decision of snapshot.openDecisions) {
    const ref = `roadmap:decision:${decision.id}`;
    signals.push({
      id: signalId(["roadmap", "decision", decision.id]),
      category: "delivery",
      title: decision.question,
      why: decision.whyItMatters || "Work downstream of this decision cannot be sequenced yet.",
      subject: { type: "decision", id: decision.id, label: decision.question },
      evidence: decision.evidence.length > 0 ? decision.evidence : [computed("Raised by Roadmap")],
      contextRefs: byId.has(ref) ? [ref] : [],
      confidence: decision.recommendation ? "moderate" : "low",
      recommendedNextMove:
        decision.recommendation?.trim() || "Answer the question so the build order can move.",
      destination: {
        appId: "roadmap",
        label: "Open in Roadmap",
        route: `/modules/roadmap/${decision.roadmapId}`,
      },
      status: "new",
      urgency: 85,
      at: decision.createdAt,
    });
  }

  /* Pipeline: qualified in Scout, not yet a relationship in Comms. */
  for (const candidate of snapshot.candidates) {
    const prospect = candidate.prospect;
    const ref = `scout:status:${prospect.id}`;
    const routed = relationshipsByProspect.has(prospect.id);
    if ((prospect.status === "qualified" || prospect.status === "ready_for_comms") && !routed) {
      signals.push({
        id: signalId(["scout", "unrouted", prospect.id]),
        category: "pipeline",
        title: `${prospect.name} is qualified but nobody is talking to them`,
        why: "A qualified company with no relationship in Comms is a decision already made and not acted on.",
        subject: { type: "prospect", id: prospect.id, label: prospect.name },
        evidence: [human("Scout qualification")],
        contextRefs: [ref],
        confidence: "high",
        recommendedNextMove: "Route this company to Comms and open the conversation.",
        destination: {
          appId: "scout",
          label: "Open in Scout",
          route: `/modules/scout/prospects/${prospect.id}`,
        },
        status: "new",
        urgency: 80,
        at: prospect.updatedAt,
      });
    }

    if (
      (prospect.status === "discovered" || prospect.status === "reviewing") &&
      candidate.evaluation.scoreable &&
      candidate.evaluation.score >= 70
    ) {
      signals.push({
        id: signalId(["scout", "strongfit", prospect.id]),
        category: "growth",
        title: `${prospect.name} reads as a strong fit and is still unreviewed`,
        why: candidate.evaluation.explanation,
        subject: { type: "prospect", id: prospect.id, label: prospect.name },
        evidence: [computed(`Evaluator ${candidate.evaluation.evaluatorVersion}`)],
        contextRefs: [ref, `scout:fit:${prospect.id}`].filter((id) => byId.has(id)),
        confidence: candidate.evaluation.evidenceCount >= 4 ? "moderate" : "low",
        recommendedNextMove: "Review the fit read and qualify or pass, so the board stays honest.",
        destination: {
          appId: "scout",
          label: "Open in Scout",
          route: `/modules/scout/prospects/${prospect.id}`,
        },
        status: "new",
        urgency: 55,
        at: candidate.evaluation.evaluatedAt,
      });
    }
  }

  /* Client stewardship: a converted company with no roadmap to run. */
  for (const candidate of snapshot.candidates) {
    const prospect = candidate.prospect;
    if (prospect.status !== "converted") continue;
    if (roadmapSubjects.has(prospect.id)) continue;
    signals.push({
      id: signalId(["stewardship", "noroadmap", prospect.id]),
      category: "client_stewardship",
      title: `${prospect.name} became a client without a roadmap`,
      why: "Delivery without a Point A to Point B has no agreed destination and no build order.",
      subject: { type: "prospect", id: prospect.id, label: prospect.name },
      evidence: [human("Scout status: converted")],
      contextRefs: [`scout:status:${prospect.id}`],
      confidence: "high",
      recommendedNextMove: "Open a roadmap for this client before work starts.",
      destination: { appId: "roadmap", label: "Open Roadmap", route: "/modules/roadmap" },
      status: "new",
      urgency: 75,
      at: prospect.updatedAt,
    });
  }

  /* Delivery: work that is blocked, stalled, or missing what it needs. */
  for (const project of snapshot.projects) {
    if (!isOpenProject(project)) continue;
    const health = projectHealth(project, nowDate);
    if (health.level === "on_track") continue;
    const ref = `projects:state:${project.id}`;
    if (!byId.has(ref)) continue;
    const move = recommendedMove(project, nowDate);
    signals.push({
      id: signalId(["projects", "health", project.id]),
      category: "delivery",
      title:
        health.level === "at_risk"
          ? `${project.name} is at risk`
          : `${project.name} cannot move yet`,
      why: health.because,
      subject: { type: "project", id: project.id, label: project.name },
      evidence: [human("Projects delivery record")],
      contextRefs: [ref, `projects:health:${project.id}`].filter((id) => byId.has(id)),
      confidence: "high",
      recommendedNextMove: move.move,
      destination: {
        appId: "projects",
        label: "Open in Projects",
        route: `/modules/projects/${project.id}`,
      },
      status: "new",
      urgency: health.level === "at_risk" ? 88 : 60,
      at: project.lastMovedAt,
    });
  }

  /* Ops: technical risk, approvals and recommendations, from real rows only. */
  for (const signal of deriveOpsSignals(opsEventsOf(snapshot), now, snapshot.organizationId)) {
    if (signal.contextRefs.every((ref) => byId.has(ref))) signals.push(signal);
  }

  /* Pattern: only claimed when the count itself is the evidence. */
  const lateRefs = signals
    .filter((signal) => signal.category === "relationship" && signal.urgency >= 90)
    .map((signal) => signal.contextRefs[0])
    .filter((id): id is string => Boolean(id));
  if (lateRefs.length >= 3) {
    signals.push({
      id: signalId(["pattern", "reply-debt"]),
      category: "pattern",
      title: `${lateRefs.length} relationships are past their promised date`,
      why: "This is no longer one late reply. It is a capacity pattern worth deciding about.",
      evidence: [computed("Counted from Comms due dates")],
      contextRefs: lateRefs,
      confidence: "high",
      recommendedNextMove:
        "Clear the oldest three today, or move the dates you cannot honestly keep.",
      destination: { appId: "comms", label: "Open in Comms", route: "/modules/comms" },
      status: "new",
      urgency: 70,
      at: now,
    });
  }

  return signals
    .filter((signal) => signal.contextRefs.length > 0 || signal.evidence.length > 0)
    .sort((a, b) => b.urgency - a.urgency || (a.at < b.at ? 1 : -1));
}

/* ---------------------------------------------------------------- answers */

export const ASK_QUESTIONS: { id: AskQuestionId; label: string }[] = [
  { id: "attention_today", label: "What needs my attention today?" },
  { id: "company_across_suite", label: "What do we know about this company across Trust Tai?" },
  { id: "what_next", label: "What should happen next, and why?" },
];

export function classifyQuestion(question: string): AskQuestionId {
  const text = question.toLowerCase();
  if (/clear(ed)?|resolved|fixed|still open|qa pass/.test(text)) return "company_across_suite";
  if (/next|should we|what now|why/.test(text) && !/attention/.test(text)) return "what_next";
  if (/know about|across trust tai|company|tell me about/.test(text)) return "company_across_suite";
  return "attention_today";
}

/** Pull a company-ish subject out of a free-text question, if one is named. */
export function subjectFromQuestion(
  snapshot: SuiteSnapshot,
  question: string,
): EntityRef | undefined {
  const text = question.toLowerCase();
  for (const candidate of snapshot.candidates) {
    if (text.includes(candidate.prospect.name.toLowerCase())) {
      return {
        type: "prospect",
        id: candidate.prospect.id,
        label: candidate.prospect.name,
      };
    }
  }
  for (const project of snapshot.projects) {
    if (project.name && text.includes(project.name.toLowerCase())) {
      return { type: "project", id: project.id, label: project.name };
    }
  }
  for (const relationship of snapshot.relationships) {
    const company = relationship.companyName?.toLowerCase();
    if (company && text.includes(company)) {
      return { type: "relationship", id: relationship.id, label: relationship.companyName ?? "" };
    }
    if (text.includes(relationship.fullName.toLowerCase())) {
      return { type: "relationship", id: relationship.id, label: relationship.fullName };
    }
  }
  return undefined;
}

export function answer(
  snapshot: SuiteSnapshot,
  question: string,
  options: { subject?: EntityRef | undefined } = {},
): AskAnswer {
  const questionId = classifyQuestion(question);
  const subject = options.subject ?? subjectFromQuestion(snapshot, question);
  const signals = deriveSignals(snapshot);
  const base = {
    questionId,
    question,
    generatedAt: snapshot.now,
  };

  if (questionId === "company_across_suite") {
    if (!subject) {
      const known = [
        ...snapshot.candidates.map((c) => c.prospect.name),
        ...snapshot.relationships.map((r) => r.companyName).filter((n): n is string => Boolean(n)),
      ];
      const bundle = bundleFor(snapshot, { question });
      return {
        ...base,
        headline:
          known.length > 0
            ? `Name the company and I will read every room. Currently on record: ${[...new Set(known)].slice(0, 6).join(", ")}.`
            : "No company is on record in Scout, Comms or Roadmap yet, so there is nothing to read.",
        sufficient: false,
        signals: [],
        blocks: [],
        contributingApps: [],
        withheld: bundle.withheld,
        generatedAt: snapshot.now,
      };
    }
    const bundle = bundleFor(snapshot, { subject, question });
    const relevant = signals.filter(
      (signal) => signal.subject && bundle.blocks.some((b) => b.entity.id === signal.subject?.id),
    );
    return {
      ...base,
      headline:
        bundle.blocks.length > 0
          ? `${subject.label ?? "This company"}: ${bundle.blocks.length} facts across ${bundle.contributingApps.length} room${bundle.contributingApps.length === 1 ? "" : "s"}.`
          : `Nothing is recorded about ${subject.label ?? "this company"} in the rooms you can read.`,
      sufficient: bundle.blocks.length > 0,
      signals: relevant,
      blocks: bundle.blocks,
      contributingApps: bundle.contributingApps,
      withheld: bundle.withheld,
      generatedAt: snapshot.now,
    };
  }

  if (questionId === "what_next") {
    const scoped = subject
      ? signals.filter((signal) => signal.subject?.id === subject.id)
      : signals;
    const top = scoped[0];
    if (!top) {
      const bundle = bundleFor(snapshot, { question, ...(subject ? { subject } : {}) });
      return {
        ...base,
        headline:
          bundle.blocks.length === 0
            ? "There is not enough recorded in Scout, Comms or Roadmap to recommend a next move."
            : "Nothing in the evidence asks for a move right now.",
        sufficient: false,
        signals: [],
        blocks: bundle.blocks.slice(0, 6),
        contributingApps: bundle.contributingApps,
        withheld: bundle.withheld,
        generatedAt: snapshot.now,
      };
    }
    const refs = new Set(top.contextRefs);
    const blocks = contextBlocks(snapshot).filter((b) => refs.has(b.id));
    return {
      ...base,
      headline: `${top.recommendedNextMove} ${top.why}`,
      sufficient: true,
      signals: [top],
      blocks,
      contributingApps: [...new Set(blocks.map((b) => b.appId))],
      withheld: snapshot.withheld,
      generatedAt: snapshot.now,
    };
  }

  const top = signals.slice(0, 5);
  const refs = new Set(top.flatMap((signal) => signal.contextRefs));
  const blocks = contextBlocks(snapshot).filter((b) => refs.has(b.id));
  return {
    ...base,
    headline:
      top.length > 0
        ? `${top.length} thing${top.length === 1 ? "" : "s"} are asking for you, led by: ${top[0]?.title}.`
        : "Nothing across Scout, Comms or Roadmap is asking for you today.",
    sufficient: top.length > 0,
    signals: top,
    blocks,
    contributingApps: [...new Set(blocks.map((b) => b.appId))],
    withheld: snapshot.withheld,
    generatedAt: snapshot.now,
  };
}
