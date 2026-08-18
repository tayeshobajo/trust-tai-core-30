/**
 * Execution coverage, declared rather than implied (Conductor V3).
 *
 * The Conductor must be able to answer "what can you actually do right now?"
 * without guessing. This registry is the answer: one row per room operation,
 * saying whether a real adapter exists, which service boundary it crosses,
 * which permission the person still needs, how consequential it is, whether
 * approval is required, and — the important one — the furthest state that may
 * honestly be claimed once it is routed.
 *
 * A room operation absent from this file is unsupported by definition.
 */

import type { ActionLifecycleState, ConsequenceClass } from "./conductor-control";
import { needsApproval } from "./conductor-control";
import type { Permission } from "./access";

export interface AdapterCapability {
  room: string;
  operation: string;
  label: string;
  supported: boolean;
  /** Present only when an adapter really exists. */
  adapterId?: string;
  requiredCapability: Permission;
  consequence: ConsequenceClass;
  /** The exact service call, in words. Empty when unsupported. */
  boundary: string;
  requiresApproval: boolean;
  /**
   * The furthest state this adapter may claim by itself. Never "completed"
   * unless the owning service returns a completed record synchronously.
   */
  claimableState: ActionLifecycleState;
  /** Why an unsupported operation is unsupported. Always present when false. */
  because?: string;
}

function supported(input: {
  room: string;
  operation: string;
  label: string;
  adapterId: string;
  requiredCapability: Permission;
  consequence: ConsequenceClass;
  boundary: string;
  claimableState: ActionLifecycleState;
}): AdapterCapability {
  return {
    ...input,
    supported: true,
    requiresApproval: needsApproval(input.consequence),
  };
}

function unsupported(input: {
  room: string;
  operation: string;
  label: string;
  requiredCapability: Permission;
  consequence: ConsequenceClass;
  because: string;
}): AdapterCapability {
  return {
    ...input,
    supported: false,
    boundary: "",
    requiresApproval: needsApproval(input.consequence),
    claimableState: "approved",
  };
}

export const ADAPTER_CAPABILITIES: AdapterCapability[] = [
  /* ------------------------------------------------------------- comms */
  supported({
    room: "comms",
    operation: "comms.draft_reply",
    label: "Prepare an unsent draft",
    adapterId: "adapter:comms.draft",
    requiredCapability: "comms.write",
    consequence: "internal_preparation",
    boundary: "commsService.saveDraft — an unsent draft that needs human review",
    claimableState: "routed",
  }),
  unsupported({
    room: "comms",
    operation: "comms.send_message",
    label: "Send a message to a person outside the company",
    requiredCapability: "comms.write",
    consequence: "external",
    because: "Sending leaves the building. A person sends from Comms; the Conductor never does.",
  }),

  /* ---------------------------------------------------------- projects */
  supported({
    room: "projects",
    operation: "projects.record_blocker",
    label: "Record what a project is waiting on",
    adapterId: "adapter:projects.blocker",
    requiredCapability: "projects.write",
    consequence: "internal_change",
    boundary: "projectsService.update — records blockedBecause only",
    claimableState: "routed",
  }),
  unsupported({
    room: "projects",
    operation: "projects.route_work",
    label: "Route work to Ops or Studio",
    requiredCapability: "projects.write",
    consequence: "external",
    because:
      "Routing work to another application is a request a person makes in Projects, with their own authority.",
  }),
  /*
   * An unanswered ask is Projects' own ask, so taking it back is Projects'
   * own act. Withdrawing changes nothing in Ops or Studio: it records that
   * this house is no longer waiting, and the ledger refuses any later
   * acceptance from then on.
   */
  supported({
    room: "projects",
    operation: "projects.withdraw_route",
    label: "Take back an unanswered ask to Ops or Studio",
    adapterId: "adapter:projects.route",
    requiredCapability: "projects.write",
    consequence: "internal_change",
    boundary: "projectsService.withdrawRoute — withdraws this house's own request only",
    claimableState: "routed",
  }),

  /* ------------------------------------------------------------- scout */
  supported({
    room: "scout",
    operation: "scout.start_discovery_run",
    label: "Start a discovery run from an approved brief",
    adapterId: "adapter:scout.discovery",
    requiredCapability: "scout.write",
    consequence: "internal_change",
    boundary: "scoutService.discover — one sourcing pass against the active ICP",
    claimableState: "routed",
  }),
  supported({
    room: "scout",
    operation: "scout.record_fit_correction",
    label: "Record a human fit correction as calibration",
    adapterId: "adapter:scout.feedback",
    requiredCapability: "scout.write",
    consequence: "internal_change",
    boundary: "scoutService.feedback — one calibration row, no ICP rewrite",
    claimableState: "routed",
  }),
  unsupported({
    room: "scout",
    operation: "scout.contact_prospect",
    label: "Contact a prospect",
    requiredCapability: "scout.write",
    consequence: "external",
    because: "Scout never messages anyone. Contact happens in Comms, sent by a person.",
  }),
  unsupported({
    room: "scout",
    operation: "scout.save_icp",
    label: "Change the ICP",
    requiredCapability: "scout.write",
    consequence: "internal_change",
    because:
      "The ICP is targeting truth a person owns. It is edited in Scout's settings, never from outside the room.",
  }),
  unsupported({
    room: "scout",
    operation: "scout.handoff_to_comms",
    label: "Hand a prospect to Comms",
    requiredCapability: "scout.write",
    consequence: "internal_change",
    because:
      "The handoff needs a named contact and a prepared brief, which only Scout's board can assemble today.",
  }),

  /* ----------------------------------------------------------- roadmap */
  supported({
    room: "roadmap",
    operation: "roadmap.create_shell",
    label: "Create a roadmap shell for an approved subject",
    adapterId: "adapter:roadmap.shell",
    requiredCapability: "roadmap.write",
    consequence: "internal_preparation",
    boundary: "roadmapService.create — idempotent per subject, drafts only",
    claimableState: "routed",
  }),
  supported({
    room: "roadmap",
    operation: "roadmap.request_decision",
    label: "Raise a decision request for a person to answer",
    adapterId: "adapter:roadmap.decision",
    requiredCapability: "roadmap.write",
    consequence: "internal_preparation",
    boundary: "roadmapService.addDecision — an open question, never an answer",
    claimableState: "routed",
  }),
  unsupported({
    room: "roadmap",
    operation: "roadmap.resolve_decision",
    label: "Answer a decision",
    requiredCapability: "roadmap.decide",
    consequence: "internal_change",
    because:
      "A decision is a person's word. The Conductor may ask for one; it may never record one.",
  }),
  unsupported({
    room: "roadmap",
    operation: "roadmap.change_sequencing",
    label: "Change approved sequencing",
    requiredCapability: "roadmap.decide",
    consequence: "internal_change",
    because:
      "Approved sequencing is decided truth. Changing it silently would let inference outrank a human decision.",
  }),

  /* ------------------------------------------------- rooms with no path */
  unsupported({
    room: "steward",
    operation: "steward.interpret",
    label: "Interpret a conversation",
    requiredCapability: "steward.write",
    consequence: "internal_change",
    because: "Steward interprets. It holds no executable work for the Conductor to route.",
  }),
  unsupported({
    room: "ops",
    operation: "ops.execute",
    label: "Carry out work in Ops",
    requiredCapability: "ops.read",
    consequence: "external",
    because:
      "Ops is a separate application reached through SSO. It accepts routed work from Projects, not from the Conductor.",
  }),
  unsupported({
    room: "studio",
    operation: "studio.publish",
    label: "Publish an asset",
    requiredCapability: "workspace.read",
    consequence: "external",
    because: "Studio has no execution service yet, so nothing may claim to have been routed to it.",
  }),
];

export function capabilityFor(room: string, operation: string): AdapterCapability | undefined {
  return ADAPTER_CAPABILITIES.find(
    (row) => row.room === room && row.operation === operation,
  );
}

export function isSupportedOperation(room: string, operation: string): boolean {
  return capabilityFor(room, operation)?.supported === true;
}

export function coverageByRoom(): {
  room: string;
  supported: AdapterCapability[];
  unsupported: AdapterCapability[];
}[] {
  const rooms = [...new Set(ADAPTER_CAPABILITIES.map((row) => row.room))];
  return rooms.map((room) => {
    const rows = ADAPTER_CAPABILITIES.filter((row) => row.room === room);
    return {
      room,
      supported: rows.filter((row) => row.supported),
      unsupported: rows.filter((row) => !row.supported),
    };
  });
}

/** "What can you actually do right now?", answered without guessing. */
export function describeCoverage(access?: { can: (permission: string) => boolean }): string {
  const usable = ADAPTER_CAPABILITIES.filter(
    (row) => row.supported && (!access || access.can(row.requiredCapability)),
  );
  if (usable.length === 0) {
    return "Nothing can be routed right now: no adapter is available to you.";
  }
  const rooms = [...new Set(usable.map((row) => row.room))];
  return `${usable.length} bounded operations across ${rooms.join(", ")}. Everything else is prepared for a person, never carried out.`;
}
