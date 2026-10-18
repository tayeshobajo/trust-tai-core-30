import { z } from "zod";
import { BOARD_WRITE_ROLES, type BoardTask } from "./cmd-tasks";

export const REQUIRED_WORK_PREFIX = "cmd-meeting-required:v1:";
const uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
export const RequiredWorkInput = z
  .object({
    meetingId: uuid,
    operationId: uuid,
    title: z.string().trim().min(1, "Add a task title.").max(500),
    nextAction: z.string().trim().max(4000),
  })
  .strict();
export type RequiredWorkDraft = z.infer<typeof RequiredWorkInput>;
export function requiredWorkKey(meetingId: string, operationId: string): string {
  const ids = z.object({ meetingId: uuid, operationId: uuid }).parse({ meetingId, operationId });
  return `${REQUIRED_WORK_PREFIX}${ids.meetingId}:${ids.operationId}`;
}
/** Durable scope comes from classified task identity, never an editable link. */
export function requiredMeetingId(
  task: Pick<BoardTask, "correlation_id" | "task_visibility">,
): string | undefined {
  if (task.task_visibility !== "business" || !task.correlation_id?.startsWith(REQUIRED_WORK_PREFIX))
    return undefined;
  const parts = task.correlation_id.slice(REQUIRED_WORK_PREFIX.length).split(":");
  if (parts.length !== 2) return undefined;
  const meeting = uuid.safeParse(parts[0]);
  const operation = uuid.safeParse(parts[1]);
  return meeting.success && operation.success ? meeting.data : undefined;
}
export function mayAddRequiredWork(actor: {
  userId: string;
  organizationId: string;
  role: string;
}): boolean {
  return (
    uuid.safeParse(actor.userId).success &&
    uuid.safeParse(actor.organizationId).success &&
    BOARD_WRITE_ROLES.includes(actor.role)
  );
}
