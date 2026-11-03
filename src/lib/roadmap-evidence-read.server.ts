import { z } from "zod";
import {
  authorizeTracker,
  TrackerRequestError,
  trackerHeaders,
  trackerErrorResponse,
} from "./roadmap-tracker-access.server";

/** Intentionally excludes metadata, free text and all mailbox tables. */
export const EVIDENCE_CANONICAL_COLUMNS =
  "id, organization_id, client_id, prospect_id, relationship_id, status, owner_user_id, updated_at";
const ids = z.object({ organizationId: z.string().uuid(), roadmapId: z.string().uuid() });

/** Phase-one caller-authenticated bridge. No credentials or privilege escalation. */
export async function readRoadmapEvidence(request: Request): Promise<Response> {
  try {
    const parsed = ids.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success)
      throw new TrackerRequestError("Valid organization and roadmap IDs are required.", 400);
    const { organizationId, roadmapId } = parsed.data;
    const { client } = await authorizeTracker(request, organizationId);
    const { data, error } = await client
      .from("roadmaps")
      .select(EVIDENCE_CANONICAL_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("id", roadmapId)
      .maybeSingle();
    if (error) throw new TrackerRequestError("Canonical roadmap read is unavailable.", 503);
    if (!data) throw new TrackerRequestError("Roadmap not found in this workspace.", 404);
    // Explicit projection also prevents unexpected extra upstream fields leaking.
    const canonical = Object.fromEntries(
      EVIDENCE_CANONICAL_COLUMNS.split(", ").map((key) => [
        key,
        data[key as keyof typeof data] ?? null,
      ]),
    );
    return Response.json(
      {
        canonical,
        evidence: {
          state: "privacy_integration_pending",
          coverage: "unknown",
          sentCount: null,
          interactions: null,
          mailboxSources: null,
          reason:
            "Relevant roadmap correspondence is intended for authorized team visibility. Scoped message ingestion and production access enforcement are pending; unrelated mailbox content is excluded.",
        },
      },
      { headers: trackerHeaders },
    );
  } catch (error) {
    return trackerErrorResponse(error);
  }
}
