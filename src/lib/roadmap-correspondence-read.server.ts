import { z } from "zod";
import { createHash } from "node:crypto";
import {
  correspondenceSchema,
  conversationCursorSchema,
  type ConversationEvent,
} from "@/domain/roadmap-correspondence";
import {
  canReadStoredMail,
  mergeConversationEvents,
  STORED_MAIL_FACT_COLUMNS,
  storedMailRowSchema,
  storedMailEvent,
  storedMailFact,
  storedMailFactSchema,
  readBoundedRows,
  REVIEWED_MAIL_FACT_COLUMNS,
  reviewedMailFact,
  reviewedMailFactSchema,
} from "./roadmap-stored-mail.server";
import {
  authorizeTracker,
  TrackerRequestError,
  trackerErrorResponse,
  trackerHeaders,
} from "./roadmap-tracker-access.server";
const querySchema = z
  .object({
    organizationId: z.string().uuid(),
    roadmapId: z.string().uuid(),
    after: conversationCursorSchema.optional(),
  })
  .strict();
const PAGE_SIZE = 25;
/** Caller JWT/RLS only. Stored Gmail requires Comms access as well as Roadmaps. */
export async function readRoadmapCorrespondence(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => params.getAll(key).length !== 1))
      throw new TrackerRequestError("Invalid conversation query.", 400);
    const parsed = querySchema.safeParse(Object.fromEntries(params));
    if (!parsed.success)
      throw new TrackerRequestError("Valid conversation scope is required.", 400);
    const { organizationId, roadmapId, after } = parsed.data;
    const { client, user } = await authorizeTracker(request, organizationId);
    const result = await client
      .from("roadmaps")
      .select("id, organization_id, relationship_id")
      .eq("organization_id", organizationId)
      .eq("id", roadmapId)
      .maybeSingle();
    if (result.error) throw new TrackerRequestError("Conversation identity is unavailable.", 503);
    const mapping = result.data;
    if (!mapping) throw new TrackerRequestError("Roadmap not found in this workspace.", 404);
    if (mapping.id !== roadmapId || mapping.organization_id !== organizationId)
      throw new TrackerRequestError("Conversation identity is unavailable.", 503);
    const relationshipId: string | null = mapping.relationship_id ?? null;
    let omittedUnattributed = 0;
    const commsAllowed = relationshipId
      ? await canReadStoredMail(client, user.id, organizationId)
      : false;
    type Fact = (
      ReturnType<typeof reviewedMailFact> | NonNullable<ReturnType<typeof storedMailFact>>
    ) & { storageKey: string; observation: string | null };
    let facts: Fact[] = [];
    let reviewed: z.infer<typeof reviewedMailFactSchema>[] = [];
    let mail: z.infer<typeof storedMailFactSchema>[] = [];
    if (relationshipId) {
      const rows = await readBoundedRows((from, to) =>
        client
          .from("roadmap_correspondence_events")
          .select(REVIEWED_MAIL_FACT_COLUMNS, { count: "exact" })
          .eq("organization_id", organizationId)
          .eq("roadmap_id", roadmapId)
          .eq("relationship_id", relationshipId)
          .order("event_key")
          .range(from, to),
      );
      reviewed = z.array(reviewedMailFactSchema).parse(rows);
      if (
        new Set(reviewed.map((r) => r.event_key)).size !== reviewed.length ||
        reviewed.some(
          (r) =>
            r.organizationId !== organizationId ||
            r.roadmapId !== roadmapId ||
            r.relationshipId !== relationshipId,
        )
      )
        throw new TrackerRequestError("Conversation scope could not be verified.", 503);
      const storedFacts: Fact[] = [];
      if (commsAllowed) {
        const raw = await readBoundedRows((from, to) =>
          client
            .from("comms_messages")
            .select(STORED_MAIL_FACT_COLUMNS, { count: "exact" })
            .eq("organization_id", organizationId)
            .eq("relationship_id", relationshipId)
            .eq("provider", "gmail")
            .order("id")
            .range(from, to),
        );
        mail = z.array(storedMailFactSchema).parse(raw);
        if (
          new Set(mail.map((r) => r.id)).size !== mail.length ||
          mail.some(
            (r) => r.organization_id !== organizationId || r.relationship_id !== relationshipId,
          )
        )
          throw new TrackerRequestError("Stored conversation scope could not be verified.", 503);
        for (const row of mail) {
          const fact = storedMailFact(row, roadmapId);
          if (fact)
            storedFacts.push({
              ...fact,
              storageKey: row.id,
              observation: row.fetched_at ?? row.sent_at,
            });
          else omittedUnattributed++;
        }
      }
      facts = mergeConversationEvents<Fact>(
        reviewed.map((row) => ({
          ...reviewedMailFact(row),
          storageKey: row.event_key,
          observation: row.review.reviewedAt,
        })),
        storedFacts,
      );
    }
    // Metadata snapshot binds both sources and exact scope. Only this page's
    // bodies are fetched; no whole-history body scan or provider call.
    const snapshot = createHash("sha256")
      .update(
        JSON.stringify([organizationId, roadmapId, relationshipId, commsAllowed, reviewed, mail]),
      )
      .digest("hex");
    const offset = after ? Number(after.split(".")[1]) : 0;
    if (
      after &&
      (after.split(".")[0] !== snapshot || offset >= facts.length || offset % PAGE_SIZE !== 0)
    )
      throw new TrackerRequestError("Conversation changed. Refresh stored messages.", 409);
    const nextCursor =
      offset + PAGE_SIZE < facts.length ? `${snapshot}.${offset + PAGE_SIZE}` : null;
    const page = facts.slice(offset, offset + PAGE_SIZE);
    const bodies = new Map<string, ConversationEvent>();
    const reviewedKeys = page
      .filter((f) => f.source === "reviewed_import")
      .map((f) => f.storageKey);
    if (reviewedKeys.length) {
      const read = await client
        .from("roadmap_correspondence_events")
        .select("event_key, event_payload", { count: "exact" })
        .eq("organization_id", organizationId)
        .eq("roadmap_id", roadmapId)
        .eq("relationship_id", relationshipId)
        .in("event_key", reviewedKeys)
        .limit(PAGE_SIZE);
      if (
        read.error ||
        read.count !== reviewedKeys.length ||
        read.data?.length !== reviewedKeys.length
      )
        throw new TrackerRequestError(
          "Reviewed messages changed or are unavailable. Refresh stored messages.",
          409,
        );
      const rows = z
        .array(z.object({ event_key: z.string(), event_payload: correspondenceSchema }))
        .parse(read.data);
      for (const row of rows) {
        const expected = reviewed.find((r) => r.event_key === row.event_key);
        const { event_payload: e } = row;
        const actual = reviewedMailFactSchema.strip().parse({
          ...e,
          event_key: row.event_key,
          rowOrganizationId: e.organizationId,
          rowRoadmapId: e.roadmapId,
          rowRelationshipId: e.relationshipId,
        });
        if (
          !reviewedKeys.includes(row.event_key) ||
          !expected ||
          JSON.stringify(actual) !== JSON.stringify(expected) ||
          bodies.has(row.event_key)
        )
          throw new TrackerRequestError("Reviewed messages changed. Refresh stored messages.", 409);
        bodies.set(row.event_key, e);
      }
    }
    const mailKeys = page.filter((f) => f.source === "stored_gmail").map((f) => f.storageKey);
    if (mailKeys.length) {
      const read = await client
        .from("comms_messages")
        .select(`${STORED_MAIL_FACT_COLUMNS}, subject, body_text, snippet`, { count: "exact" })
        .eq("organization_id", organizationId)
        .eq("relationship_id", relationshipId)
        .eq("provider", "gmail")
        .in("id", mailKeys)
        .limit(PAGE_SIZE);
      if (read.error || read.count !== mailKeys.length || read.data?.length !== mailKeys.length)
        throw new TrackerRequestError(
          "Stored messages changed or are unavailable. Refresh stored messages.",
          409,
        );
      const rows = z.array(storedMailRowSchema).parse(read.data);
      for (const row of rows) {
        const expected = mail.find((r) => r.id === row.id);
        const event = storedMailEvent(row, roadmapId);
        if (
          !mailKeys.includes(row.id) ||
          !event ||
          !expected ||
          JSON.stringify(storedMailFactSchema.parse(row)) !== JSON.stringify(expected) ||
          bodies.has(row.id)
        )
          throw new TrackerRequestError("Stored messages changed. Refresh stored messages.", 409);
        bodies.set(row.id, event);
      }
    }
    const pageEvents = page.map((f) => bodies.get(f.storageKey)!);
    // Recheck both permission and association before releasing any private body.
    const afterAuth = await authorizeTracker(request, organizationId);
    if (afterAuth.user.id !== user.id) throw new TrackerRequestError("Session changed.", 401);
    const recheck = await afterAuth.client
      .from("roadmaps")
      .select("id, organization_id, relationship_id")
      .eq("organization_id", organizationId)
      .eq("id", roadmapId)
      .maybeSingle();
    if (
      recheck.error ||
      recheck.data?.id !== roadmapId ||
      recheck.data?.organization_id !== organizationId ||
      (recheck.data.relationship_id ?? null) !== relationshipId
    )
      throw new TrackerRequestError("Conversation identity changed. Reopen the roadmap.", 409);
    if (commsAllowed && !(await canReadStoredMail(afterAuth.client, user.id, organizationId)))
      throw new TrackerRequestError("Comms access changed. Reopen the roadmap.", 403);
    return Response.json(
      {
        organizationId,
        roadmapId,
        relationshipId,
        events: pageEvents,
        nextCursor,
        coverage: facts.length || after ? "partial" : "unknown",
        readAt: new Date().toISOString(),
        sources: {
          storedGmail: !relationshipId
            ? "not_linked"
            : commsAllowed
              ? "included"
              : "not_authorized",
          omittedUnattributed,
          providerSync: "not_checked",
        },
      },
      { headers: trackerHeaders },
    );
  } catch (error) {
    return trackerErrorResponse(error);
  }
}
