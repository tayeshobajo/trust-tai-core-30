/**
 * The action graph: bounded work, ordered across rooms.
 *
 * The Conductor may *prepare* a sequence of steps that span Scout, Comms,
 * Roadmap, Projects, Ops and Studio. Preparing it changes nothing. Every step
 * names the room whose service would carry it out, the permission a person
 * needs there, and the signal that would show it worked. There is no execution
 * path in this module, and there is deliberately no way to add one: the graph
 * is data, and the owning room is the only thing that can act on it.
 */

import type { EvidenceRef } from "@/domain/confidence";
import { actionPermission } from "@/domain/action-authority";
import type { ActionProposal } from "@/domain/intelligence-engine";
import type {
  ConductorActionGraph,
  ConductorActionStep,
  OperatingPlan,
} from "@/domain/conductor";

/**
 * Operations whose effect leaves the building or changes a client-visible
 * commitment. Everything else is still approval-gated; this only marks which
 * steps carry real-world consequence.
 */
const CONSEQUENTIAL_PREFIXES = ["comms.send", "comms.draft", "roadmap.sequence", "projects.route"];

function isConsequential(operation: string): boolean {
  return CONSEQUENTIAL_PREFIXES.some((prefix) => operation.startsWith(prefix));
}

function computed(label: string): EvidenceRef {
  return { label, kind: "computed" };
}

function stepFromProposal(proposal: ActionProposal, dependsOn: string[]): ConductorActionStep {
  return {
    id: proposal.id,
    owningApp: proposal.appId,
    operation: proposal.operation,
    route: proposal.route,
    routeLabel: proposal.routeLabel,
    title: proposal.title,
    summary: proposal.summary,
    willDo: proposal.willDo,
    willNotDo: proposal.willNotDo,
    dependsOn,
    consequential: isConsequential(proposal.operation),
    requiresApproval: true,
    requiredCapability: actionPermission(proposal),
    expectedSignal: `${proposal.routeLabel} records the change in ${proposal.appId}.`,
    basis: "recommended",
    evidence: [computed(`Proposed from ${proposal.appId} evidence`)],
  };
}

export interface ActionGraphInput {
  organizationId: string;
  purpose: string;
  proposals: ActionProposal[];
  /** When present, its room order is used to sequence steps sensibly. */
  plan?: OperatingPlan | undefined;
  now: string;
}

/**
 * Build the graph. Pure: the same proposals always produce the same graph, in
 * the same order, with the same dependencies.
 */
export function buildActionGraph(input: ActionGraphInput): ConductorActionGraph | undefined {
  const { organizationId, purpose, proposals, plan, now } = input;
  if (proposals.length === 0) return undefined;

  /*
   * Ordering follows the plan's rooms when there is a plan, because the plan
   * already worked out which room feeds which. Without one, room order is
   * alphabetical so the graph stays deterministic rather than accidental.
   */
  const roomOrder = plan?.rooms.map((room) => room.appId) ?? [];
  const rank = (appId: string) => {
    const index = roomOrder.indexOf(appId);
    return index === -1 ? roomOrder.length + 1 : index;
  };

  const ordered = [...proposals].sort(
    (a, b) => rank(a.appId) - rank(b.appId) || a.appId.localeCompare(b.appId) || a.id.localeCompare(b.id),
  );

  const steps: ConductorActionStep[] = [];
  for (const [index, proposal] of ordered.entries()) {
    const previous = ordered[index - 1];
    /* A step depends on the previous one only when it sits in a later room. */
    const dependsOn =
      previous && rank(previous.appId) < rank(proposal.appId) ? [previous.id] : [];
    steps.push(stepFromProposal(proposal, dependsOn));
  }

  return {
    id: `conductor-graph:${now}`,
    organizationId,
    purpose,
    steps,
    /* Always gated: there is no unapproved path out of this module. */
    requiresApproval: true,
    owningApps: [...new Set(steps.map((step) => step.owningApp))].sort(),
    generatedAt: now,
  };
}
