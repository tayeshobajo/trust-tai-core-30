import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ROADMAP_COLUMNS, toRoadmap, type Row } from "@/data/supabase/roadmap-schema";
import {
  editFingerprint,
  editHistory,
  prepareTrackerEdit,
  roadmapRevision,
  trackerPatchSchema,
  type TrackerEdit,
} from "@/domain/roadmap-tracker-edit";
import {
  authorizeTracker,
  TrackerRequestError,
  trackerErrorResponse,
  trackerHeaders,
} from "./roadmap-tracker-access.server";

const requestSchema = z
  .object({
    organizationId: z.string().uuid(),
    roadmapId: z.string().uuid(),
    operationId: z.string().uuid(),
    expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
    patch: trackerPatchSchema,
  })
  .strict();
async function read(client: SupabaseClient, org: string, id: string): Promise<Row> {
  const result = await client
    .from("roadmaps")
    .select(ROADMAP_COLUMNS)
    .eq("organization_id", org)
    .eq("id", id)
    .maybeSingle();
  if (result.error)
    throw new TrackerRequestError(
      "The saved roadmap could not be read. Keep your edits and try reading again.",
      503,
    );
  if (!result.data)
    throw new TrackerRequestError("That roadmap is not available in this workspace.", 404);
  return result.data as Row;
}
/** The row history commits atomically with the edit. The existing suite stream
 * receives the same operation ID; failure is reported without re-saving data. */
async function mirror(
  client: SupabaseClient,
  org: string,
  id: string,
  edit: TrackerEdit,
): Promise<string | null> {
  try {
    const result = await client.from("activities").insert({
      id: edit.id,
      organization_id: org,
      app_key: "roadmap",
      event_type: "roadmap.tracker_updated",
      actor_user_id: edit.actorUserId,
      entity_type: "roadmap",
      entity_id: id,
      summary: "Tracker fields updated by a team member.",
      occurred_at: edit.at,
      source_event_key: `roadmap.tracker:${id}:${edit.id}`,
      payload: { tracker_edit: edit },
      provenance: {
        appId: "roadmap",
        actor: { type: "user", id: edit.actorUserId },
        observedAt: edit.at,
        confidence: "observed",
      },
    });
    if (!result.error || result.error.code === "23505") return null;
  } catch {
    /* The durable row history remains the recovery receipt. */
  }
  return "Saved with edit history. The shared activity stream could not be updated; check the saved state to retry that history sync.";
}
export async function readEditableTracker(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const org = z.string().uuid().parse(params.get("organizationId"));
    const id = z.string().uuid().parse(params.get("roadmapId"));
    const { client, access } = await authorizeTracker(request, org);
    return Response.json(
      { roadmap: toRoadmap(await read(client, org, id)), canWork: access.canWork },
      { headers: trackerHeaders },
    );
  } catch (error) {
    return trackerErrorResponse(
      error instanceof z.ZodError
        ? new TrackerRequestError("Choose an existing roadmap.", 400)
        : error,
    );
  }
}
export async function saveTrackerEdit(request: Request): Promise<Response> {
  try {
    const body = await request.text();
    if (body.length > 32000) throw new TrackerRequestError("This edit is too large.", 400);
    let input: z.infer<typeof requestSchema>;
    try {
      input = requestSchema.parse(JSON.parse(body));
    } catch (error) {
      throw new TrackerRequestError(
        error instanceof z.ZodError
          ? error.issues.map((x) => x.message).join(" ")
          : "This edit could not be read.",
        400,
      );
    }
    const { organizationId: org, roadmapId: id, patch, operationId } = input;
    const { client, user } = await authorizeTracker(request, org, true);
    const raw = await read(client, org, id);
    const current = toRoadmap(raw);
    const prior = editHistory(current).find((e) => e.id === operationId);
    const fingerprint = editFingerprint(id, user.id, patch);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new TrackerRequestError(
          "This save ID was used for a different edit. Read the latest state before saving again.",
          409,
        );
      return Response.json(
        { roadmap: current, replayed: true, warning: await mirror(client, org, id, prior) },
        { headers: trackerHeaders },
      );
    }
    if (roadmapRevision(current) !== input.expectedRevision)
      return Response.json(
        {
          error:
            "This roadmap changed since you opened it. Compare the saved values before trying again.",
          current,
        },
        { status: 409, headers: trackerHeaders },
      );
    if (patch.ownerUserId && patch.ownerUserId !== current.ownerUserId) {
      const owner = await client
        .from("organization_memberships")
        .select("user_id, status")
        .eq("organization_id", org)
        .eq("user_id", patch.ownerUserId)
        .eq("status", "active")
        .maybeSingle();
      if (owner.error || !owner.data)
        throw new TrackerRequestError(
          "Choose an active owner available to you in this workspace.",
          400,
        );
    }
    const prepared = prepareTrackerEdit(
      current,
      patch,
      user.id,
      operationId,
      new Date().toISOString(),
    );
    if (!prepared.edit.changes.length)
      return Response.json({ roadmap: current, unchanged: true }, { headers: trackerHeaders });
    // Keep unknown next_move keys owned by other roadmap tools.
    if (prepared.patch.next_move && raw["next_move"] && typeof raw["next_move"] === "object")
      prepared.patch.next_move = { ...(raw["next_move"] as object), ...prepared.patch.next_move };
    let update = client
      .from("roadmaps")
      .update(prepared.patch)
      .eq("id", id)
      .eq("organization_id", org)
      .eq("updated_at", raw["updated_at"])
      .eq("status", raw["status"])
      .eq("metadata", JSON.stringify(raw["metadata"]));
    update =
      raw["owner_user_id"] == null
        ? update.is("owner_user_id", null)
        : update.eq("owner_user_id", raw["owner_user_id"]);
    update =
      raw["next_move"] == null
        ? update.is("next_move", null)
        : update.eq("next_move", JSON.stringify(raw["next_move"]));
    // No retry of the write. Read the durable receipt after any uncertain result.
    let failed = false;
    try {
      const result = await update.select(ROADMAP_COLUMNS).maybeSingle();
      failed = Boolean(result.error);
    } catch {
      failed = true;
    }
    const after = toRoadmap(await read(client, org, id));
    const receipt = editHistory(after).find(
      (e) => e.id === operationId && e.fingerprint === fingerprint,
    );
    if (receipt)
      return Response.json(
        { roadmap: after, warning: await mirror(client, org, id, receipt) },
        { headers: trackerHeaders },
      );
    if (failed)
      throw new TrackerRequestError(
        "Save was not confirmed. Your edits are retained. Check the saved state before retrying this save.",
        503,
      );
    return Response.json(
      {
        error:
          "Another edit won the save. Compare the latest saved values; your draft is retained.",
        current: after,
      },
      { status: 409, headers: trackerHeaders },
    );
  } catch (error) {
    return trackerErrorResponse(error);
  }
}
