/**
 * The one governed step an unanswered routed request can offer.
 *
 * Ops and Studio answer for themselves. Nothing here may accept, chase or
 * complete work on their behalf, and no adapter exists that could. What this
 * house *can* settle is whether it is still waiting — so the only proposal
 * built here is Projects withdrawing its own ask, and even that waits for a
 * person to approve it before any adapter is reached.
 *
 * Pure: no reads, no writes, no clock of its own.
 */

import { capabilityFor } from "@/domain/adapter-registry";
import { ROUTE_TARGET_LABEL } from "@/domain/project-routing";
import type { ControlledAction } from "@/domain/conductor-control";
import type { RouteLedgerEntry } from "@/domain/route-ledger";

export const ROUTE_WITHDRAW_OPERATION = "projects.withdraw_route";

/** Why a routed request has no governed step, when it has none. */
export function routeStepGap(entry: RouteLedgerEntry): string | undefined {
  if (entry.status === "accepted") {
    return `${ROUTE_TARGET_LABEL[entry.targetApp]} has accepted this. Nothing here may change work another room now owns.`;
  }
  if (entry.status === "withdrawn") {
    return "This ask was already taken back, so there is nothing left to authorise.";
  }
  if (!entry.unanswered) {
    return `It has been ${entry.ageDays} day${entry.ageDays === 1 ? "" : "s"}. Silence this short is not yet a fact worth acting on.`;
  }
  return undefined;
}

export interface RouteProposalInput {
  entry: RouteLedgerEntry;
  because: string;
  createdAt: string;
}

/**
 * Build the withdrawal as a proposed action. Never approved, never routed:
 * it enters the approval queue exactly as any other bounded step does.
 */
export function buildRouteWithdrawalAction(
  input: RouteProposalInput,
): ControlledAction | undefined {
  const { entry } = input;
  if (routeStepGap(entry)) return undefined;
  const capability = capabilityFor("projects", ROUTE_WITHDRAW_OPERATION);
  if (!capability?.supported) return undefined;

  const target = ROUTE_TARGET_LABEL[entry.targetApp];
  return {
    id: `action:route-withdraw:${entry.key}`,
    organizationId: entry.organizationId,
    owningApp: "projects",
    operation: ROUTE_WITHDRAW_OPERATION,
    payload: { routeKey: entry.key, because: input.because.trim() },
    intent: `Take back the ask to ${target} on ${entry.projectName}`,
    whyItMatters: `${entry.projectName} has been waiting ${entry.ageDays} day${entry.ageDays === 1 ? "" : "s"} for ${target} to answer: ${entry.requestedOutcome}.`,
    evidence: [
      ...entry.evidence,
      { label: `Requested of ${target} ${entry.ageDays} days ago`, kind: "computed" },
    ],
    dependsOn: [],
    consequence: capability.consequence,
    requiresApproval: true,
    requiredCapability: capability.requiredCapability,
    route: `/modules/projects/${entry.projectId}`,
    routeLabel: `Open ${entry.projectName}`,
    boundary: {
      willDo: [
        `Record in Projects that this house has withdrawn its ask to ${target}.`,
        `Stop the ledger from accepting a later answer from ${target} for this request.`,
      ],
      willNotDo: [
        `Change anything inside ${target}. It is a separate room and answers for itself.`,
        "Chase, notify or message anyone.",
        `Claim ${target} refused, saw or received the ask.`,
        "Change the project's status, owner or dates.",
      ],
    },
    expectedSignal: {
      statement: `The routed request on ${entry.projectName} stops being reported as unanswered.`,
      observedIn: "projects",
    },
    sourceEventKey: `${entry.key}:withdrawn`,
    status: "proposed",
    createdAt: input.createdAt,
  };
}
