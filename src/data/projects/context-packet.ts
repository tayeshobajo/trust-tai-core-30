/**
 * The Project Context Packet.
 *
 * One structured, generated read of what a project actually is: identity,
 * outcome, decided truth, constraints, open questions, current work, approved
 * assets, and where it is being built. It is generated from current project
 * state every time it is asked for. It is never a second manual document.
 *
 * It carries meaning plus source references. It never carries transcripts, and
 * it never carries every file.
 */

import type {
  KnowledgeItem,
  ProjectAsset,
  ProjectConnection,
  ThinkingSource,
} from "@/domain/project-intelligence";
import { rankOf } from "@/domain/project-intelligence";
import type { ProjectBlocker, ProjectDecision, WorkItem } from "@/domain/project-delivery";
import type { ExecutionProject } from "@/domain/projects";

export interface PacketStatement {
  statement: string;
  /** Why this is trusted, in the source hierarchy. */
  authority:
    | "project_decision"
    | "roadmap"
    | "confirmed_knowledge"
    | "approved_asset"
    | "meeting"
    | "thinking_room"
    | "agent";
  sourceReference?: string;
  sourceLabel?: string;
  /** Present only when the value was inferred. */
  confidence?: number;
}

export interface ProjectContextPacket {
  generatedAt: string;
  project: {
    id: string;
    organizationId: string;
    name: string;
    company?: string;
    state: string;
    outcome: string;
    owner?: string;
    dueDate?: string;
  };
  roadmap: { linked: boolean; roadmapId?: string; milestoneId?: string; milestoneName?: string };
  confirmedDecisions: PacketStatement[];
  constraints: PacketStatement[];
  openQuestions: PacketStatement[];
  requirements: PacketStatement[];
  activeBlockers: { reason: string; owner?: string; raisedAt: string }[];
  currentWork: { id: string; title: string; status: string; owner?: string; dueDate?: string }[];
  approvedAssets: {
    id: string;
    title: string;
    assetType: string;
    version: number;
    fileId: string;
  }[];
  connectedSystems: {
    type: string;
    label: string;
    url?: string;
    status: string;
    lastSyncedAt?: string;
  }[];
  meetingContext: PacketStatement[];
  thinkingSources: { type: string; title: string; url: string; primary: boolean; sync: string }[];
  /** Populated only when the packet is asked for on behalf of a named agent. */
  agentBoundaries?: {
    agentId: string;
    responsibility: string;
    requiredContext: string[];
    escalationRules: string[];
    evidenceExpected: string[];
    mustNotChange: string[];
  };
  /** Conflicts a person should resolve. The packet never resolves them itself. */
  conflicts: { about: string; kept: string; alsoClaims: string }[];
}

export interface ContextPacketInput {
  project: ExecutionProject;
  company?: string;
  roadmap?: { roadmapId?: string; milestoneId?: string; milestoneName?: string };
  knowledge: KnowledgeItem[];
  decisions: ProjectDecision[];
  blockers: ProjectBlocker[];
  work: WorkItem[];
  assets: ProjectAsset[];
  connections: ProjectConnection[];
  thinking: ThinkingSource[];
  agent?: {
    agentId: string;
    responsibility: string;
    requiredContext: string[];
    escalationRules: string[];
    evidenceExpected: string[];
  };
  now?: Date;
}

function statementFrom(item: KnowledgeItem): PacketStatement {
  const rank = rankOf(item.origin, item.reviewState);
  const authority: PacketStatement["authority"] =
    rank <= 2
      ? "roadmap"
      : rank === 3
        ? "confirmed_knowledge"
        : rank === 4
          ? "approved_asset"
          : rank === 5
            ? "meeting"
            : rank === 6
              ? "thinking_room"
              : "agent";
  return {
    statement: item.body,
    authority,
    ...(item.sourceReference ? { sourceReference: item.sourceReference } : {}),
    ...(item.sourceLabel ? { sourceLabel: item.sourceLabel } : {}),
    ...(typeof item.confidence === "number" ? { confidence: item.confidence } : {}),
  };
}

const AUTHORITY_ORDER: PacketStatement["authority"][] = [
  "project_decision",
  "roadmap",
  "confirmed_knowledge",
  "approved_asset",
  "meeting",
  "thinking_room",
  "agent",
];

function byAuthority(a: PacketStatement, b: PacketStatement): number {
  return AUTHORITY_ORDER.indexOf(a.authority) - AUTHORITY_ORDER.indexOf(b.authority);
}

/** Two statements are "about the same thing" when they share a source subject. */
function conflictsBetween(
  decisions: PacketStatement[],
  others: PacketStatement[],
): { about: string; kept: string; alsoClaims: string }[] {
  const conflicts: { about: string; kept: string; alsoClaims: string }[] = [];
  for (const decision of decisions) {
    for (const other of others) {
      if (other.authority === "project_decision") continue;
      if (!other.sourceReference || other.sourceReference !== decision.sourceReference) continue;
      if (other.statement.trim() === decision.statement.trim()) continue;
      conflicts.push({
        about: decision.sourceLabel ?? decision.sourceReference ?? "this project",
        kept: decision.statement,
        alsoClaims: other.statement,
      });
    }
  }
  return conflicts;
}

export function buildProjectContextPacket(input: ContextPacketInput): ProjectContextPacket {
  const now = input.now ?? new Date();
  const live = input.knowledge.filter((item) => item.reviewState !== "superseded");
  const confirmed = live.filter((item) => item.reviewState === "confirmed");

  // A human-answered project decision is the highest authority there is.
  const answered = input.decisions
    .filter((decision) => decision.status === "answered" && decision.answer)
    .map<PacketStatement>((decision) => ({
      statement: `${decision.question} → ${decision.answer}`,
      authority: "project_decision",
      sourceReference: decision.id,
      sourceLabel: "Project decision",
    }));

  const confirmedDecisionKnowledge = confirmed
    .filter((item) => item.section === "decision")
    .map(statementFrom);

  const confirmedDecisions = [...answered, ...confirmedDecisionKnowledge].sort(byAuthority);

  const constraints = confirmed.filter((i) => i.section === "constraint").map(statementFrom);
  const requirements = confirmed.filter((i) => i.section === "requirement").map(statementFrom);
  const openQuestions = [
    ...input.decisions
      .filter((decision) => decision.status === "open")
      .map<PacketStatement>((decision) => ({
        statement: decision.question,
        authority: "project_decision",
        sourceReference: decision.id,
        sourceLabel: "Open project decision",
      })),
    ...live.filter((i) => i.section === "open_question").map(statementFrom),
  ];
  const meetingContext = live.filter((i) => i.section === "meeting").map(statementFrom);

  const approvedAssets = input.assets
    .filter((asset) => asset.status === "approved")
    .map((asset) => ({
      id: asset.id,
      title: asset.title,
      assetType: asset.assetType,
      version: asset.version,
      fileId: asset.fileId,
    }));

  const currentWork = input.work
    .filter((item) => item.status === "in_progress" || item.status === "in_review")
    .map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      ...(item.ownerLabel ? { owner: item.ownerLabel } : {}),
      ...(item.dueDate ? { dueDate: item.dueDate } : {}),
    }));

  const packet: ProjectContextPacket = {
    generatedAt: now.toISOString(),
    project: {
      id: input.project.id,
      organizationId: input.project.organizationId,
      name: input.project.name,
      ...(input.company ? { company: input.company } : {}),
      state: input.project.state,
      outcome: input.project.pointB,
      ...(input.project.ownerLabel ? { owner: input.project.ownerLabel } : {}),
      ...(input.project.dueDate ? { dueDate: input.project.dueDate } : {}),
    },
    roadmap: {
      linked: Boolean(input.roadmap?.roadmapId),
      ...(input.roadmap?.roadmapId ? { roadmapId: input.roadmap.roadmapId } : {}),
      ...(input.roadmap?.milestoneId ? { milestoneId: input.roadmap.milestoneId } : {}),
      ...(input.roadmap?.milestoneName ? { milestoneName: input.roadmap.milestoneName } : {}),
    },
    confirmedDecisions,
    constraints,
    openQuestions,
    requirements,
    activeBlockers: input.blockers
      .filter((blocker) => blocker.status === "open")
      .map((blocker) => ({
        reason: blocker.reason,
        ...(blocker.ownerLabel ? { owner: blocker.ownerLabel } : {}),
        raisedAt: blocker.raisedAt,
      })),
    currentWork,
    approvedAssets,
    connectedSystems: input.connections.map((connection) => ({
      type: connection.connectionType,
      label: connection.label,
      ...(connection.url ? { url: connection.url } : {}),
      status: connection.status,
      ...(connection.lastSyncedAt ? { lastSyncedAt: connection.lastSyncedAt } : {}),
    })),
    meetingContext,
    thinkingSources: input.thinking.map((source) => ({
      type: source.sourceType,
      title: source.title,
      url: source.url,
      primary: source.isPrimary,
      sync: source.syncState,
    })),
    conflicts: conflictsBetween(confirmedDecisions, [...live.map(statementFrom)]),
  };

  if (input.agent) {
    packet.agentBoundaries = {
      agentId: input.agent.agentId,
      responsibility: input.agent.responsibility,
      requiredContext: input.agent.requiredContext,
      escalationRules: input.agent.escalationRules,
      evidenceExpected: input.agent.evidenceExpected,
      mustNotChange: [
        "Approved roadmap truth",
        "Approved assets, unless a person supersedes them",
        "Business outcome completion",
        ...constraints.map((constraint) => constraint.statement),
      ],
    };
  }

  return packet;
}

/* ------------------------------------------------------------ context health */

export type ContextHealthLevel = "strong" | "needs_review" | "missing_key_context";

export const CONTEXT_HEALTH_LABEL: Record<ContextHealthLevel, string> = {
  strong: "Strong",
  needs_review: "Needs review",
  missing_key_context: "Missing key context",
};

export interface ContextHealth {
  level: ContextHealthLevel;
  reasons: string[];
}

/** Reasons, never a percentage. If it is uncertain, it says why. */
export function contextHealth(packet: ProjectContextPacket, hasDesignWork = false): ContextHealth {
  const missing: string[] = [];
  const review: string[] = [];

  if (!packet.project.outcome.trim()) missing.push("No outcome is recorded.");
  if (!packet.project.owner) missing.push("Nobody is named as owner.");
  if (packet.confirmedDecisions.length === 0) review.push("No decision has been confirmed yet.");
  if (packet.openQuestions.length > 0)
    review.push(
      `${packet.openQuestions.length} open question${packet.openQuestions.length === 1 ? "" : "s"} still unanswered.`,
    );
  if (hasDesignWork && packet.approvedAssets.length === 0)
    review.push("Design work exists with no approved asset.");
  if (packet.conflicts.length > 0)
    review.push(`${packet.conflicts.length} source conflict needs a person.`);
  if (!packet.roadmap.linked) review.push("Not linked to a roadmap milestone.");

  const staleThinking = packet.thinkingSources.filter(
    (source) => source.sync === "link_saved" || source.sync === "import_needs_upload",
  );
  if (packet.confirmedDecisions.length > 0 && staleThinking.length > 0)
    review.push("Thinking source has not been reviewed since the last confirmed decision.");

  if (missing.length > 0) return { level: "missing_key_context", reasons: [...missing, ...review] };
  if (review.length > 0) return { level: "needs_review", reasons: review };
  return { level: "strong", reasons: ["Outcome, owner and decided truth are all on record."] };
}
