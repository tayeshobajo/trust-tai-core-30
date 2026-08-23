/**
 * Gmail, the send path (server only).
 *
 * The boundary this module keeps:
 *  - A human sends. Every call arrives with a signed-in member's token; every
 *    read and write is made with that token, so RLS and the organization
 *    boundary hold. There is no autonomous sender here or anywhere else.
 *  - Sending needs the `gmail.send` scope, requested on the same consent
 *    screen as reading. When the stored grant does not include it — an older
 *    read-only connection, or send declined — the answer is a calm `blocked`
 *    outcome naming the scope; the draft is untouched, never half-claimed.
 *  - Mailboxes own transport identity. A reply leaves from the same mailbox
 *    that owns the conversation (provenance, never a guess); a new
 *    conversation uses the caller's choice, or the only send-capable
 *    mailbox. A read-only mailbox blocks only its own sends.
 *  - attempted != executed != verified. Gmail accepting the message moves the
 *    draft to `sent` and writes the outbound message row so the timeline
 *    shows it immediately; `mailbox_verified` still belongs to the normal
 *    sync's reconciliation, which upserts on the same provider message id and
 *    therefore merges instead of duplicating.
 *  - A failed Gmail call lands in retryable `send_failed` with the draft, its
 *    wording, and its staged files intact. Nothing is ever lost by sending.
 *
 * Idempotency: one draft carries one stable key (`send:{draftId}`), only the
 * first attempt can claim a sendable draft, and a send that already succeeded
 * replays its recorded result instead of sending twice.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { openSecret } from "@/lib/comms-crypto.server";
import {
  GMAIL_API,
  gmailGet,
  loadGmailConnections,
  refreshAccessToken,
  requireMember,
  supabaseFor,
  type GmailConnectionRow,
} from "@/lib/comms-gmail.server";
import {
  buildMimeMessage,
  bytesToBase64,
  deterministicMessageId,
  encodeRawEmail,
  replyRecipients,
  replySubject,
  validateAttachments,
  type OutgoingAttachment,
} from "@/domain/comms-mime";
import {
  GMAIL_SEND_SCOPE,
  mailboxFromProvenance,
  resolveSendMailbox,
  type AttachmentMeta,
  type SendMailboxRef,
} from "@/domain/comms-integrations";
import {
  decideSendClaim,
  readDraftSend,
  sendIdempotencyKey,
  SENDABLE_STATES,
  STALE_SENDING_MS,
  writeDraftSend,
  type DraftSend,
  type SendThreadTarget,
} from "@/domain/comms-send";
import {
  DRAFT_ATTACHMENT_BUCKET,
  MAX_ATTACHMENTS_PER_MESSAGE,
  readOutgoingAttachments,
  readOutgoingExtras,
  writeOutgoingAttachments,
  type OutgoingAttachmentRef,
} from "@/domain/comms-outgoing";

/* ------------------------------------------------------------- capability */

/** What ONE connected mailbox may do. */
export interface MailboxCapability {
  integrationId: string;
  accountEmail?: string;
  /** The connection row's status is `connected`. */
  connected: boolean;
  /** True only when the stored grant already includes `gmail.send`. */
  canSend: boolean;
  /** Present when a reconnect must grant it before this mailbox can send. */
  requiredScope?: string;
}

export interface SendCapability {
  /** True when at least one mailbox is connected. */
  connected: boolean;
  /** True when at least one connected mailbox holds the send grant. */
  canSend: boolean;
  /** The first connected mailbox, for single-mailbox display. */
  accountEmail?: string;
  /** Present when no connected mailbox may send yet. */
  requiredScope?: string;
  /** Every connected Gmail account, one capability each. */
  mailboxes: MailboxCapability[];
}

/** Whether a stored scope list already permits sending. Pure; tested. */
export function canSendWithScopes(scopes: unknown): boolean {
  return Array.isArray(scopes) && scopes.includes(GMAIL_SEND_SCOPE);
}

/** One connection row read as a capability. Pure; tested. */
export function mailboxCapabilityOf(row: GmailConnectionRow): MailboxCapability {
  const connected = row.status === "connected";
  const canSend = connected && canSendWithScopes(row.scopes);
  const accountEmail = row.account_email?.trim().toLowerCase();
  return {
    integrationId: row.id,
    ...(accountEmail ? { accountEmail } : {}),
    connected,
    canSend,
    ...(canSend ? {} : { requiredScope: GMAIL_SEND_SCOPE }),
  };
}

/**
 * What this workspace's Gmail connections can do — every mailbox, each with
 * its own send capability. Reads the integration rows under the caller's own
 * access; never touches Google.
 */
export async function sendCapability(input: {
  token: string;
  organizationId: string;
}): Promise<SendCapability> {
  const client = supabaseFor(input.token);
  await requireMember(client, input.organizationId);

  const mailboxes = (await loadGmailConnections(client, input.organizationId)).map(
    mailboxCapabilityOf,
  );
  const live = mailboxes.filter((mailbox) => mailbox.connected);
  const capable = live.filter((mailbox) => mailbox.canSend);
  return {
    connected: live.length > 0,
    canSend: capable.length > 0,
    ...(live[0]?.accountEmail ? { accountEmail: live[0].accountEmail } : {}),
    ...(live.length > 0 && capable.length === 0 ? { requiredScope: GMAIL_SEND_SCOPE } : {}),
    mailboxes,
  };
}

/* -------------------------------------------------------- failure reading */

export type SendFailureKind = "missing_scope" | "revoked" | "failed";

/**
 * Read a Gmail send refusal honestly. The one we treat specially is the
 * permission checkpoint: a 403 whose body names scopes means the connection
 * was granted read-only and no retry will change that.
 */
export function classifyGmailSendFailure(
  status: number,
  bodyText: string,
): { kind: SendFailureKind; message: string; requiredScope?: string } {
  if (status === 403 && /scope|insufficient|permission/i.test(bodyText)) {
    return {
      kind: "missing_scope",
      message:
        "This Gmail connection was granted read-only access. Reconnect Gmail and grant send access to send from Comms.",
      requiredScope: GMAIL_SEND_SCOPE,
    };
  }
  if (status === 401) {
    return {
      kind: "revoked",
      message: "Google refused the stored access. Reconnect the mailbox and try again.",
    };
  }
  const detail = bodyText.replace(/\s+/g, " ").trim().slice(0, 200);
  return {
    kind: "failed",
    message: `Gmail did not accept the message (${status})${detail ? `: ${detail}` : "."}`,
  };
}

/* ---------------------------------------------------------- reply planning */

interface ThreadHeaderMessage {
  id?: string;
  payload?: { headers?: { name?: string; value?: string }[] };
}

function headerOf(message: ThreadHeaderMessage, name: string): string | undefined {
  const found = (message.payload?.headers ?? []).find(
    (entry) => (entry.name ?? "").toLowerCase() === name.toLowerCase(),
  );
  return found?.value?.trim() || undefined;
}

export interface ReplyPlan {
  to: string[];
  cc: string[];
  subject: string;
  inReplyTo?: string;
  references: string[];
}

/**
 * How a reply into an existing Gmail thread is addressed and threaded.
 *
 * Reply-all, safely: the person who last wrote to us leads To; the other
 * participants ride in Cc; our own mailbox is never a recipient. The
 * relationship's own address is always on the message — a reply that would
 * otherwise skip the person the draft is for includes them. Pure; tested.
 */
export function planReplyFromThread(
  messages: ThreadHeaderMessage[],
  mailbox: string,
  relationshipEmail: string,
  draftSubject?: string,
): ReplyPlan | null {
  if (messages.length === 0) return null;
  const self = mailbox.trim().toLowerCase();
  const person = relationshipEmail.trim().toLowerCase();

  const threadSubject = messages.map((message) => headerOf(message, "Subject")).find(Boolean);
  const subject = draftSubject?.trim() || replySubject(threadSubject);

  const messageIds = messages
    .map((message) => headerOf(message, "Message-ID"))
    .filter((value): value is string => Boolean(value));
  const last = messages[messages.length - 1]!;
  const inReplyTo = headerOf(last, "Message-ID");

  const lastInbound = [...messages]
    .reverse()
    .find((message) => {
      const from = headerOf(message, "From")?.toLowerCase() ?? "";
      return from.includes("@") && !from.includes(self) && from.length > 0;
    });

  let to: string[];
  let cc: string[];
  if (lastInbound) {
    const fromHeader = headerOf(lastInbound, "From") ?? "";
    const fromMatch = fromHeader.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const recipients = replyRecipients({
      replyTo: fromMatch?.[0] ?? person,
      toEmails: (headerOf(lastInbound, "To") ?? "").split(","),
      ccEmails: (headerOf(lastInbound, "Cc") ?? "").split(","),
      mailbox: self,
    });
    to = recipients.to;
    cc = recipients.cc;
  } else {
    to = [];
    cc = [];
  }

  // The person this relationship is about is always on their own reply.
  if (person && person !== self && !to.includes(person) && !cc.includes(person)) {
    to = [person, ...to];
  }
  if (to.length === 0) to = [person];

  return {
    to,
    cc,
    subject,
    ...(inReplyTo ? { inReplyTo } : {}),
    references: messageIds.slice(-10),
  };
}

/** The exact body Gmail's send endpoint receives. Pure; tested. */
export function buildSendRequestBody(
  raw: string,
  target: SendThreadTarget,
): { raw: string; threadId?: string } {
  return target.mode === "reply" ? { raw, threadId: target.providerThreadId } : { raw };
}

/* ------------------------------------------------------------------ outcome */

export interface SendOutcome {
  draftId: string;
  state: "sent" | "sending" | "failed" | "blocked";
  /** True when a repeated click was answered from the record, not re-sent. */
  replayed?: boolean;
  providerMessageId?: string;
  providerThreadId?: string;
  error?: string;
  requiredScope?: string;
}

interface DraftRow {
  id: string;
  relationship_id: string;
  subject: string | null;
  body: string;
  review_state: string;
  rationale: Record<string, unknown> | null;
  updated_at: string | null;
}

async function gmailSendRequest(
  accessToken: string,
  body: { raw: string; threadId?: string },
): Promise<{ ok: boolean; status: number; payload: Record<string, unknown>; text: string }> {
  const response = await fetch(`${GMAIL_API}/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return { ok: response.ok, status: response.status, payload, text };
}

/** Move a claimed draft to its terminal send state. Conditional: only a
 * draft still held by this attempt (`sending`) may be settled by it. */
async function settleClaim(
  client: SupabaseClient,
  draft: DraftRow,
  send: DraftSend,
  reviewState: "sent" | "send_failed",
  clearStagedFiles: boolean,
): Promise<void> {
  const rationale = writeDraftSend(
    clearStagedFiles ? writeOutgoingAttachments(draft.rationale, []) : draft.rationale,
    send,
  );
  await client
    .from("comms_drafts")
    .update({
      review_state: reviewState,
      rationale,
      updated_at: new Date().toISOString(),
    })
    .eq("id", draft.id)
    .eq("review_state", "sending");
}

/**
 * Send one approved draft through Gmail. The whole loop: capability check,
 * claim, build, send, immediate timeline evidence, and honest failure.
 */
export async function sendDraftViaGmail(input: {
  token: string;
  organizationId: string;
  draftId: string;
  threadTarget?: SendThreadTarget;
  /**
   * The member's explicit mailbox choice for a new conversation. Ignored
   * for replies — the owning mailbox always sends its own conversation.
   */
  integrationId?: string;
}): Promise<SendOutcome> {
  const client = supabaseFor(input.token);
  await requireMember(client, input.organizationId);

  const { data: draftRow, error: draftError } = await client
    .from("comms_drafts")
    .select("id, relationship_id, subject, body, review_state, rationale, updated_at")
    .eq("id", input.draftId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (draftError) throw new Error(draftError.message);
  if (!draftRow) throw new Error("That draft is not on record.");
  const draft = draftRow as DraftRow;

  // Idempotency before anything else: a double click on an accepted send
  // replays the recorded outcome; one already in flight says so.
  const decision = decideSendClaim({
    reviewState: draft.review_state,
    rationale: draft.rationale,
    ...(draft.updated_at ? { updatedAt: draft.updated_at } : {}),
  });
  if (decision.kind === "replay") {
    return {
      draftId: draft.id,
      state: "sent",
      replayed: true,
      ...(decision.send.providerMessageId
        ? { providerMessageId: decision.send.providerMessageId }
        : {}),
      ...(decision.send.providerThreadId
        ? { providerThreadId: decision.send.providerThreadId }
        : {}),
    };
  }
  if (decision.kind === "in_flight") {
    return { draftId: draft.id, state: "sending" };
  }
  if (decision.kind === "not_sendable") {
    throw new Error(decision.reason);
  }

  const { data: relationshipRow, error: relationshipError } = await client
    .from("comms_relationships")
    .select("id, email, full_name")
    .eq("id", draft.relationship_id)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (relationshipError) throw new Error(relationshipError.message);
  const relationship = relationshipRow as { id: string; email: string | null } | null;
  if (!relationship?.email) {
    throw new Error("This relationship has no email address yet. Add one before sending.");
  }
  const recipient = relationship.email.toLowerCase();

  // Thread target first: which conversation this joins decides which mailbox
  // sends. The caller's explicit choice wins; otherwise the relationship's
  // most recent tracked thread is the reply, and with no tracked thread the
  // message opens a new conversation.
  let target: SendThreadTarget = input.threadTarget ?? { mode: "new" };
  if (!input.threadTarget) {
    const { data: threadRow } = await client
      .from("comms_threads")
      .select("provider_thread_id")
      .eq("organization_id", input.organizationId)
      .eq("relationship_id", relationship.id)
      .eq("provider", "gmail")
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const providerThreadId = (threadRow as { provider_thread_id?: string } | null)
      ?.provider_thread_id;
    if (providerThreadId) target = { mode: "reply", providerThreadId };
  }

  // The reply-from rule: a reply goes from the same mailbox that owns the
  // conversation. Ownership is provenance, not guesswork — both the sync and
  // the send path stamp the observing mailbox on every message row.
  let threadMailbox: string | undefined;
  if (target.mode === "reply") {
    const { data: provenanceRows } = await client
      .from("comms_messages")
      .select("provenance")
      .eq("organization_id", input.organizationId)
      .eq("provider", "gmail")
      .eq("provider_thread_id", target.providerThreadId)
      .order("occurred_at", { ascending: false })
      .limit(5);
    threadMailbox = ((provenanceRows ?? []) as { provenance: unknown }[])
      .map((row) => mailboxFromProvenance(row.provenance))
      .find((entry): entry is string => Boolean(entry));
  }

  const connectionRows = await loadGmailConnections(client, input.organizationId);
  // MailboxCapability names the row id `integrationId`; the resolver's
  // neutral ref calls it `id`. One explicit mapping keeps the boundary clean.
  const refs: SendMailboxRef[] = connectionRows.map((row) => {
    const capability = mailboxCapabilityOf(row);
    return {
      id: capability.integrationId,
      accountEmail: capability.accountEmail,
      connected: capability.connected,
      canSend: capability.canSend,
    };
  });
  const resolution = resolveSendMailbox({
    connections: refs,
    ...(threadMailbox ? { threadMailbox } : {}),
    ...(input.integrationId ? { integrationId: input.integrationId } : {}),
  });

  if (resolution.kind === "unknown_choice") throw new Error("That mailbox is not connected.");
  if (resolution.kind === "none_connected") throw new Error("No mailbox is connected yet.");
  if (resolution.kind === "needs_choice") {
    throw new Error("More than one mailbox can send — choose which account sends this.");
  }
  if (resolution.kind === "owner_missing") {
    return {
      draftId: draft.id,
      state: "blocked",
      error: `This conversation belongs to ${resolution.mailbox}, which is not connected. Reconnect that mailbox under Connections to reply in this thread.`,
    };
  }
  if (resolution.kind === "none_send_capable") {
    return {
      draftId: draft.id,
      state: "blocked",
      error:
        "This Gmail connection was granted read-only access. Reconnect Gmail and grant send access to send from Comms.",
      requiredScope: GMAIL_SEND_SCOPE,
    };
  }

  const connection = connectionRows.find((row) => row.id === resolution.connection.id);
  if (!connection) throw new Error("That mailbox is not connected.");
  const mailbox = (connection.account_email ?? "").toLowerCase();
  if (!mailbox) throw new Error("The connected mailbox address is not on record.");

  // The permission checkpoint, enforced before any claim: a read-only grant
  // can never send, so the draft is left exactly as it was. Only the chosen
  // mailbox is blocked — other mailboxes stay fully usable.
  if (!canSendWithScopes(connection.scopes)) {
    return {
      draftId: draft.id,
      state: "blocked",
      error: `The mailbox ${mailbox} was granted read-only access. Reconnect it with send access to send from it.`,
      requiredScope: GMAIL_SEND_SCOPE,
    };
  }

  // Staged files: metadata on the draft, bytes in the private bucket. Every
  // validation error is actionable and nothing is claimed before it passes.
  const staged = readOutgoingAttachments(draft.rationale);
  if (staged.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new Error(
      `One message can carry at most ${MAX_ATTACHMENTS_PER_MESSAGE} files. Remove some and try again.`,
    );
  }
  const attachmentErrors = validateAttachments(staged);
  if (attachmentErrors.length > 0) throw new Error(attachmentErrors[0]!);

  const attachments: OutgoingAttachment[] = [];
  for (const file of staged) {
    const { data: blob, error: downloadError } = await client.storage
      .from(DRAFT_ATTACHMENT_BUCKET)
      .download(file.path);
    if (downloadError || !blob) {
      throw new Error(
        `“${file.filename}” is no longer available in draft storage. Remove it and attach the file again.`,
      );
    }
    attachments.push({
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size,
      contentBase64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())),
    });
  }

  const { data: sealed, error: sealedError } = await client.rpc("comms_get_integration_secret", {
    p_integration_id: connection.id,
  });
  if (sealedError) throw new Error(sealedError.message);
  if (!sealed || typeof sealed !== "string") {
    throw new Error("That mailbox needs to be connected again.");
  }
  const accessToken = await refreshAccessToken(await openSecret(sealed));

  let to = [recipient];
  let cc: string[] = [];
  let subject = draft.subject?.trim() ?? "";
  let inReplyTo: string | undefined;
  let references: string[] = [];

  if (target.mode === "reply") {
    // The thread is re-read from Gmail (read-only scope covers this) so the
    // reply carries real Message-ID headers — threading is Gmail's job, and
    // it needs them.
    const thread = await gmailGet<{ messages?: ThreadHeaderMessage[] }>(
      `/threads/${encodeURIComponent(target.providerThreadId)}` +
        `?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject` +
        `&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc`,
      accessToken,
    );
    const plan = planReplyFromThread(thread.messages ?? [], mailbox, recipient, subject);
    if (!plan) throw new Error("That conversation could not be read from Gmail.");
    to = plan.to;
    cc = plan.cc;
    subject = plan.subject;
    inReplyTo = plan.inReplyTo;
    references = plan.references;
  }
  if (!subject) {
    throw new Error("A new conversation needs a subject before it can be sent.");
  }

  // CC/BCC the person staged on the draft are part of what was approved.
  // Our own mailbox is never a recipient, even if it was typed in.
  const extras = readOutgoingExtras(draft.rationale);
  const notSelf = (email: string) => email.trim().toLowerCase() !== mailbox;
  cc = [...new Set([...cc, ...extras.cc].map((email) => email.trim().toLowerCase()))].filter(
    (email) => email && notSelf(email) && !to.includes(email),
  );
  const bcc = [...new Set(extras.bcc.map((email) => email.trim().toLowerCase()))].filter(
    (email) => email && notSelf(email) && !to.includes(email) && !cc.includes(email),
  );

  const messageId = deterministicMessageId(draft.id);
  const raw = encodeRawEmail(
    buildMimeMessage({
      from: mailbox,
      to,
      cc,
      ...(bcc.length > 0 ? { bcc } : {}),
      subject,
      bodyText: draft.body,
      messageId,
      ...(inReplyTo ? { inReplyTo } : {}),
      ...(references.length > 0 ? { references } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
    }),
  );

  // The claim: only the first attempt may move a sendable draft to sending.
  // A claim that died mid-flight is reclaimable after the stale window.
  const attemptedAt = new Date().toISOString();
  const staleBefore = new Date(Date.now() - STALE_SENDING_MS).toISOString();
  const claimSend: DraftSend = {
    state: "sending",
    idempotencyKey: sendIdempotencyKey(draft.id),
    attemptedAt,
    threadTarget: target,
    ...(staged.length > 0 ? { attachments: staged } : {}),
  };
  const { count: claimed } = await client
    .from("comms_drafts")
    .update(
      {
        review_state: "sending",
        rationale: writeDraftSend(draft.rationale, claimSend),
        updated_at: attemptedAt,
      },
      { count: "exact" },
    )
    .eq("id", draft.id)
    .or(
      `review_state.in.(${SENDABLE_STATES.join(",")}),` +
        `and(review_state.eq.sending,updated_at.lt.${staleBefore})`,
    );
  if (!claimed) {
    // Lost the race: answer from whoever holds the claim now.
    const { data: current } = await client
      .from("comms_drafts")
      .select("review_state, rationale")
      .eq("id", draft.id)
      .maybeSingle();
    const row = current as { review_state: string; rationale: Record<string, unknown> | null } | null;
    const send = readDraftSend(row?.rationale);
    if (row?.review_state === "sent" && send?.state === "sent") {
      return {
        draftId: draft.id,
        state: "sent",
        replayed: true,
        ...(send.providerMessageId ? { providerMessageId: send.providerMessageId } : {}),
        ...(send.providerThreadId ? { providerThreadId: send.providerThreadId } : {}),
      };
    }
    return { draftId: draft.id, state: "sending" };
  }

  const result = await gmailSendRequest(accessToken, buildSendRequestBody(raw, target));

  if (!result.ok) {
    const failure = classifyGmailSendFailure(result.status, result.text);
    await settleClaim(
      client,
      draft,
      { ...claimSend, state: "failed", error: failure.message, ...(failure.requiredScope ? { requiredScope: failure.requiredScope } : {}) },
      "send_failed",
      false,
    );
    return {
      draftId: draft.id,
      state: "failed",
      error: failure.message,
      ...(failure.requiredScope ? { requiredScope: failure.requiredScope } : {}),
    };
  }

  const providerMessageId = typeof result.payload["id"] === "string" ? result.payload["id"] : "";
  const providerThreadId =
    typeof result.payload["threadId"] === "string"
      ? result.payload["threadId"]
      : target.mode === "reply"
        ? target.providerThreadId
        : "";
  if (!providerMessageId || !providerThreadId) {
    await settleClaim(
      client,
      draft,
      { ...claimSend, state: "failed", error: "Gmail accepted nothing recognizable. Retry the send." },
      "send_failed",
      false,
    );
    return {
      draftId: draft.id,
      state: "failed",
      error: "Gmail accepted nothing recognizable. Retry the send.",
    };
  }

  const sentAt = new Date().toISOString();

  // Immediate evidence: the outbound message enters the timeline now, keyed
  // by Gmail's own message id. When sync later observes the same message it
  // upserts onto this row — reconciliation merges, never duplicates.
  const { data: existingThread } = await client
    .from("comms_threads")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("provider", "gmail")
    .eq("provider_thread_id", providerThreadId)
    .maybeSingle();
  const threadPayload = {
    organization_id: input.organizationId,
    relationship_id: relationship.id,
    channel: "email",
    provider: "gmail",
    provider_thread_id: providerThreadId,
    subject,
    state: "waiting_on_them",
    last_message_at: sentAt,
    response_due_at: null,
    updated_at: sentAt,
  };
  let threadId = (existingThread as { id?: string } | null)?.id;
  if (threadId) {
    await client
      .from("comms_threads")
      .update({ last_message_at: sentAt, updated_at: sentAt })
      .eq("id", threadId);
  } else {
    const { data: inserted, error: threadError } = await client
      .from("comms_threads")
      .insert(threadPayload)
      .select("id")
      .single();
    if (threadError) {
      console.warn(`[comms-gmail-send] thread write failed: ${threadError.message}`);
    }
    threadId = (inserted as { id?: string } | null)?.id;
  }

  const { error: messageError } = await client.from("comms_messages").upsert(
    {
      organization_id: input.organizationId,
      relationship_id: relationship.id,
      thread_id: threadId ?? null,
      provider: "gmail",
      provider_message_id: providerMessageId,
      provider_thread_id: providerThreadId,
      direction: "outbound",
      from_email: mailbox,
      to_emails: to,
      cc_emails: cc,
      subject,
      snippet: draft.body.replace(/\s+/g, " ").trim().slice(0, 180),
      occurred_at: sentAt,
      attachments: staged.map((file): AttachmentMeta => ({
        filename: file.filename,
        mimeType: file.mimeType,
        size: file.size,
      })),
      provenance: {
        source: "gmail-send",
        mailbox,
        idempotency_key: claimSend.idempotencyKey,
        sent_at: sentAt,
      },
    },
    { onConflict: "organization_id,provider,provider_message_id", ignoreDuplicates: false },
  );
  if (messageError) {
    console.warn(`[comms-gmail-send] message write failed: ${messageError.message}`);
  }

  await client
    .from("comms_relationships")
    .update({ last_touch_at: sentAt, response_due_at: null, updated_at: sentAt })
    .eq("id", relationship.id)
    .eq("organization_id", input.organizationId);

  // The send succeeded: Gmail now holds the bytes, so staged uploads are
  // removed. A cleanup failure is harmless — lifecycle sweeps orphans.
  if (staged.length > 0) {
    const { error: removeError } = await client.storage
      .from(DRAFT_ATTACHMENT_BUCKET)
      .remove(staged.map((file) => file.path));
    if (removeError) {
      console.warn(`[comms-gmail-send] staged file cleanup failed: ${removeError.message}`);
    }
  }

  await settleClaim(
    client,
    draft,
    {
      ...claimSend,
      state: "sent",
      sentAt,
      providerMessageId,
      providerThreadId,
    },
    "sent",
    true,
  );

  return { draftId: draft.id, state: "sent", providerMessageId, providerThreadId };
}

/* -------------------------------------------------- incoming attachments */

/** A safe Content-Disposition for bytes leaving our server. Pure; tested. */
export function contentDisposition(filename: string): string {
  const fallback =
    filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_").trim() || "attachment";
  if (fallback === filename) return `attachment; filename="${fallback}"`;
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export interface DownloadedAttachment {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
}

/**
 * Fetch one incoming attachment's bytes from Gmail, on demand. Gmail stays
 * the source of truth — nothing is copied into Trust Tai storage. The
 * message row (read under the caller's token, so RLS holds) must actually
 * carry this attachment id; a made-up id never reaches Gmail.
 *
 * The read goes to the mailbox that observed the message — provenance on the
 * row names it, so a workspace with several mailboxes never asks the wrong
 * account for a message it never saw.
 */
export async function downloadMailboxAttachment(input: {
  token: string;
  organizationId: string;
  messageId: string;
  attachmentId: string;
}): Promise<DownloadedAttachment> {
  const client = supabaseFor(input.token);
  await requireMember(client, input.organizationId);

  const { data: messageRow, error: messageError } = await client
    .from("comms_messages")
    .select("id, provider_message_id, attachments, provenance")
    .eq("id", input.messageId)
    .eq("organization_id", input.organizationId)
    .eq("provider", "gmail")
    .maybeSingle();
  if (messageError) throw new Error(messageError.message);
  if (!messageRow) throw new Error("That message is not on record.");
  const message = messageRow as {
    id: string;
    provider_message_id: string | null;
    attachments: unknown;
    provenance: unknown;
  };
  if (!message.provider_message_id) throw new Error("That message has no mailbox copy.");

  const attachments = Array.isArray(message.attachments)
    ? (message.attachments as Record<string, unknown>[])
    : [];
  const target = attachments.find((entry) => entry["attachment_id"] === input.attachmentId);
  if (!target) throw new Error("That file is not part of this message.");

  const connections = await loadGmailConnections(client, input.organizationId);
  const observedBy = mailboxFromProvenance(message.provenance);
  const connection = observedBy
    ? connections.find((row) => row.account_email?.toLowerCase() === observedBy)
    : connections.length === 1
      ? connections[0]
      : undefined;
  if (!connection) {
    throw new Error(
      observedBy
        ? `The mailbox ${observedBy} that holds this file is not connected. Reconnect it under Connections to open this file.`
        : "The mailbox that holds this file could not be determined. Reconnect the mailbox under Connections.",
    );
  }

  const { data: sealed, error: sealedError } = await client.rpc("comms_get_integration_secret", {
    p_integration_id: connection.id,
  });
  if (sealedError) throw new Error(sealedError.message);
  if (!sealed || typeof sealed !== "string") {
    throw new Error("That mailbox needs to be connected again.");
  }
  const accessToken = await refreshAccessToken(await openSecret(sealed));

  const payload = await gmailGet<{ data?: string }>(
    `/messages/${encodeURIComponent(message.provider_message_id)}` +
      `/attachments/${encodeURIComponent(input.attachmentId)}`,
    accessToken,
  );
  if (!payload.data) throw new Error("Gmail returned no file content.");

  const base64 = payload.data.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);

  return {
    bytes,
    filename: typeof target["filename"] === "string" ? target["filename"] : "attachment",
    mimeType:
      typeof target["mime_type"] === "string" ? target["mime_type"] : "application/octet-stream",
  };
}
