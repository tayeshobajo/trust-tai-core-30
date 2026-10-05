import { z } from "zod";

export const BOARD_STATUSES = [
  "draft",
  "open",
  "in_progress",
  "waiting",
  "blocked",
  "in_review",
  "needs_approval",
  "complete",
] as const;
export const BOARD_STATUS_LABEL: Record<(typeof BOARD_STATUSES)[number], string> = {
  draft: "Proposed",
  open: "Planned",
  in_progress: "In progress",
  waiting: "Waiting",
  blocked: "Blocked",
  in_review: "In review",
  needs_approval: "Awaiting owner review",
  complete: "Delivered",
};
export const BOARD_WRITE_ROLES = [
  "owner",
  "admin",
  "leadership",
  "project_lead",
  "client_support",
  "team_member",
  "member",
];
export type TaskVisibility = "business" | "personal";
export const BoardTaskSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  title: z.string(),
  task_visibility: z.enum(["business", "personal"]),
  owner_user_id: z.string().uuid().nullable(),
  owner_label: z.string().nullable(),
  created_by: z.string().uuid(),
  status: z.enum(BOARD_STATUSES),
  next_action: z.string(),
  blocked_because: z.string(),
  depends_on_task_id: z.string().uuid().nullable(),
  parent_task_id: z.string().uuid().nullable(),
  completion_evidence: z.string(),
  completed_at: z.string().nullable(),
  completed_by: z.string().uuid().nullable(),
  archived_at: z.string().nullable(),
  due_at: z.string().nullable(),
  updated_at: z.string(),
  revision: z.number().int().nonnegative(),
  acceptance_criteria: z.array(z.string()),
  context_links: z.array(
    z.object({ label: z.string(), url: z.string(), kind: z.string().optional() }),
  ),
  notes: z.string().nullable(),
  correlation_id: z.string().nullable(),
});
export type BoardTask = z.infer<typeof BoardTaskSchema>;
export interface BoardActor {
  userId: string;
  role: string;
}
export function mayEditBoardTask(task: BoardTask, actor: BoardActor): boolean {
  if (!BOARD_WRITE_ROLES.includes(actor.role)) return false;
  if (task.task_visibility === "personal") return task.owner_user_id === actor.userId;
  return (
    task.created_by === actor.userId ||
    task.owner_user_id === actor.userId ||
    ["owner", "admin"].includes(actor.role)
  );
}
export const BoardEditSchema = z
  .object({
    title: z.string().trim().min(1, "Add a task title.").max(500),
    status: z.enum(BOARD_STATUSES),
    next_action: z.string().max(4000),
    blocked_because: z.string().max(4000),
    depends_on_task_id: z.string().uuid().nullable(),
    parent_task_id: z.string().uuid().nullable(),
    notes: z.string().max(10000).nullable(),
    due_at: z.string().datetime().nullable(),
    owner_user_id: z.string().uuid().nullable(),
    completion_evidence: z.string().max(10000),
    acceptance_criteria: z.array(z.string().max(2000)).max(50),
    context_links: z
      .array(
        z.object({
          label: z.string().max(200),
          url: z
            .string()
            .url()
            .refine((v) => /^https?:\/\//i.test(v), "Use a web link."),
        }),
      )
      .max(50),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "blocked" && !value.blocked_because.trim())
      ctx.addIssue({
        code: "custom",
        path: ["blocked_because"],
        message: "Record what is blocking this task.",
      });
    if (value.status === "complete" && value.completion_evidence.trim().length < 10)
      ctx.addIssue({
        code: "custom",
        path: ["completion_evidence"],
        message: "Record the checked result and supporting evidence.",
      });
  });
export type BoardEdit = z.infer<typeof BoardEditSchema>;
export function editOf(task: BoardTask): BoardEdit {
  return {
    title: task.title,
    status: task.status,
    next_action: task.next_action,
    blocked_because: task.blocked_because,
    depends_on_task_id: task.depends_on_task_id,
    parent_task_id: task.parent_task_id,
    notes: task.notes,
    due_at: task.due_at,
    owner_user_id: task.owner_user_id,
    completion_evidence: task.completion_evidence,
    acceptance_criteria: task.acceptance_criteria,
    context_links: task.context_links.map(({ label, url }) => ({ label, url })),
  };
}
