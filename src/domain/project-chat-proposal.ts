/**
 * Chat is how a person talks to the project. Projects remains where project
 * truth lives.
 *
 * This module is the whole law of that sentence. A conversational message can
 * only ever prepare a bounded proposal: it names the field, the store that
 * owns it, the value today and the value being proposed. Nothing is written
 * until a person approves, and the write itself still goes through the same
 * Projects service, the same `checkDetailEdit` and `checkTransition` refusals,
 * as the Manage panel and the inline rename. Chat is a doorway, never a second
 * mutation path and never a second store.
 *
 * A proposal is session scoped. The durable truth is the resulting project row
 * and its activity event, never the proposal object.
 */

import {
  agreedDayToIso,
  checkDetailEdit,
  checkTransition,
  type ExecutionProject,
  type ExecutionState,
} from "./projects";
import { syncStateFor, type ThinkingSourceInput, type ThinkingSourceType } from "./project-intelligence";

/** The bounded set of project-owned changes Chat may prepare. */
export type ChatProposalAction =
  | "name"
  | "point_a"
  | "point_b"
  | "due_date"
  | "owner"
  | "next_move"
  | "waiting_on"
  | "block"
  | "delivery_items"
  | "link_source";

/** The field a person recognises, and the store that actually owns it. */
export const CHAT_ACTION_FIELD: Record<ChatProposalAction, { label: string; store: string }> = {
  name: { label: "Project name", store: "projects.name" },
  point_a: { label: "Point A, where this is now", store: "projects.point_a" },
  point_b: { label: "Point B, the agreed destination", store: "projects.point_b" },
  due_date: { label: "Agreed date", store: "projects.due_date" },
  owner: { label: "Owner", store: "projects.owner" },
  next_move: { label: "Next move", store: "projects.next_move" },
  waiting_on: { label: "Waiting on", store: "projects.waiting_on" },
  block: { label: "Blocked because", store: "projects.state + blocked_because" },
  delivery_items: { label: "Delivery items", store: "projects.delivery_items" },
  link_source: { label: "Project sources", store: "project_thinking_sources" },
};

/** Truth Projects does not own. Named, with the room that does own it. */
export type OtherRoom = "clients" | "roadmap" | "comms" | "commercial";

export const OTHER_ROOM_TRUTH: Record<
  OtherRoom,
  { room: string; because: string; to: string | null }
> = {
  clients: {
    room: "Clients",
    because:
      "The company a project serves, and moving delivery between companies, is Clients truth.",
    to: "/modules/clients",
  },
  roadmap: {
    room: "Roadmap",
    because:
      "The roadmap and milestone this work came from is Roadmap truth. Rewriting lineage here would hide where the decision came from.",
    to: "/modules/roadmap",
  },
  comms: {
    room: "Comms",
    because: "Messages are Comms truth, and only a person sends one, in Comms.",
    to: "/modules/comms",
  },
  commercial: {
    room: "Clients",
    because:
      "Tier, proposal and commercial amounts are commercial truth, recorded on the client, not in a project chat.",
    to: "/modules/clients",
  },
};

/** What the model may hand back after reading a message. Nothing here writes. */
export interface ChatChangeIntent {
  action: ChatProposalAction;
  /** The proposed value in plain text. "" means clear, where clearing is legal. */
  value?: string;
  /** Delivery items, one per line, when the action is delivery_items. */
  items?: string[];
  /** A source to link, when the action is link_source. */
  source?: { title?: string; url?: string; sourceType?: string };
  /** A workspace member to hand the work to. Never a free text name. */
  owner?: { userId: string; label: string };
  /** The person's own words for why. */
  reason?: string;
}

export interface ChatProposal {
  /** Session scoped. Never persisted. */
  id: string;
  action: ChatProposalAction;
  fieldLabel: string;
  store: string;
  owningRoom: "Projects";
  /** What the record says right now, read at prepare time. */
  currentValue: string;
  /** What would be recorded instead. */
  proposedValue: string;
  reason: string;
  /** Provenance for the change: the message it came from. */
  fromMessage: string;
  /** The exact changes handed to the Projects service on approval. */
  changes: ProjectChatChanges | null;
  /** The source handed to the Projects source path on approval. */
  source: ThinkingSourceInput | null;
  note?: string;
}

/** The shape the Projects service already accepts. Chat adds nothing to it. */
export interface ProjectChatChanges {
  name?: string;
  pointA?: string;
  pointB?: string;
  dueDate?: string;
  ownerUserId?: string;
  ownerLabel?: string;
  nextMove?: string;
  waitingOn?: string;
  state?: ExecutionState;
  blockedBecause?: string;
  deliveryItems?: { label: string; done: boolean }[];
}

export type PrepareResult =
  | { ok: true; proposal: ChatProposal }
  | { ok: false; because: string; room?: OtherRoom };

const SOURCE_TYPES: ThinkingSourceType[] = ["chatgpt", "claude", "google_doc", "notion", "other"];

function dayOf(iso: string | undefined): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

/** What the record says today for the field a proposal touches. */
export function currentValueFor(project: ExecutionProject, action: ChatProposalAction): string {
  switch (action) {
    case "name":
      return project.name;
    case "point_a":
      return project.pointA;
    case "point_b":
      return project.pointB;
    case "due_date":
      return dayOf(project.dueDate);
    case "owner":
      return project.ownerLabel ?? "";
    case "next_move":
      return project.nextMove ?? "";
    case "waiting_on":
      return project.waitingOn ?? "";
    case "block":
      return project.state === "blocked" ? project.blockedBecause?.trim() || "Blocked" : "";
    case "delivery_items":
      return (project.deliveryItems ?? []).map((item) => item.label).join("\n");
    case "link_source":
      return "";
  }
}

/**
 * Turn an understood message into a bounded proposal, or refuse it in the same
 * words the Manage panel would use. Pure: the panel, the inline edit and Chat
 * cannot disagree about what is legal.
 */
export function prepareProposal(
  project: ExecutionProject,
  intent: ChatChangeIntent,
  fromMessage: string,
): PrepareResult {
  const action = intent.action;
  const field = CHAT_ACTION_FIELD[action];
  if (!field) return { ok: false, because: "That is not a change this project can make." };

  const reason = (intent.reason ?? "").trim() || fromMessage.trim();
  const current = currentValueFor(project, action);
  const raw = (intent.value ?? "").trim();

  let proposedValue = raw;
  let changes: ProjectChatChanges | null = null;
  let source: ThinkingSourceInput | null = null;
  let note: string | undefined;

  if (action === "link_source") {
    const url = (intent.source?.url ?? "").trim();
    const title = (intent.source?.title ?? "").trim();
    if (!url) {
      return {
        ok: false,
        because: "Give the link to add, and a title people will recognise it by.",
      };
    }
    const typed = (intent.source?.sourceType ?? "other") as ThinkingSourceType;
    const sourceType = SOURCE_TYPES.includes(typed) ? typed : "other";
    source = { sourceType, title: title || url, url };
    proposedValue = `${source.title} · ${url}`;
    note =
      syncStateFor(sourceType) === "import_needs_upload"
        ? "The link is saved. A private assistant transcript cannot be read from a URL, so nothing is imported from it until someone pastes or uploads the text."
        : "The link is saved as a project source. Nothing is read from it yet.";
  } else if (action === "delivery_items") {
    const items = (intent.items ?? [])
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter((line) => line.length > 0);
    if (items.length === 0) {
      return { ok: false, because: "Say what the delivery items should be." };
    }
    const done = new Set((project.deliveryItems ?? []).filter((i) => i.done).map((i) => i.label));
    changes = { deliveryItems: items.map((label) => ({ label, done: done.has(label) })) };
    proposedValue = items.join("\n");
  } else if (action === "owner") {
    const owner = intent.owner;
    if (!owner?.userId) {
      return {
        ok: false,
        because:
          "Name a member of this workspace to hand it to. Projects records an owner, not a typed name.",
      };
    }
    changes = { ownerUserId: owner.userId, ownerLabel: owner.label };
    proposedValue = owner.label;
  } else if (action === "block") {
    if (!raw) {
      return { ok: false, because: "Say what is blocking it. A block nobody named cannot be cleared." };
    }
    const check = checkTransition(project, "blocked", { blockedBecause: raw });
    if (!check.ok) return { ok: false, because: check.because };
    changes = { state: "blocked", blockedBecause: raw };
  } else if (action === "waiting_on") {
    changes = { waitingOn: raw };
    if (!raw) proposedValue = "";
  } else if (action === "next_move") {
    if (!raw) return { ok: false, because: "Say what the next move is." };
    changes = { nextMove: raw };
  } else if (action === "due_date") {
    const iso = raw ? agreedDayToIso(raw.slice(0, 10)) : "";
    const check = checkDetailEdit(project, { dueDate: iso });
    if (!check.ok) return { ok: false, because: check.because };
    changes = { dueDate: iso };
    proposedValue = raw ? raw.slice(0, 10) : "";
  } else {
    const key = action === "name" ? "name" : action === "point_a" ? "pointA" : "pointB";
    const edit = { [key]: raw } as { name?: string; pointA?: string; pointB?: string };
    const check = checkDetailEdit(project, edit);
    if (!check.ok) return { ok: false, because: check.because };
    changes = edit;
  }

  if (action !== "link_source" && proposedValue === current) {
    return {
      ok: false,
      because: `${field.label} already says that. Nothing to change.`,
    };
  }

  return {
    ok: true,
    proposal: {
      id: `chat-proposal-${Math.random().toString(36).slice(2, 10)}`,
      action,
      fieldLabel: field.label,
      store: field.store,
      owningRoom: "Projects",
      currentValue: current,
      proposedValue,
      reason,
      fromMessage,
      changes,
      source,
      ...(note ? { note } : {}),
    },
  };
}

/**
 * Fail closed on stale truth. If the record moved since the proposal was
 * prepared, the person is asked to look again rather than having newer truth
 * silently overwritten by an older reading.
 */
export function staleReason(proposal: ChatProposal, project: ExecutionProject): string | null {
  if (proposal.action === "link_source") return null;
  const now = currentValueFor(project, proposal.action);
  if (now === proposal.currentValue) return null;
  if (now === proposal.proposedValue) return null;
  return `${proposal.fieldLabel} changed since this was prepared. It now says "${now || "nothing"}". Ask again so the change is made against what is true now.`;
}

/**
 * Replay safety. A second approval of the same proposal must not record a
 * second semantic change, so an already-true proposal reports itself done.
 */
export function alreadyApplied(proposal: ChatProposal, project: ExecutionProject): boolean {
  if (proposal.action === "link_source") return false;
  return currentValueFor(project, proposal.action) === proposal.proposedValue;
}

/** The receipt a person reads after a write lands. Never claimed before it does. */
export function receiptFor(proposal: ChatProposal): string {
  if (proposal.action === "link_source") return "Added as a project source. It shows in Context.";
  return `${proposal.fieldLabel} updated in Projects. The change is on the record and in activity.`;
}
