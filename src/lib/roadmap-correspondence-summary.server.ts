import { readApprovedCommsFacts } from "./comms-approved-correspondence.server";
import { z } from "zod";
import { activityFactSchema } from "@/domain/roadmap-correspondence-summary";
import {
  canReadStoredMail,
  mergeConversationEvents,
  STORED_MAIL_FACT_COLUMNS,
  storedMailFactSchema,
  storedMailFact,
  readBoundedRows,
  reviewedMailFactSchema,
  REVIEWED_MAIL_FACT_COLUMNS,
  reviewedMailFact,
} from "./roadmap-stored-mail.server";
import {
  authorizeTracker,
  TrackerRequestError,
  trackerErrorResponse,
  trackerHeaders,
} from "./roadmap-tracker-access.server";

/** Status facts only. Never reads body, subject, recipient, HTML, attachment or source-link columns. */
export async function readConversationSummary(request: Request): Promise<Response> {
  if (new URL(request.url).searchParams.get("mode") === "comms")
    return readApprovedCommsFacts(request);
  try {
    const params = new URL(request.url).searchParams;
    const parsed = z
      .object({ organizationId: z.string().uuid() })
      .strict()
      .safeParse(Object.fromEntries(params));
    if (!parsed.success || params.getAll("organizationId").length !== 1)
      throw new TrackerRequestError("Valid workspace required.", 400);
    const { organizationId } = parsed.data;
    const { client, user } = await authorizeTracker(request, organizationId);
    const readMappings = async (reader: typeof client) => {
      const data = await readBoundedRows(
        (from, to) =>
          reader
            .from("roadmaps")
            .select("id, relationship_id", { count: "exact" })
            .eq("organization_id", organizationId)
            .order("id")
            .range(from, to),
        2000,
      );
      const rows = z
        .array(z.object({ id: z.string().uuid(), relationship_id: z.string().uuid().nullable() }))
        .parse(data);
      if (new Set(rows.map((r) => r.id)).size !== rows.length)
        throw new TrackerRequestError("Conversation summary identity is unavailable.", 503);
      return rows;
    };
    const mapping = await readMappings(client);
    const links = new Map(mapping.map((r) => [r.id, r.relationship_id]));
    const commsAllowed = await canReadStoredMail(client, user.id, organizationId);
    const read = await readBoundedRows((from, to) =>
      client
        .from("roadmap_correspondence_events")
        .select(REVIEWED_MAIL_FACT_COLUMNS, { count: "exact" })
        .eq("organization_id", organizationId)
        .order("event_key")
        .range(from, to),
    );
    const reviewed = z.array(reviewedMailFactSchema).parse(read);
    if (
      new Set(reviewed.map((r) => r.event_key)).size !== reviewed.length ||
      reviewed.some(
        (r) =>
          r.organizationId !== organizationId ||
          r.rowOrganizationId !== r.organizationId ||
          r.rowRoadmapId !== r.roadmapId ||
          r.rowRelationshipId !== r.relationshipId ||
          links.get(r.roadmapId) !== r.relationshipId,
      )
    )
      throw new TrackerRequestError("Conversation identity changed.", 409);
    const reviewedFacts = reviewed.map(reviewedMailFact);
    type Fact = Omit<(typeof reviewedFacts)[number], "source"> & {
      source: "reviewed_import" | "stored_gmail";
    };
    const stored: Fact[] = [];
    let omittedUnattributed = 0;
    const relationshipIds = [
      ...new Set(mapping.flatMap((r) => (r.relationship_id ? [r.relationship_id] : []))),
    ];
    if (commsAllowed && relationshipIds.length) {
      const mail = await readBoundedRows((from, to) =>
        client
          .from("comms_messages")
          .select(STORED_MAIL_FACT_COLUMNS, { count: "exact" })
          .eq("organization_id", organizationId)
          .eq("provider", "gmail")
          .in("relationship_id", relationshipIds)
          .order("id")
          .range(from, to),
      );
      const rows = z.array(storedMailFactSchema).parse(mail);
      const ids = new Set<string>();
      for (const row of rows) {
        if (
          row.organization_id !== organizationId ||
          !relationshipIds.includes(row.relationship_id) ||
          ids.has(row.id)
        )
          throw new TrackerRequestError("Stored conversation identity could not be verified.", 503);
        ids.add(row.id);
        for (const link of mapping.filter((r) => r.relationship_id === row.relationship_id)) {
          const fact = storedMailFact(row, link.id);
          if (fact) stored.push(fact);
          else omittedUnattributed++;
        }
      }
    }
    const merged = mergeConversationEvents<Fact>(reviewedFacts, stored);
    const grouped = new Map<
      string,
      {
        roadmapId: string;
        latest: z.infer<typeof activityFactSchema>;
        hasSent: boolean;
        hasReceived: boolean;
        coverage: "partial";
      }
    >();
    for (const row of merged) {
      const fact = { channel: row.channel, kind: row.kind, at: row.occurredAt, source: row.source };
      const old = grouped.get(row.roadmapId);
      grouped.set(row.roadmapId, {
        roadmapId: row.roadmapId,
        // Prepared copy is not the latest correspondence when actual messages exist.
        latest: !old || (old.latest.kind === "draft" && row.kind !== "draft") ? fact : old.latest,
        hasSent: Boolean(old?.hasSent || row.kind === "sent"),
        hasReceived: Boolean(old?.hasReceived || row.kind === "received"),
        coverage: "partial",
      });
    }
    const after = await authorizeTracker(request, organizationId);
    if (after.user.id !== user.id) throw new TrackerRequestError("Session changed.", 401);
    if (JSON.stringify(await readMappings(after.client)) !== JSON.stringify(mapping))
      throw new TrackerRequestError("Conversation identity changed. Refresh the roadmap.", 409);
    if (commsAllowed && !(await canReadStoredMail(after.client, user.id, organizationId)))
      throw new TrackerRequestError("Comms access changed.", 403);
    return Response.json(
      {
        organizationId,
        readAt: new Date().toISOString(),
        records: [...grouped.values()],
        sources: {
          storedGmail: commsAllowed ? "included" : "not_authorized",
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
