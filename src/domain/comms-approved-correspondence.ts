import { z } from "zod";
import type { StoredMailboxMessage } from "./comms-integrations";
import type { ConversationHealth } from "./comms-health";

/** Approved Roadmaps metadata only. No subject, body, source URL or new provider read. */
export const approvedCorrespondenceFactSchema = z
  .object({
    eventKey: z.string().regex(/^[a-f0-9]{64}$/),
    organizationId: z.string().uuid(),
    roadmapId: z.string().uuid(),
    relationshipId: z.string().uuid(),
    channel: z.enum(["email", "linkedin", "linkedin_sales_navigator"]),
    kind: z.enum(["sent", "received", "draft", "bounce", "team_outbound_copy"]),
    occurredAt: z.string().datetime({ offset: true }),
    timestampPrecision: z.enum(["exact", "approximate"]),
    sourceAccountRef: z.string().min(1).max(200),
    sourceEventId: z.string().min(1).max(300),
    identityKind: z.enum(["provider_id", "reviewed_receipt"]),
  })
  .strict();
export type ApprovedCorrespondenceFact = z.infer<typeof approvedCorrespondenceFactSchema>;
export const approvedCorrespondenceReadSchema = z
  .object({
    organizationId: z.string().uuid(),
    readAt: z.string().datetime({ offset: true }),
    coverage: z.literal("partial"),
    facts: z.array(approvedCorrespondenceFactSchema),
  })
  .strict();

const account = (value: string) => value.trim();
const sourceKey = (f: ApprovedCorrespondenceFact) =>
  JSON.stringify([
    f.organizationId,
    f.relationshipId,
    f.channel,
    account(f.sourceAccountRef),
    f.identityKind,
    f.sourceEventId,
  ]);
const actual = (f: ApprovedCorrespondenceFact) => f.kind === "sent" || f.kind === "received";

/** Dedupe only verified same-account provider identities with agreeing facts.
 * A link, subject, person, timestamp or reviewer receipt never proves sameness. */
export function distinctApprovedFacts(
  facts: ApprovedCorrespondenceFact[],
  messages: StoredMailboxMessage[],
) {
  const seen = new Set<string>();
  return facts.filter((f) => {
    const key = JSON.stringify([sourceKey(f), f.kind, f.occurredAt, f.timestampPrecision]);
    if (seen.has(key)) return false;
    seen.add(key);
    return !messages.some(
      (m) =>
        f.channel === "email" &&
        f.identityKind === "provider_id" &&
        f.timestampPrecision === "exact" &&
        actual(f) &&
        m.organizationId === f.organizationId &&
        m.relationshipId === f.relationshipId &&
        m.mailbox &&
        account(m.mailbox) === account(f.sourceAccountRef) &&
        m.providerMessageId === f.sourceEventId &&
        m.direction === (f.kind === "received" ? "inbound" : "outbound") &&
        Date.parse(m.occurredAt) === Date.parse(f.occurredAt),
    );
  });
}
const latest = (values: (string | undefined)[]) =>
  values
    .filter((v): v is string => !!v && Number.isFinite(Date.parse(v)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];

/** Adds approved observations, never synthesizes touches/due dates or settles
 * another thread. Roadmaps currently has no verified thread identifier. */
export function withApprovedCorrespondence(
  health: ConversationHealth,
  facts: ApprovedCorrespondenceFact[],
  messages: StoredMailboxMessage[],
  now = new Date(),
): ConversationHealth {
  const own = facts.filter((f) => f.relationshipId === health.relationshipId && actual(f));
  const mail = messages.filter((m) => m.relationshipId === health.relationshipId);
  const remaining = distinctApprovedFacts(own, mail);
  const pending = remaining.filter((f) => f.kind === "received").length;
  const lastActivityAt = latest([
    health.lastActivityAt,
    ...own.map((f) => f.occurredAt),
    ...mail.map((m) => m.occurredAt),
  ]);
  const lastReplyAt = latest([
    health.lastReplyAt,
    ...own.filter((f) => f.kind === "received").map((f) => f.occurredAt),
    ...mail.filter((m) => m.direction === "inbound").map((m) => m.occurredAt),
  ]);
  const lastOutboundAt = latest([
    health.lastOutboundAt,
    ...own.filter((f) => f.kind === "sent").map((f) => f.occurredAt),
    ...mail.filter((m) => m.direction === "outbound").map((m) => m.occurredAt),
  ]);
  const approximate = (at: string | undefined, kind: "received" | "sent") =>
    !!at &&
    own.some(
      (f) => f.kind === kind && f.occurredAt === at && f.timestampPrecision === "approximate",
    ) &&
    !own.some((f) => f.kind === kind && f.occurredAt === at && f.timestampPrecision === "exact") &&
    !mail.some(
      (m) => m.direction === (kind === "received" ? "inbound" : "outbound") && m.occurredAt === at,
    ) &&
    (kind === "received"
      ? health.lastReplyAt !== at || health.lastIncomingApproximate === true
      : health.lastOutboundAt !== at || health.lastOutgoingApproximate === true);
  const recentApproved = own.some((f) => now.getTime() - Date.parse(f.occurredAt) <= 30 * 86400000);
  const raisesQuiet =
    health.status === "quiet" && health.nextMoveStatus !== "not_needed" && recentApproved;
  return {
    ...health,
    ...(lastActivityAt ? { lastActivityAt } : {}),
    ...(lastReplyAt ? { lastReplyAt } : {}),
    ...(lastOutboundAt ? { lastOutboundAt } : {}),
    lastIncomingApproximate: approximate(lastReplyAt, "received"),
    lastOutgoingApproximate: approximate(lastOutboundAt, "sent"),
    ...(pending || raisesQuiet
      ? {
          status: health.status === "at_risk" ? ("at_risk" as const) : ("needs_attention" as const),
          ...(pending ? { waitingOn: "needs_us" as const } : {}),
          reasons: [
            pending
              ? `${pending} approved incoming record${pending === 1 ? " has" : "s have"} no verified thread linkage here. Review before treating a later outgoing record as its reply.`
              : "Approved correspondence is on record. Review the next move; coverage is partial.",
            ...(raisesQuiet ? [] : health.reasons),
          ],
        }
      : {}),
  };
}
