import { z } from "zod";
import type { Roadmap } from "./roadmap";
import { PIPELINE_STAGES, roadmapRevision, trackerState } from "./roadmap-tracker";
import { sha256 } from "./sha256";

const short = z.string().trim().max(200).nullable();
const note = z.string().trim().max(4000).nullable();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .refine(
    (s) => Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s,
    "Enter a real calendar date.",
  )
  .nullable();
const links = z
  .string()
  .trim()
  .max(4000)
  .refine(
    (s) =>
      !s ||
      s.split(/\s+/).every((v) => {
        try {
          return ["https:", "http:"].includes(new URL(v).protocol);
        } catch {
          return false;
        }
      }),
    "Use complete http or https links, separated by spaces or new lines.",
  )
  .nullable();

export const trackerPatchSchema = z
  .object({
    pipelineStage: z.enum(PIPELINE_STAGES).nullable().optional(),
    priority: short.optional(),
    ownerUserId: z.string().uuid().nullable().optional(),
    nextAction: note.optional(),
    followUpDate: date.optional(),
    channel: short.optional(),
    conversationPosition: note.optional(),
    clientSignal: note.optional(),
    keyLinks: links.optional(),
    dateSent: date.optional(),
    lastMeaningfulUpdate: date.optional(),
    dateClosed: date.optional(),
    endOfWeekStatus: note.optional(),
    conversionDays: z
      .string()
      .regex(/^\d+$/, "Use a whole number of days.")
      .refine((s) => Number(s) <= 100000, "Days must be 100000 or less.")
      .nullable()
      .optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, "Change at least one field.");
export type TrackerPatch = z.infer<typeof trackerPatchSchema>;
export type EditField = keyof TrackerPatch;
export const EDIT_LABELS: Record<EditField, string> = {
  pipelineStage: "Pipeline stage",
  priority: "Priority",
  ownerUserId: "Owner",
  nextAction: "Next action",
  followUpDate: "Follow-up date",
  channel: "Comms channel",
  conversationPosition: "Conversation position",
  clientSignal: "Client signal",
  keyLinks: "Key links",
  dateSent: "Preview date sent",
  lastMeaningfulUpdate: "Last meaningful update",
  dateClosed: "Date closed",
  endOfWeekStatus: "End-of-week status",
  conversionDays: "Conversion turnaround (days)",
};
export interface TrackerEdit {
  id: string;
  actorUserId: string;
  at: string;
  fingerprint: string;
  changes: { field: EditField; before: string | null; after: string | null }[];
}
export interface TrackerOwner {
  userId: string;
  label: string;
}
export function editHistory(roadmap: Roadmap): TrackerEdit[] {
  const raw = roadmap.metadata["outreach_tracker"] as { edits?: TrackerEdit[] } | undefined;
  return Array.isArray(raw?.edits) ? raw.edits : [];
}
export function editableValues(roadmap: Roadmap): Record<EditField, string | null> {
  const fields = trackerState(roadmap).fields as Record<string, string | null>;
  return Object.fromEntries(
    Object.keys(EDIT_LABELS).map((key) => [
      key,
      key === "ownerUserId"
        ? (roadmap.ownerUserId ?? null)
        : key === "nextAction"
          ? (roadmap.nextMove?.action ?? null)
          : (fields[key] ?? null),
    ]),
  ) as Record<EditField, string | null>;
}
export function editFingerprint(roadmapId: string, actor: string, patch: TrackerPatch): string {
  return sha256(
    JSON.stringify([
      roadmapId,
      actor,
      Object.keys(patch)
        .sort()
        .map((k) => [k, patch[k as EditField]]),
    ]),
  );
}
export function prepareTrackerEdit(
  roadmap: Roadmap,
  patch: TrackerPatch,
  actor: string,
  id: string,
  at: string,
) {
  const before = editableValues(roadmap);
  const changes = (Object.keys(patch) as EditField[])
    .map((field) => ({ field, before: before[field], after: patch[field] ?? null }))
    .filter((c) => c.before !== c.after);
  const edit: TrackerEdit = {
    id,
    actorUserId: actor,
    at,
    fingerprint: editFingerprint(roadmap.id, actor, patch),
    changes,
  };
  const existing = roadmap.metadata["outreach_tracker"];
  const tracker =
    existing && typeof existing === "object" ? (existing as Record<string, unknown>) : {};
  const fields = { ...trackerState(roadmap).fields } as Record<string, string | null>;
  for (const c of changes)
    if (c.field !== "ownerUserId" && c.field !== "nextAction") fields[c.field] = c.after;
  return {
    edit,
    patch: {
      metadata: {
        ...roadmap.metadata,
        outreach_tracker: {
          ...tracker,
          fields,
          edits: [...editHistory(roadmap), edit],
          lastEditedAt: at,
        },
      },
      ...(patch.ownerUserId !== undefined ? { owner_user_id: patch.ownerUserId } : {}),
      ...(patch.nextAction !== undefined
        ? {
            next_move: patch.nextAction
              ? {
                  ...roadmap.nextMove,
                  action: patch.nextAction,
                  because: roadmap.nextMove?.because || "Updated by a team member in the tracker.",
                  tier: "decided",
                }
              : null,
          }
        : {}),
      updated_at: at,
    },
  };
}
export { roadmapRevision };
