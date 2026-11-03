import { z } from "zod";
import { correspondenceSchema } from "@/domain/roadmap-correspondence";
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
    after: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
const PAGE_SIZE = 25;
/** Reads only previously approved imported events under the existing caller's JWT and RLS. */
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
    let events: z.infer<typeof correspondenceSchema>[] = [];
    let nextCursor: string | null = null;
    if (relationshipId) {
      let q = client
        .from("roadmap_correspondence_events")
        .select("event_key, event_payload")
        .eq("organization_id", organizationId)
        .eq("roadmap_id", roadmapId)
        .eq("relationship_id", relationshipId)
        .order("event_key", { ascending: true })
        .limit(PAGE_SIZE + 1);
      if (after) q = q.gt("event_key", after);
      const read = await q;
      if (read.error) throw new TrackerRequestError("Reviewed conversations are unavailable.", 503);
      const rows = z
        .array(
          z.object({
            event_key: z.string().regex(/^[a-f0-9]{64}$/),
            event_payload: correspondenceSchema,
          }),
        )
        .safeParse(read.data);
      if (!rows.success)
        throw new TrackerRequestError("Reviewed conversation data needs verification.", 503);
      const keys = new Set<string>();
      for (const row of rows.data) {
        const e = row.event_payload;
        if (
          e.organizationId !== organizationId ||
          e.roadmapId !== roadmapId ||
          e.relationshipId !== relationshipId ||
          keys.has(row.event_key) ||
          (after && row.event_key <= after)
        )
          throw new TrackerRequestError("Conversation scope could not be verified.", 503);
        keys.add(row.event_key);
      }
      events = rows.data.slice(0, PAGE_SIZE).map((row) => row.event_payload);
      nextCursor = rows.data.length > PAGE_SIZE ? rows.data[PAGE_SIZE - 1]!.event_key : null;
    }
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
    return Response.json(
      {
        organizationId,
        roadmapId,
        relationshipId,
        events,
        nextCursor,
        coverage: events.length || after ? "partial" : "unknown",
        readAt: new Date().toISOString(),
      },
      { headers: trackerHeaders },
    );
  } catch (error) {
    return trackerErrorResponse(error);
  }
}
