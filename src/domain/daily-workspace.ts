/**
 * The daily workspace: one familiar list of what a person should do next.
 *
 * Home is the personal entry. The client workspace is the continuity. Conductor
 * is optional. Nobody has to tour every room to find their next task.
 *
 * This module decides what appears, in what order, with whose name on it and
 * what the one next action is. It never invents a colleague, never grants
 * anyone a permission they do not already hold, and never shows a number that
 * has not actually been measured.
 */

import type { ID, ISODateTime } from "./entities";

/* ------------------------------------------------------------- people */

/** The only roles the workspace recognises; each comes from a real membership. */
export type WorkspaceRole = "owner" | "admin" | "member";

export interface MembershipRecord {
  userId: ID;
  organizationId: ID;
  role: WorkspaceRole;
  active: boolean;
  displayName: string;
}

export interface WorkspacePerson {
  userId: ID;
  displayName: string;
  role: WorkspaceRole;
}

/**
 * People come from recorded memberships only. An inactive membership is not a
 * colleague, and nobody is added because a task mentions a name.
 */
export function peopleFromMemberships(
  memberships: MembershipRecord[],
  organizationId: ID,
): WorkspacePerson[] {
  return memberships
    .filter((row) => row.organizationId === organizationId && row.active)
    .map((row) => ({ userId: row.userId, displayName: row.displayName, role: row.role }));
}

/* -------------------------------------------------------------- verbs */

export const WORKSPACE_VERBS = ["Open", "Review", "Edit", "Approve", "Assign", "Done"] as const;

export type WorkspaceVerb = (typeof WORKSPACE_VERBS)[number];

export function isWorkspaceVerb(candidate: string): candidate is WorkspaceVerb {
  return (WORKSPACE_VERBS as readonly string[]).includes(candidate);
}

/* --------------------------------------------------------- work items */

export type WorkGroup = "my_next_actions" | "prepared_for_you" | "decisions_needed";

export const WORK_GROUP_ORDER: WorkGroup[] = [
  "my_next_actions",
  "prepared_for_you",
  "decisions_needed",
];

export const WORK_GROUP_LABEL: Record<WorkGroup, string> = {
  my_next_actions: "My next actions",
  prepared_for_you: "Prepared for you",
  decisions_needed: "Decisions needed",
};

export const WORK_GROUP_EMPTY_STATE: Record<WorkGroup, string> = {
  my_next_actions: "Nothing is waiting on you. Open a client to pick up the next piece of work.",
  prepared_for_you: "Nothing has been prepared yet. Preparation appears here once a conversation or milestone is recorded.",
  decisions_needed: "No decision is waiting on you.",
};

export interface WorkItemSource {
  /** Which room owns this work. The workspace never writes it itself. */
  owningApp: string;
  /** A route in that room. Every item must be openable. */
  href: string;
  label: string;
}

/** How an item's ownership actually stands. Never guessed, never hidden. */
export type WorkOwnership =
  /** A current active member owns it. */
  | "assigned"
  /** Nobody owns it. The obligation is real; the owner is missing. */
  | "unassigned"
  /** The person who owned it is no longer an active member here. */
  | "owner_departed";

export interface WorkItem {
  id: string;
  group: WorkGroup;
  title: string;
  /** Why this is here, in plain words. Never empty. */
  because: string;
  /** Empty when nobody owns it. An empty owner never removes the work. */
  ownerId: ID;
  ownerName: string;
  ownership: WorkOwnership;
  verb: WorkVerbAction;
  source: WorkItemSource;
  /** Preparation detail, collapsed by default. */
  preparedDetail?: string;
  dueAt?: ISODateTime;
  updatedAt: ISODateTime;
}

export interface WorkVerbAction {
  verb: WorkspaceVerb;
  href: string;
}

export interface WorkItemDraft extends Omit<WorkItem, "group" | "ownership"> {
  group: WorkGroup;
  /** Optional: the caller states what it knows, the rule decides. */
  ownership?: WorkOwnership;
}

export interface WorkItemRejection {
  id: string;
  because: string;
}

/**
 * Where a row may send somebody. A destination is only accepted when it is a
 * path inside this app: a leading slash is not enough, because "//evil.example"
 * and "/\evil.example" are both browser-valid ways out of it.
 */
export const ALLOWED_ROUTE_ROOTS = ["/modules/", "/settings/", "/clients/", "/approvals"] as const;

export function isInternalRoute(href: string): boolean {
  if (!href.startsWith("/")) return false;
  if (href.startsWith("//") || href.startsWith("/\\")) return false;
  if (href.includes("\\")) return false;
  // A scheme or an authority anywhere before the first slash is a way out.
  if (/^\/[^/]*:/.test(href)) return false;
  if (href === "/") return true;
  return ALLOWED_ROUTE_ROOTS.some((root) => href.startsWith(root));
}

/**
 * Accept an item onto the workspace when it can be acted on: a reason, a known
 * verb and a route into the owning room.
 *
 * Ownership is read, not demanded. Work nobody owns, and work whose owner has
 * left, is real work and stays visible as an exception for somebody to assign.
 * Hiding it would quietly drop a business obligation. A name that no longer
 * matches the membership is corrected from the membership, because the stable
 * id is the person and the name is only how they are written today.
 */
export function admitWorkItem(input: {
  item: WorkItemDraft;
  people: WorkspacePerson[];
}): { admitted: true; item: WorkItem } | { admitted: false; rejection: WorkItemRejection } {
  const { item } = input;
  const reject = (because: string) => ({
    admitted: false as const,
    rejection: { id: item.id, because },
  });

  if (!item.because.trim()) return reject("No reason was recorded for showing this.");
  if (!isWorkspaceVerb(item.verb.verb)) {
    return reject("The action is not one of the workspace verbs.");
  }
  if (!isInternalRoute(item.verb.href) || !isInternalRoute(item.source.href)) {
    return reject("The item does not open anywhere in the app.");
  }

  const owner = item.ownerId
    ? input.people.find((person) => person.userId === item.ownerId)
    : undefined;

  if (!item.ownerId) {
    return {
      admitted: true,
      item: { ...item, ownership: "unassigned", ownerName: "Nobody yet" },
    };
  }
  if (!owner) {
    return {
      admitted: true,
      item: {
        ...item,
        ownership: "owner_departed",
        ownerName: item.ownerName || "A former member",
      },
    };
  }
  // The membership is the source of the name, so a rename never drops work.
  return {
    admitted: true,
    item: { ...item, ownership: "assigned", ownerName: owner.displayName },
  };
}

export interface WorkspaceList {
  group: WorkGroup;
  label: string;
  items: WorkItem[];
  emptyState: string;
}

/** Who may pick up work nobody owns. Not a new permission: the existing one. */
export function mayResolveOwnership(role: WorkspaceRole): boolean {
  return role === "owner" || role === "admin";
}

export const OWNERSHIP_EXCEPTION_LABEL = "Needs an owner";

function byWhenItMatters(a: WorkItem, b: WorkItem): number {
  if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
  if (a.dueAt) return -1;
  if (b.dueAt) return 1;
  return b.updatedAt.localeCompare(a.updatedAt);
}

/**
 * Same three lists, same order, every day. Newest movement first, with a due
 * date ahead of anything undated.
 *
 * The personal view is genuinely personal: it holds what this person owns,
 * including work prepared for them. Prepared work owned by somebody else is
 * that person's to read, not everybody's, so it is not shown here merely
 * because of the group it is in. A lead may also ask for the team view, and
 * only a lead gets one.
 */
export function buildWorkspace(input: {
  items: (WorkItem | WorkItemDraft)[];
  people: WorkspacePerson[];
  viewerId: ID;
  viewerRole?: WorkspaceRole;
  /** "personal" is the default. "team" is refused to anyone who may not. */
  view?: "personal" | "team";
}): {
  lists: WorkspaceList[];
  rejected: WorkItemRejection[];
  /** Work with no current owner, for whoever may assign it. */
  exceptions: WorkItem[];
  view: "personal" | "team";
  viewRefusedBecause?: string;
} {
  const rejected: WorkItemRejection[] = [];
  const admitted: WorkItem[] = [];

  for (const item of input.items) {
    const result = admitWorkItem({ item, people: input.people });
    if (result.admitted) admitted.push(result.item);
    else rejected.push(result.rejection);
  }

  const role = input.viewerRole ?? "member";
  const mayLead = mayResolveOwnership(role);
  const askedForTeam = input.view === "team";
  const view: "personal" | "team" = askedForTeam && mayLead ? "team" : "personal";

  const visible =
    view === "team"
      ? admitted
      : admitted.filter((entry) => entry.ownership === "assigned" && entry.ownerId === input.viewerId);

  const lists = WORK_GROUP_ORDER.map((group) => ({
    group,
    label: WORK_GROUP_LABEL[group],
    emptyState: WORK_GROUP_EMPTY_STATE[group],
    items: visible.filter((entry) => entry.group === group).sort(byWhenItMatters),
  }));

  // Unowned work never disappears; it is simply nobody's until somebody says.
  const exceptions = mayLead
    ? admitted.filter((entry) => entry.ownership !== "assigned").sort(byWhenItMatters)
    : [];

  return {
    lists,
    rejected,
    exceptions,
    view,
    ...(askedForTeam && !mayLead
      ? { viewRefusedBecause: "Only an owner or admin can see the whole team's work." }
      : {}),
  };
}


/* ----------------------------------------------------- steward links */

export interface StewardRecommendation {
  id: string;
  text: string;
  evidenceRefs: string[];
  ownerId: ID;
}

export type StewardDisplay =
  | { shown: true; recommendation: StewardRecommendation; ownerName: string }
  | { shown: false; because: string };

/** A recommendation without evidence and a current owner is not shown. */
export function stewardDisplay(input: {
  recommendation: StewardRecommendation;
  people: WorkspacePerson[];
}): StewardDisplay {
  if (input.recommendation.evidenceRefs.length === 0) {
    return { shown: false, because: "There is no evidence behind this, so it is not shown." };
  }
  const owner = input.people.find((person) => person.userId === input.recommendation.ownerId);
  if (!owner) {
    return { shown: false, because: "There is no current owner for this, so it is not shown." };
  }
  return { shown: true, recommendation: input.recommendation, ownerName: owner.displayName };
}

/* ------------------------------------------------------------ pulse */

export interface MeasureReading {
  key: string;
  label: string;
  /** Null means nothing was measured. It is never rendered as nought. */
  value: number | null;
  /** What the figure is out of. Required for a share or a rate. */
  denominator: { of: number; describes: string } | null;
  measuredAt: ISODateTime | null;
  unit: string;
}

export type MeasureDisplay =
  | {
      shown: true;
      label: string;
      value: number;
      unit: string;
      denominatorNote: string | null;
      freshnessNote: string;
    }
  | { shown: false; label: string; because: string };

/** Show a measure only where it was measured, with its freshness and its base. */
export function measureDisplay(input: {
  reading: MeasureReading;
  now: ISODateTime;
  staleAfterHours?: number;
}): MeasureDisplay {
  const { reading } = input;
  if (reading.value === null || reading.measuredAt === null) {
    return { shown: false, label: reading.label, because: "Not measured yet." };
  }
  if (reading.unit === "share" && reading.denominator === null) {
    return {
      shown: false,
      label: reading.label,
      because: "We cannot say what this is out of, so it is not shown.",
    };
  }
  const ageHours =
    (Date.parse(input.now) - Date.parse(reading.measuredAt)) / 3_600_000;
  const staleAfter = input.staleAfterHours ?? 24;
  return {
    shown: true,
    label: reading.label,
    value: reading.value,
    unit: reading.unit,
    denominatorNote: reading.denominator
      ? `Out of ${reading.denominator.of} ${reading.denominator.describes}.`
      : null,
    freshnessNote:
      ageHours > staleAfter
        ? `Last measured ${reading.measuredAt.slice(0, 10)}, which is out of date.`
        : `Measured ${reading.measuredAt.slice(0, 10)}.`,
  };
}

/* -------------------------------------------------------- conductor */

export interface ConductorAnswer {
  text: string;
  sources: { label: string; href: string }[];
}

export interface ConductorPreparedAction {
  /** The room that owns the change. Conductor never writes across rooms. */
  owningApp: string;
  /** The route where a person carries it out. */
  href: string;
  summary: string;
  /** Always true. Conductor prepares; people act. */
  needsPersonToCarryOut: true;
}

export type ConductorReply =
  | { answered: true; answer: ConductorAnswer; prepared: ConductorPreparedAction[] }
  | { answered: false; because: string };

/**
 * Conductor answers from sources or says it cannot. Nothing a question asks for
 * grants authority, and every prepared action is handed to its owning room.
 */
export function conductorReply(input: {
  answer: ConductorAnswer;
  prepared: Omit<ConductorPreparedAction, "needsPersonToCarryOut">[];
  /** Rooms the asking person may already act in. */
  permittedApps: string[];
}): ConductorReply {
  if (input.answer.sources.length === 0) {
    return {
      answered: false,
      because: "There is nothing recorded to answer this from, so no answer is given.",
    };
  }
  const prepared = input.prepared
    .filter((action) => input.permittedApps.includes(action.owningApp))
    .map((action) => ({ ...action, needsPersonToCarryOut: true as const }));
  return { answered: true, answer: input.answer, prepared };
}

/* -------------------------------------------------------- approvals */

export interface ApprovalPolicy {
  decisionKey: string;
  /** Roles already permitted to decide this, as recorded today. */
  permittedRoles: WorkspaceRole[];
  /** Whether a lead may take it under an existing routine allowance. */
  routineForLeads: boolean;
}

export type ApprovalRouting =
  | { routed: true; toRoles: WorkspaceRole[]; because: string }
  | { routed: false; because: string };

/** Route only inside the policy as it already stands. Nothing is widened here. */
export function routeApproval(input: {
  decisionKey: string;
  policies: ApprovalPolicy[];
}): ApprovalRouting {
  const policy = input.policies.find((row) => row.decisionKey === input.decisionKey);
  if (!policy) {
    return {
      routed: false,
      because: "There is no recorded policy for this decision, so it is not routed anywhere.",
    };
  }
  if (policy.permittedRoles.length === 0) {
    return { routed: false, because: "No role is permitted to take this decision yet." };
  }
  return {
    routed: true,
    toRoles: policy.permittedRoles,
    because: policy.routineForLeads
      ? "This is already a routine decision for a lead."
      : "Routed to the roles already permitted to decide it.",
  };
}

export interface DelegationPolicyProposal {
  decisionKey: string;
  proposedRoles: WorkspaceRole[];
  /** Always false. An admin enables it later, explicitly. */
  enabled: false;
  because: string;
}

/**
 * Prepare a delegation for an admin to consider. Preparing it changes nothing,
 * and the Comms owner or admin rule is never touched from here.
 */
export function prepareDelegationPolicy(input: {
  decisionKey: string;
  proposedRoles: WorkspaceRole[];
  because: string;
}): { prepared: true; proposal: DelegationPolicyProposal } | { prepared: false; because: string } {
  if (input.decisionKey.startsWith("comms.")) {
    return {
      prepared: false,
      because: "Comms approval stays with its owner and admin rule, so no delegation is prepared.",
    };
  }
  if (input.proposedRoles.length === 0) {
    return { prepared: false, because: "No role was proposed." };
  }
  return {
    prepared: true,
    proposal: {
      decisionKey: input.decisionKey,
      proposedRoles: input.proposedRoles,
      enabled: false,
      because: input.because,
    },
  };
}
