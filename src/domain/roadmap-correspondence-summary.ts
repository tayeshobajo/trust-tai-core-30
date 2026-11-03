import { z } from "zod";
export const activityFactSchema = z.object({
  channel: z.enum(["email", "linkedin", "linkedin_sales_navigator"]),
  kind: z.enum(["sent", "received", "draft", "bounce", "team_outbound_copy"]),
  at: z.string().datetime({ offset: true }),
});
export const conversationSummarySchema = z.object({
  organizationId: z.string().uuid(),
  readAt: z.string().datetime({ offset: true }),
  records: z.array(
    z.object({
      roadmapId: z.string().uuid(),
      latest: activityFactSchema,
      hasSent: z.boolean(),
      hasReceived: z.boolean(),
      coverage: z.literal("partial"),
    }),
  ),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
export type ConversationSummaryReader = (organizationId: string) => Promise<ConversationSummary>;
