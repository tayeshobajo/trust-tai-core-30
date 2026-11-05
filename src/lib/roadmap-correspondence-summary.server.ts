import { readApprovedCommsFacts } from "./comms-approved-correspondence.server";
import { z } from "zod";
import { activityFactSchema } from "@/domain/roadmap-correspondence-summary";
import {
  authorizeTracker,
  TrackerRequestError,
  trackerErrorResponse,
  trackerHeaders,
} from "./roadmap-tracker-access.server";
/** Status facts only. No body, subject, recipient, account or source-link columns. */
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
    const mapping = await client
      .from("roadmaps")
      .select("id, relationship_id", { count: "exact" })
      .eq("organization_id", organizationId)
      .limit(2001);
    if (
      mapping.error ||
      !mapping.data ||
      mapping.count === null ||
      mapping.count > 2000 ||
      mapping.data.length !== mapping.count
    )
      throw new TrackerRequestError("Conversation summary is unavailable.", 503);
    const links = new Map<string, string | null>(
      mapping.data.map((r) => [r.id, r.relationship_id]),
    );
    const read = await client
      .from("roadmap_correspondence_events")
      .select(
        "roadmap_id, relationship_id, channel:event_payload->>channel, kind:event_payload->>kind, at:event_payload->>occurredAt",
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .limit(501);
    if (
      read.error ||
      !read.data ||
      read.count === null ||
      read.count > 500 ||
      read.data.length !== read.count
    )
      throw new TrackerRequestError("Conversation summary exceeds its verified read scope.", 503);
    const rows = z
      .array(
        activityFactSchema.extend({
          roadmap_id: z.string().uuid(),
          relationship_id: z.string().uuid(),
        }),
      )
      .safeParse(read.data);
    if (!rows.success)
      throw new TrackerRequestError("Conversation status needs verification.", 503);
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
    for (const row of rows.data) {
      if (links.get(row.roadmap_id) !== row.relationship_id)
        throw new TrackerRequestError("Conversation identity changed.", 409);
      const fact = { channel: row.channel, kind: row.kind, at: row.at };
      const old = grouped.get(row.roadmap_id);
      grouped.set(row.roadmap_id, {
        roadmapId: row.roadmap_id,
        latest: !old || Date.parse(row.at) > Date.parse(old.latest.at) ? fact : old.latest,
        hasSent: Boolean(old?.hasSent || row.kind === "sent"),
        hasReceived: Boolean(old?.hasReceived || row.kind === "received"),
        coverage: "partial",
      });
    }
    const after = await authorizeTracker(request, organizationId);
    if (after.user.id !== user.id) throw new TrackerRequestError("Session changed.", 401);
    return Response.json(
      { organizationId, readAt: new Date().toISOString(), records: [...grouped.values()] },
      { headers: trackerHeaders },
    );
  } catch (error) {
    return trackerErrorResponse(error);
  }
}
