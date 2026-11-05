import { z } from "zod";
import { approvedCorrespondenceFactSchema } from "@/domain/comms-approved-correspondence";
import { correspondenceSchema } from "@/domain/roadmap-correspondence";
import {
  authorizeTracker,
  TrackerRequestError,
  trackerErrorResponse,
  trackerHeaders,
} from "./roadmap-tracker-access.server";

/** Existing Roadmaps entitlement + caller JWT/RLS; no service client or bodies. */
export async function readApprovedCommsFacts(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const parsed = z
      .object({ organizationId: z.string().uuid(), mode: z.literal("comms") })
      .strict()
      .safeParse(Object.fromEntries(params));
    if (!parsed.success || [...params.keys()].some((k) => params.getAll(k).length !== 1))
      throw new TrackerRequestError("Valid workspace required.", 400);
    const { organizationId } = parsed.data;
    const before = await authorizeTracker(request, organizationId);
    const mapping = async (client: typeof before.client) => {
      const r = await client
        .from("roadmaps")
        .select("id, relationship_id", { count: "exact" })
        .eq("organization_id", organizationId)
        .order("id")
        .limit(2001);
      if (r.error || !r.data || r.count === null || r.count > 2000 || r.data.length !== r.count)
        throw new TrackerRequestError(
          "Approved correspondence identity coverage is unavailable.",
          503,
        );
      const rows = z
        .array(z.object({ id: z.string().uuid(), relationship_id: z.string().uuid().nullable() }))
        .parse(r.data);
      if (new Set(rows.map((r) => r.id)).size !== rows.length)
        throw new TrackerRequestError("Duplicate correspondence identity.", 503);
      return rows;
    };
    const links = await mapping(before.client);
    const read = await before.client
      .from("roadmap_correspondence_events")
      .select(
        "eventKey:event_key, organizationId:organization_id, roadmapId:roadmap_id, relationshipId:relationship_id, channel:event_payload->>channel, kind:event_payload->>kind, occurredAt:event_payload->>occurredAt, timestampPrecision:event_payload->>timestampPrecision, sourceAccountRef:event_payload->>sourceAccountRef, sourceEventId:event_payload->>sourceEventId, identityKind:event_payload->>identityKind, review:event_payload->review, payloadOrganizationId:event_payload->>organizationId, payloadRoadmapId:event_payload->>roadmapId, payloadRelationshipId:event_payload->>relationshipId",
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .order("event_key")
      .limit(501);
    if (
      read.error ||
      !read.data ||
      read.count === null ||
      read.count > 500 ||
      read.data.length !== read.count
    )
      throw new TrackerRequestError(
        "Approved correspondence exceeds its verified read scope.",
        503,
      );
    const rows = z
      .array(
        approvedCorrespondenceFactSchema.extend({
          review: correspondenceSchema.shape.review,
          payloadOrganizationId: z.string().uuid(),
          payloadRoadmapId: z.string().uuid(),
          payloadRelationshipId: z.string().uuid(),
        }),
      )
      .parse(read.data);
    if (
      new Set(rows.map((r) => r.eventKey)).size !== rows.length ||
      rows.some(
        (r) =>
          r.organizationId !== organizationId ||
          r.payloadOrganizationId !== r.organizationId ||
          r.payloadRoadmapId !== r.roadmapId ||
          r.payloadRelationshipId !== r.relationshipId ||
          !links.some((l) => l.id === r.roadmapId && l.relationship_id === r.relationshipId),
      )
    )
      throw new TrackerRequestError("Approved correspondence identity mismatch.", 409);
    // Recheck access and exact mappings before releasing even metadata.
    const after = await authorizeTracker(request, organizationId);
    if (
      after.user.id !== before.user.id ||
      JSON.stringify(await mapping(after.client)) !== JSON.stringify(links)
    )
      throw new TrackerRequestError("Approved correspondence scope changed.", 409);
    return Response.json(
      {
        organizationId,
        readAt: new Date().toISOString(),
        coverage: "partial",
        facts: rows.map((row) => approvedCorrespondenceFactSchema.strip().parse(row)),
      },
      { headers: trackerHeaders },
    );
  } catch (error) {
    return trackerErrorResponse(error);
  }
}
