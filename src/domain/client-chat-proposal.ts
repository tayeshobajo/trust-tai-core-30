/**
 * Client Chat is how a person talks to the account. Clients remains where
 * account truth is composed, and the owning services remain where it is
 * written.
 *
 * This module is the whole law of that sentence. A conversational message may
 * only ever prepare a bounded proposal against account-owned commercial truth:
 * the field, the store that owns it, the value today, the value proposed and
 * the person's own reason. Nothing is written until a person approves, and the
 * write still goes through `setClientCommercialState`, the same service and the
 * same refusals as the Commercial panel. Chat is a doorway, never a second
 * mutation path and never a second store.
 *
 * Everything else fails closed by name: project execution, roadmap lineage,
 * sending a message, uploading a file, tier moves that recognise revenue.
 *
 * A proposal is session scoped. The durable truth is the client row and its
 * activity event, never the proposal object.
 */

import type { CommercialFormPatch } from "./client-commercial-form";
import { readMoneyCents } from "./client-commercial-form";

/** The bounded set of account-owned changes Client Chat may prepare. */
export type ClientChatAction = "mrr" | "renewal_date" | "next_review_date";

export const CLIENT_CHAT_ACTIONS: ClientChatAction[] = ["mrr", "renewal_date", "next_review_date"];

/** The field a person recognises, and the store that actually owns it. */
export const CLIENT_CHAT_FIELD: Record<ClientChatAction, { label: string; store: string }> = {
  mrr: { label: "Monthly recurring amount", store: "clients.mrr_cents" },
  renewal_date: { label: "Renewal date", store: "clients.renewal_at" },
  next_review_date: { label: "Next review date", store: "clients.next_review_at" },
};

/** Truth the account does not own. Named, with the room that does own it. */
export type ClientOtherRoom = "projects" | "roadmap" | "comms" | "website" | "commercial_panel";

export const CLIENT_OTHER_ROOM: Record<
  ClientOtherRoom,
  { room: string; because: string; to: string | null }
> = {
  projects: {
    room: "Projects",
    because:
      "Delivery work, milestones, blockers and decisions are operated in the project workspace, not on the account.",
    to: "/modules/projects",
  },
  roadmap: {
    room: "Roadmap",
    because: "Point B, stages and milestones are Roadmap truth. The account only reads them.",
    to: "/modules/roadmap",
  },
  comms: {
    room: "Comms",
    because: "Messages are Comms truth, and only a person sends one, in Comms.",
    to: "/modules/comms",
  },
  website: {
    room: "Website",
    because: "Site records and technical site work belong to the Website room.",
    to: "/modules/website",
  },
  commercial_panel: {
    room: "Commercial",
    because:
      "A tier move can recognise revenue, so it is made on the Commercial tab where the phase amount is asked for. Chat will not move a tier.",
    to: null,
  },
};

/** What the model may hand back after reading a message. Nothing here writes. */
export interface ClientChangeIntent {
  action: ClientChatAction;
  /** The proposed value in plain text. "" means clear, where clearing is legal. */
  value?: string;
  /** The person's own words for why. */
  reason?: string;
}

export interface ClientChatProposal {
  /** Session scoped. Never persisted. */
  id: string;
  action: ClientChatAction;
  fieldLabel: string;
  store: string;
  owningRoom: "Commercial";
  currentValue: string;
  proposedValue: string;
  reason: string;
  /** Provenance for the change: the message it came from. */
  fromMessage: string;
  /** The exact patch handed to the commercial service on approval. */
  patch: CommercialFormPatch;
}

export interface ClientCommercialNow {
  mrrCents: number | null;
  renewalAt: string | null;
  nextReviewAt: string | null;
}

export type ClientProposalResult =
  | { ok: true; proposal: ClientChatProposal }
  | { ok: false; because: string; room?: ClientOtherRoom };

/** The shortest reason that still means something. Mirrors the panel's rule. */
export const MIN_CLIENT_CHAT_REASON = 4;

function money(cents: number | null): string {
  if (cents === null) return "Not recorded";
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}/mo`;
}

function day(value: string | null): string {
  return value ? value.slice(0, 10) : "Not recorded";
}

function readDay(value: string): string | null | false {
  const text = value.trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? false : text;
}

function id(): string {
  return `client-proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Turn one read message into a bounded proposal, or refuse it in plain words.
 * Nothing here writes, and an action outside the bounded set never becomes a
 * proposal at all.
 */
export function prepareClientProposal(
  now: ClientCommercialNow,
  intent: ClientChangeIntent,
  fromMessage: string,
): ClientProposalResult {
  if (!CLIENT_CHAT_ACTIONS.includes(intent.action)) {
    return {
      ok: false,
      because: "That is not a change the account can make from here.",
    };
  }
  const reason = (intent.reason ?? "").trim();
  if (reason.length < MIN_CLIENT_CHAT_REASON) {
    return {
      ok: false,
      because: "Say why this is true, so the record keeps the reason with the change.",
    };
  }

  const field = CLIENT_CHAT_FIELD[intent.action];
  const raw = (intent.value ?? "").trim();

  if (intent.action === "mrr") {
    const parsed = readMoneyCents(raw);
    if (!parsed.ok) {
      return { ok: false, because: "Say the monthly amount as a number, like 3500." };
    }
    if (parsed.cents === now.mrrCents) {
      return { ok: false, because: "The record already says that. Nothing would change." };
    }
    return {
      ok: true,
      proposal: {
        id: id(),
        action: intent.action,
        fieldLabel: field.label,
        store: field.store,
        owningRoom: "Commercial",
        currentValue: money(now.mrrCents),
        proposedValue: money(parsed.cents),
        reason,
        fromMessage,
        patch: { mrrCents: parsed.cents, because: reason },
      },
    };
  }

  const parsedDay = readDay(raw);
  if (parsedDay === false) {
    return { ok: false, because: "Say the date as a real day, like 2026-10-03." };
  }
  const current = intent.action === "renewal_date" ? now.renewalAt : now.nextReviewAt;
  if (day(current) === (parsedDay ?? "Not recorded")) {
    return { ok: false, because: "The record already says that. Nothing would change." };
  }
  return {
    ok: true,
    proposal: {
      id: id(),
      action: intent.action,
      fieldLabel: field.label,
      store: field.store,
      owningRoom: "Commercial",
      currentValue: day(current),
      proposedValue: parsedDay ?? "Cleared",
      reason,
      fromMessage,
      patch:
        intent.action === "renewal_date"
          ? { renewalAt: parsedDay, because: reason }
          : { nextReviewAt: parsedDay, because: reason },
    },
  };
}

/**
 * A proposal prepared against truth that has since moved is refused rather
 * than written over. Returns the plain reason, or null when it still holds.
 */
export function clientProposalStale(
  proposal: ClientChatProposal,
  fresh: ClientCommercialNow,
): string | null {
  const said =
    proposal.action === "mrr"
      ? money(fresh.mrrCents)
      : proposal.action === "renewal_date"
        ? day(fresh.renewalAt)
        : day(fresh.nextReviewAt);
  if (said === proposal.currentValue) return null;
  if (said === proposal.proposedValue) return null;
  return `This was prepared when the record said "${proposal.currentValue}". It now says "${said}", so nothing was written.`;
}

/** True when the record already says what was proposed, so nothing is written twice. */
export function clientProposalAlreadyApplied(
  proposal: ClientChatProposal,
  fresh: ClientCommercialNow,
): boolean {
  const said =
    proposal.action === "mrr"
      ? money(fresh.mrrCents)
      : proposal.action === "renewal_date"
        ? day(fresh.renewalAt)
        : day(fresh.nextReviewAt);
  return said === proposal.proposedValue;
}

/** The plain receipt a person reads after their own approval was recorded. */
export function clientProposalReceipt(proposal: ClientChatProposal): string {
  return `Recorded on the client: ${proposal.fieldLabel} is now ${proposal.proposedValue}.`;
}
