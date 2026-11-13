/** Browser-safe receipt projection and validated persisted brief. No raw runtime output, tokens, paths or credentials. */
import { z } from "zod";
import { manualViewSchema } from "./studio-manual-wire";
export const attemptActionSchema = z
  .object({
    version: z.literal(2),
    operation: z.enum(["start", "read", "cancel"]),
    organizationId: z.string().uuid(),
    requestId: z.string().uuid(),
    attemptId: z.string().uuid(),
  })
  .strict();
export const attemptViewSchema = z
  .object({
    version: z.literal(2),
    requestId: z.string().uuid(),
    attemptId: z.string().uuid(),
    priorRunId: z.string().uuid(),
    status: z.enum([
      "approved",
      "claimed",
      "admitted",
      "spawn_attempted",
      "child_observed",
      "ready",
      "uncertain",
      "cancel_requested",
    ]),
    brief: manualViewSchema.shape.brief,
  callbackStatus: z
      .enum([
        "approved",
        "claimed",
        "admitted",
        "spawn_attempted",
        "child_observed",
        "ready",
        "uncertain",
        "cancel_requested",
      ])
      .optional(),
    receiptCount: z.number().int().min(0).max(64),
    phase: z
      .enum(["prepare", "admission", "final_authority", "launch", "provider", "cleanup"])
      .nullable(),
    stopEvidence: z.enum(["not_attempted", "immediate_child_closed", "unverified"]),
    providerRequests: z.null(),
    duplicateCostPossible: z.literal(true),
  })
  .strict();
export type AttemptView = z.infer<typeof attemptViewSchema>;
export function createStudioAttemptAdapter(
  send: (input: z.infer<typeof attemptActionSchema>) => Promise<unknown>,
) {
  return async (raw: z.infer<typeof attemptActionSchema>) => {
    const input = attemptActionSchema.parse(raw),
      view = attemptViewSchema.parse(await send(input));
    if (view.requestId !== input.requestId || view.attemptId !== input.attemptId)
      throw Error("attempt_view_mismatch");
    return view;
  };
}
