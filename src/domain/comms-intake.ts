/**
 * Label-as-approval intake.
 *
 * The doctrine: applying the exact `Trust Tai/Comms` Gmail label IS the human
 * approval to bring that correspondent into Comms. Nothing here reads Gmail
 * or writes Supabase, it decides, from one already-labeled message, WHO the
 * counterpart is, and refuses to guess when a thread cannot be resolved
 * safely.
 *
 * The laws that hold here:
 * - Inbound labeled mail resolves to its sender. That is never ambiguous.
 * - Outbound labeled mail resolves only when exactly one real human
 *   recipient remains after the mailbox itself and machine addresses are
 *   removed. Two or more, and Comms fails closed into a small exception
 *   queue instead of inventing the wrong person.
 * - Machine senders (no-reply, notifications, mailers) are never people.
 * - Exceptions are counts and handles, never message content beyond the
 *   subject line a human needs to recognise the thread.
 */

/** Addresses that are transport, not people. Never brought into Comms. */
const MACHINE_ADDRESS =
  /no-?reply|do-?not-?reply|notifications?@|mailer|postmaster@|bounce|support@|@google\.com$/i;

export function isMachineAddress(email: string): boolean {
  return MACHINE_ADDRESS.test(email);
}

export interface IntakeMessageLike {
  providerMessageId: string;
  providerThreadId: string;
  direction: "inbound" | "outbound";
  fromEmail?: string;
  fromName?: string;
  toEmails: string[];
  ccEmails: string[];
  subject?: string;
  occurredAt: string;
}

export type IntakeCounterpart =
  | { kind: "person"; email: string; name?: string }
  /** Nothing human on the far side, machine mail, or the mailbox alone. */
  | { kind: "none" }
  /** Several possible counterparts; a human decides which, if any. */
  | { kind: "ambiguous"; emails: string[] };

/**
 * Who the labeled message is with. Pure and total: every message resolves to
 * exactly one of person, none, or ambiguous.
 */
export function resolveIntakeCounterpart(
  message: IntakeMessageLike,
  mailbox: string,
): IntakeCounterpart {
  const box = mailbox.toLowerCase();
  const clean = (emails: (string | undefined)[]) => [
    ...new Set(
      emails
        .filter((email): email is string => Boolean(email))
        .map((email) => email.toLowerCase())
        .filter((email) => email !== box && !isMachineAddress(email)),
    ),
  ];

  if (message.direction === "inbound") {
    const from = clean([message.fromEmail]);
    const sender = from[0];
    if (!sender) return { kind: "none" };
    return {
      kind: "person",
      email: sender,
      ...(message.fromName?.trim() ? { name: message.fromName.trim() } : {}),
    };
  }

  const recipients = clean([...message.toEmails, ...message.ccEmails]);
  if (recipients.length === 0) return { kind: "none" };
  if (recipients.length === 1) return { kind: "person", email: recipients[0]! };
  return { kind: "ambiguous", emails: recipients };
}

/* ------------------------------------------------------ exception queue */

export type IntakeExceptionReason = "ambiguous_thread" | "create_failed";

/**
 * One labeled message Comms could not bring in on its own. Stored on the
 * connection cursor, no new schema, and surfaced as "Needs your decision".
 */
export interface IntakeException {
  reason: IntakeExceptionReason;
  providerMessageId: string;
  providerThreadId: string;
  emails: string[];
  subject?: string;
  occurredAt: string;
  observedAt: string;
  /** A retry of the same sync may resolve it (a create that failed). */
  retryable: boolean;
  detail?: string;
}

/** Never let the cursor grow without bound; newest exceptions win. */
export const MAX_INTAKE_EXCEPTIONS = 25;

function exceptionCount(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Defensive read of `cursor.intake_exceptions`; malformed entries are dropped. */
export function readIntakeExceptions(cursor: Record<string, unknown>): IntakeException[] {
  const raw = cursor["intake_exceptions"];
  if (!Array.isArray(raw)) return [];
  const found: IntakeException[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const messageId = exceptionCount(row["provider_message_id"]);
    const reason = exceptionCount(row["reason"]);
    if (!messageId) continue;
    if (reason !== "ambiguous_thread" && reason !== "create_failed") continue;
    found.push({
      reason,
      providerMessageId: messageId,
      providerThreadId: exceptionCount(row["provider_thread_id"]),
      emails: Array.isArray(row["emails"]) ? row["emails"].map(String) : [],
      ...(exceptionCount(row["subject"]) ? { subject: exceptionCount(row["subject"]) } : {}),
      occurredAt: exceptionCount(row["occurred_at"]),
      observedAt: exceptionCount(row["observed_at"]),
      retryable: row["retryable"] !== false,
      ...(exceptionCount(row["detail"]) ? { detail: exceptionCount(row["detail"]) } : {}),
    });
  }
  return found;
}

export function intakeExceptionToJson(entry: IntakeException): Record<string, unknown> {
  return {
    reason: entry.reason,
    provider_message_id: entry.providerMessageId,
    provider_thread_id: entry.providerThreadId,
    emails: entry.emails,
    ...(entry.subject ? { subject: entry.subject } : {}),
    occurred_at: entry.occurredAt,
    observed_at: entry.observedAt,
    retryable: entry.retryable,
    ...(entry.detail ? { detail: entry.detail } : {}),
  };
}

/**
 * Fold this pass's exceptions into what was already recorded. Same message,
 * same exception: the newer observation replaces the older one, so a resolved
 * thread never lingers twice and a repeated sync never grows the queue.
 * `resolved` names messages that came in successfully this pass, they leave
 * the queue.
 */
export function mergeIntakeExceptions(
  existing: IntakeException[],
  fresh: IntakeException[],
  resolved: ReadonlySet<string> = new Set(),
): IntakeException[] {
  const byMessage = new Map<string, IntakeException>();
  for (const entry of existing) {
    if (resolved.has(entry.providerMessageId)) continue;
    byMessage.set(entry.providerMessageId, entry);
  }
  for (const entry of fresh) byMessage.set(entry.providerMessageId, entry);
  return [...byMessage.values()]
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt))
    .slice(0, MAX_INTAKE_EXCEPTIONS);
}
