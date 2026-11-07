import { z } from "zod";
import { researchResultSchema } from "./studio-research";
import type { ManualResearchAdapter, ManualView } from "./studio-manual-research";
export const manualActionSchema = z
  .object({
    operation: z.enum(["check", "queue", "start", "read", "cancel", "review", "reconcile"]),
    organizationId: z.string().uuid(),
    requestId: z.string().uuid().optional(),
    topic: z.string().trim().min(3).max(1200).optional(),
    approvedUrls: z.array(z.string().url().max(2048)).min(1).max(3).optional(),
    decision: z.enum(["use", "edit", "save", "skip"]).optional(),
    editedText: z.string().min(1).max(5000).optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.operation !== "check" && !v.requestId)
      c.addIssue({ code: "custom", message: "request_required" });
    if (
      v.operation === "queue"
        ? !v.topic || !v.approvedUrls
        : v.topic !== undefined || v.approvedUrls !== undefined
    )
      c.addIssue({ code: "custom", message: "queue_fields_invalid" });
    if (
      v.operation === "review"
        ? !v.decision || (v.decision === "edit") !== !!v.editedText
        : v.decision !== undefined || v.editedText !== undefined
    )
      c.addIssue({ code: "custom", message: "review_fields_invalid" });
  });
export type ManualAction = z.infer<typeof manualActionSchema>;
export const manualViewSchema = z
  .object({
    requestId: z.string().uuid(),
    status: z.enum([
      "queued",
      "started",
      "ready",
      "failed",
      "delivery_uncertain",
      "uncertain",
      "result_acceptance_blocked",
      "stopped",
      "reviewed",
    ]),
    executionStop: z.enum(["unverified", "confirmed"]),
    brief: z
      .object({
        research: researchResultSchema,
        people: z
          .array(
            z.object({
              name: z.string().max(120),
              relevance: z.string().max(600),
              quote: z.string().max(500),
              sourceUrl: z.string().url(),
            }),
          )
          .max(3),
        draft: z.null(),
      })
      .strict()
      .optional(),
    decision: z.enum(["use", "edit", "save", "skip"]).optional(),
  })
  .strict();
export type ManualReply =
  | { status: "available" }
  | { status: "unavailable"; reason: "runtime_not_configured" | "request_unconfirmed" }
  | { status: "ok"; view: ManualView };
/** Same-origin authenticated server-function caller. No retry or transport keys in browser. */
export function createStudioManualAdapter(
  org: string,
  send: (input: ManualAction) => Promise<ManualReply>,
): ManualResearchAdapter {
  async function call(
    operation: ManualAction["operation"],
    requestId: string,
    extra: Partial<ManualAction> = {},
  ) {
    const reply = await send(
      manualActionSchema.parse({ operation, organizationId: org, requestId, ...extra }),
    );
    if (reply.status !== "ok") throw Error("request_unconfirmed");
    const view = parseManualView(reply.view);
    if (view.requestId !== requestId || (view.brief && view.brief.research.requestId !== requestId))
      throw Error("request_mismatch");
    return view;
  }
  return {
    mode: "live",
    approve: (c) => {
      if (c.organizationId !== org) return Promise.reject(Error("organization_mismatch"));
      return call("queue", c.requestId, { topic: c.topic, approvedUrls: c.approvedUrls });
    },
    start: (id) => call("start", id),
    read: (id) => call("read", id),
    cancel: (id) => call("cancel", id),
    reconcile: (id) => call("reconcile", id),
    review: (id, decision, editedText) =>
      call("review", id, { decision, ...(editedText ? { editedText } : {}) }),
  };
}

export function parseManualView(raw: unknown): ManualView {
  const v = manualViewSchema.parse(raw);
  return {
    requestId: v.requestId,
    status: v.status,
    executionStop: v.executionStop,
    ...(v.brief ? { brief: v.brief } : {}),
    ...(v.decision ? { decision: v.decision } : {}),
  };
}
