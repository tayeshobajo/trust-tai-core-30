import { z } from "zod";
import { resolveAppAccess } from "@/domain/app-access";
import { WORKSPACE_ROLES } from "@/domain/access";
import {
  conversationIdentity,
  correspondenceSchema,
  storedMailCorrespondenceSchema,
  type ConversationEvent,
} from "@/domain/roadmap-correspondence";
import { authorizeTracker, TrackerRequestError } from "./roadmap-tracker-access.server";

type CallerClient = Awaited<ReturnType<typeof authorizeTracker>>["client"];

/** Pages remain below PostgREST's usual row ceiling. Count/truncation changes fail closed. */
export async function readBoundedRows(
  read: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown[] | null; error: unknown; count: number | null }>,
  maximum = 10000,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  let total: number | null = null;
  do {
    const page = await read(rows.length, rows.length + 499);
    if (
      page.error ||
      !Array.isArray(page.data) ||
      page.count === null ||
      page.count > maximum ||
      (total !== null && total !== page.count) ||
      page.data.length !== Math.min(500, page.count - rows.length)
    )
      throw new TrackerRequestError(
        "Conversation history is unavailable, changed, or exceeds its verified read scope. Refresh stored messages.",
        503,
      );
    total = page.count;
    rows.push(...page.data);
  } while (rows.length < total);
  return rows;
}

export const reviewedMailFactSchema = correspondenceSchema
  .pick({
    organizationId: true,
    roadmapId: true,
    relationshipId: true,
    channel: true,
    kind: true,
    occurredAt: true,
    sourceAccountRef: true,
    sourceEventId: true,
    identityKind: true,
    timestampPrecision: true,
    review: true,
  })
  .extend({
    event_key: z.string().regex(/^[a-f0-9]{64}$/),
    rowOrganizationId: z.string().uuid(),
    rowRoadmapId: z.string().uuid(),
    rowRelationshipId: z.string().uuid(),
  });
export const REVIEWED_MAIL_FACT_COLUMNS =
  "event_key, rowOrganizationId:organization_id, rowRoadmapId:roadmap_id, rowRelationshipId:relationship_id, organizationId:event_payload->>organizationId, roadmapId:event_payload->>roadmapId, relationshipId:event_payload->>relationshipId, channel:event_payload->>channel, kind:event_payload->>kind, occurredAt:event_payload->>occurredAt, sourceAccountRef:event_payload->>sourceAccountRef, sourceEventId:event_payload->>sourceEventId, identityKind:event_payload->>identityKind, timestampPrecision:event_payload->>timestampPrecision, review:event_payload->review";

export function reviewedMailFact(row: z.infer<typeof reviewedMailFactSchema>) {
  if (
    row.rowOrganizationId !== row.organizationId ||
    row.rowRoadmapId !== row.roadmapId ||
    row.rowRelationshipId !== row.relationshipId
  )
    throw new TrackerRequestError("Reviewed conversation identity could not be verified.", 503);
  const { rowOrganizationId, rowRoadmapId, rowRelationshipId, review, event_key, ...fact } = row;
  return { ...fact, source: "reviewed_import" as const };
}
/** Comms RLS permits org members, but app settings can be narrower. Check both. */
export async function canReadStoredMail(
  client: CallerClient,
  userId: string,
  organizationId: string,
) {
  const membership = await client
    .from("organization_memberships")
    .select("status, role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (membership.error) throw new TrackerRequestError("Comms access could not be verified.", 503);
  if (
    membership.data?.status !== "active" ||
    !(WORKSPACE_ROLES as readonly string[]).includes(membership.data.role)
  )
    return false;
  const [organization, member, role] = await Promise.all([
    client
      .from("organization_app_settings")
      .select("enabled")
      .eq("organization_id", organizationId)
      .eq("app_key", "comms")
      .maybeSingle(),
    client
      .from("member_app_access")
      .select("access_level")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("app_key", "comms")
      .maybeSingle(),
    client
      .from("organization_role_app_access")
      .select("access_level")
      .eq("organization_id", organizationId)
      .eq("role", membership.data.role)
      .eq("app_key", "comms")
      .maybeSingle(),
  ]);
  if (organization.error || member.error || role.error)
    throw new TrackerRequestError("Comms access could not be verified.", 503);
  return resolveAppAccess("comms", {
    role: membership.data.role,
    membershipActive: true,
    organizationEnabled: organization.data?.enabled !== false,
    override: member.data?.access_level ?? role.data?.access_level,
  }).visible;
}

const timestamp = z.string().datetime({ offset: true });
export const storedMailFactSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  relationship_id: z.string().uuid(),
  provider: z.literal("gmail"),
  provider_message_id: z.string().min(1).max(300),
  direction: z.enum(["inbound", "outbound"]),
  occurred_at: timestamp,
  mailbox: z.string().nullable(),
  source: z.string().nullable(),
  fetched_at: timestamp.nullable(),
  sent_at: timestamp.nullable(),
});
export const storedMailRowSchema = storedMailFactSchema.extend({
  subject: z.string().max(1000).nullable(),
  body_text: z.string().max(100000).nullable(),
  snippet: z.string().max(100000).nullable(),
});
/** No headers, HTML, attachments, credentials or unrelated provenance fields. */
export const STORED_MAIL_FACT_COLUMNS =
  "id, organization_id, relationship_id, provider, provider_message_id, direction, occurred_at, mailbox:provenance->>mailbox, source:provenance->>source, fetched_at:provenance->>fetched_at, sent_at:provenance->>sent_at";
export function storedMailFact(row: z.infer<typeof storedMailFactSchema>, roadmapId: string) {
  const mailbox = row.mailbox?.trim().toLowerCase();
  if (
    !z.string().email().max(200).safeParse(mailbox).success ||
    !["gmail", "gmail-send"].includes(row.source ?? "")
  )
    return null;
  // No invented account identity for older rows. A provider ID alone is not global identity.
  return {
    organizationId: row.organization_id,
    roadmapId,
    relationshipId: row.relationship_id,
    source: "stored_gmail" as const,
    channel: "email" as const,
    kind: row.direction === "inbound" ? ("received" as const) : ("sent" as const),
    sourceAccountRef: mailbox!,
    sourceEventId: row.provider_message_id,
    identityKind: "provider_id" as const,
    occurredAt: row.occurred_at,
    timestampPrecision: "exact" as const,
  };
}
export function storedMailEvent(row: z.infer<typeof storedMailRowSchema>, roadmapId: string) {
  const fact = storedMailFact(row, roadmapId);
  if (!fact) return null;
  return storedMailCorrespondenceSchema.parse({
    ...fact,
    sourceUrl: `https://mail.google.com/mail/?authuser=${encodeURIComponent(fact.sourceAccountRef)}#all/${encodeURIComponent(fact.sourceEventId)}`,
    storedAt: row.fetched_at ?? row.sent_at,
    subject: row.subject ?? "",
    bodyText: row.body_text || row.snippet || "",
    bodyRepresentation: row.body_text
      ? "stored_plain_text"
      : row.snippet
        ? "stored_snippet"
        : "unavailable",
  });
}
type MergeFact = Pick<
  ConversationEvent,
  | "organizationId"
  | "roadmapId"
  | "relationshipId"
  | "channel"
  | "kind"
  | "sourceAccountRef"
  | "sourceEventId"
  | "identityKind"
  | "occurredAt"
  | "timestampPrecision"
> & { source?: "stored_gmail" | "reviewed_import" };
/** Reviewed text takes precedence, preserving intentional redactions. No subject/date-only dedupe. */
export function mergeConversationEvents<T extends MergeFact>(reviewed: T[], stored: T[]): T[] {
  const rows = new Map<string, T>();
  for (const event of [...reviewed, ...stored]) {
    const key = JSON.stringify([
      event.organizationId,
      event.roadmapId,
      event.relationshipId,
      conversationIdentity(event),
    ]);
    const old = rows.get(key);
    if (old) {
      if (
        old.kind !== event.kind ||
        Date.parse(old.occurredAt) !== Date.parse(event.occurredAt) ||
        old.timestampPrecision !== event.timestampPrecision
      )
        throw new TrackerRequestError("Conflicting correspondence identity needs review.", 503);
      if (old.source === event.source && JSON.stringify(old) !== JSON.stringify(event))
        throw new TrackerRequestError("Conflicting correspondence copies need review.", 503);
    } else rows.set(key, event);
  }
  return [...rows.values()].sort(
    (a, b) =>
      Date.parse(b.occurredAt) - Date.parse(a.occurredAt) ||
      conversationIdentity(a).localeCompare(conversationIdentity(b)),
  );
}
