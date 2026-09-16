/**
 * Getting a client ready to start, and opening the workspace once they are.
 *
 * The checklist is the same every time, so the team learns it once: confirmed
 * scope, the commercial prerequisites, the access we need, who is responsible,
 * the kickoff and the first milestone.
 *
 * Two rules matter most:
 *
 * 1. Access is recorded as a pointer to where the credential lives. Never the
 *    credential itself, and never pasted into a conversation.
 * 2. A missing prerequisite blocks the start. It can only be passed with an
 *    exception a named, authorised person wrote down and explained.
 */

import type { AgreementRecord, PaymentRecord } from "./agreement-state";
import type { ID, ISODateTime } from "./entities";

export type ChecklistKey =
  | "scope_confirmed"
  | "commercial_prerequisites"
  | "access_needs"
  | "responsible_people"
  | "kickoff"
  | "first_milestone";

export const CHECKLIST_ORDER: ChecklistKey[] = [
  "scope_confirmed",
  "commercial_prerequisites",
  "access_needs",
  "responsible_people",
  "kickoff",
  "first_milestone",
];

export const CHECKLIST_LABEL: Record<ChecklistKey, string> = {
  scope_confirmed: "Confirmed scope",
  commercial_prerequisites: "Commercial prerequisites",
  access_needs: "Access we need",
  responsible_people: "Who is responsible",
  kickoff: "Kickoff",
  first_milestone: "First milestone",
};

export interface Exception {
  by: ID;
  /** Only an owner or an admin may write one. */
  role: "owner" | "admin" | "member";
  reason: string;
  at: ISODateTime;
}

export interface ChecklistItem {
  key: ChecklistKey;
  met: boolean;
  detail: string;
  exception?: Exception;
}

export interface ChecklistState {
  clientRef: string;
  items: ChecklistItem[];
}

/* ------------------------------------------------------- access, safely */

/** A pointer to where a credential lives, never the credential. */
export interface SecureReference {
  /** For example a password manager or a secret store. */
  store: string;
  itemRef: string;
  requestedBy: ID;
}

const CREDENTIAL_SHAPES = [
  /password\s*[:=]/i,
  /\bapi[_ -]?key\b/i,
  /\bsecret\b\s*[:=]/i,
  /\bbearer\s+[A-Za-z0-9._-]{12,}/i,
  /sk-[A-Za-z0-9]{12,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

export type AccessOutcome =
  | { accepted: true; reference: SecureReference }
  | { accepted: false; because: string };

/** Refuse anything that looks like a credential rather than a pointer to one. */
export function recordAccessNeed(input: {
  store: string;
  itemRef: string;
  requestedBy: ID;
  note?: string;
}): AccessOutcome {
  const text = `${input.store} ${input.itemRef} ${input.note ?? ""}`;
  if (CREDENTIAL_SHAPES.some((shape) => shape.test(text))) {
    return {
      accepted: false,
      because: "Do not put a credential here. Record where it is kept instead.",
    };
  }
  if (!input.store.trim() || !input.itemRef.trim()) {
    return { accepted: false, because: "Say which store holds it, and which item." };
  }
  return {
    accepted: true,
    reference: { store: input.store, itemRef: input.itemRef, requestedBy: input.requestedBy },
  };
}

/* ---------------------------------------------------------- prerequisites */

export interface ReadinessOutcome {
  ready: boolean;
  /** Plain words for anything still in the way. */
  blocking: string[];
  /** Items allowed through on a written exception, named so nobody forgets. */
  passedOnException: string[];
}

/**
 * Commercial prerequisites read from the agreement and the money. Neither is
 * inferred: an unavailable payment reading blocks, it does not pass.
 */
export function commercialPrerequisites(input: {
  agreement: AgreementRecord;
  payment: PaymentRecord;
}): string[] {
  const blocking: string[] = [];
  if (input.agreement.stage !== "client_accepted") {
    blocking.push("The client has not accepted the agreement yet.");
  }
  if (input.payment.stage === "unknown") {
    blocking.push("The payment status could not be read, so it is not treated as settled.");
  }
  if (input.payment.stage === "unpaid") {
    blocking.push("Nothing has been invoiced yet.");
  }
  return blocking;
}

export function onboardingReadiness(state: ChecklistState): ReadinessOutcome {
  const blocking: string[] = [];
  const passedOnException: string[] = [];

  for (const key of CHECKLIST_ORDER) {
    const item = state.items.find((entry) => entry.key === key);
    if (!item) {
      blocking.push(`${CHECKLIST_LABEL[key]} has not been looked at.`);
      continue;
    }
    if (item.met) continue;
    const exception = item.exception;
    if (exception && (exception.role === "owner" || exception.role === "admin") && exception.reason.trim()) {
      passedOnException.push(`${CHECKLIST_LABEL[key]}: ${exception.reason} (${exception.by})`);
      continue;
    }
    if (exception) {
      blocking.push(
        `${CHECKLIST_LABEL[key]} is not met, and the exception is not one an owner or admin wrote down with a reason.`,
      );
      continue;
    }
    blocking.push(`${CHECKLIST_LABEL[key]} is not met.`);
  }

  return { ready: blocking.length === 0, blocking, passedOnException };
}

/* -------------------------------------------------- opening the workspace */

export interface ProjectsHandoff {
  key: string;
  clientRef: string;
  openedBy: ID;
  openedAt: ISODateTime;
  /** Carried across so the workspace can show where it came from. */
  sources: string[];
  passedOnException: string[];
}

export type HandoffOutcome =
  | { opened: true; handoff: ProjectsHandoff; alreadyOpen: boolean }
  | { opened: false; because: string[] };

/** Opens exactly one Projects workspace for a client, and only when ready. */
export function openProjectsWorkspace(input: {
  state: ChecklistState;
  readiness: ReadinessOutcome;
  by: ID;
  at: ISODateTime;
  sources: string[];
  /** Handoffs already opened for this client. */
  existing?: ProjectsHandoff[];
}): HandoffOutcome {
  const key = `${input.state.clientRef}::project`;
  const existing = (input.existing ?? []).find((entry) => entry.key === key);
  if (existing) return { opened: true, handoff: existing, alreadyOpen: true };

  if (!input.readiness.ready) return { opened: false, because: input.readiness.blocking };
  if (!input.by.trim()) return { opened: false, because: ["Say who is starting this work."] };

  return {
    opened: true,
    alreadyOpen: false,
    handoff: {
      key,
      clientRef: input.state.clientRef,
      openedBy: input.by,
      openedAt: input.at,
      sources: [...input.sources],
      passedOnException: [...input.readiness.passedOnException],
    },
  };
}
