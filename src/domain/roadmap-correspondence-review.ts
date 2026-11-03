import { z } from "zod";
import { correspondenceSchema } from "./roadmap-correspondence";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const reviewScopeSchema = z
  .object({
    reviewId: z.string().uuid(),
    organizationId: z.string().uuid(),
    expectedDigest: hash,
  })
  .strict();
export type ReviewScope = z.infer<typeof reviewScopeSchema>;
export const reviewedEnvelopeSchema = z
  .object({
    version: z.literal(1),
    organizationId: z.string().uuid(),
    importerId: z.string().uuid(),
    approverId: z.string().uuid(),
    expiresAt: z.string().datetime({ offset: true }),
    audience: z
      .array(z.string().uuid())
      .min(1)
      .max(2000)
      .refine((ids) => new Set(ids).size === ids.length),
    audiencePolicy: z.literal("authorized_roadmap_team_with_future_members"),
    selections: z
      .array(z.object({ event: correspondenceSchema, mappingDigest: hash }).strict())
      .min(1)
      .max(250),
  })
  .strict()
  .superRefine((envelope, ctx) => {
    const identities = new Set<string>();
    for (const { event } of envelope.selections) {
      const identity = JSON.stringify([event.channel, event.sourceAccountRef, event.sourceEventId]);
      if (event.organizationId !== envelope.organizationId || identities.has(identity))
        ctx.addIssue({ code: "custom", message: "Review scope or duplicate source mismatch" });
      identities.add(identity);
    }
    if (
      !envelope.audience.includes(envelope.approverId) ||
      !envelope.audience.includes(envelope.importerId)
    )
      ctx.addIssue({
        code: "custom",
        message: "Review principals must be in the initial audience snapshot",
      });
  });
export const reviewReceiptSchema = z
  .object({
    reviewId: z.string().uuid(),
    digest: hash,
    envelope: reviewedEnvelopeSchema,
    approvedAt: z.string().datetime({ offset: true }).nullable(),
    approvedBy: z.string().uuid().nullable(),
  })
  .strict();
export type ReviewReceipt = z.infer<typeof reviewReceiptSchema>;
export type ReviewAction = (scope: ReviewScope, confirm?: boolean) => Promise<ReviewReceipt>;
