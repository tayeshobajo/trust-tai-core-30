import { z } from "zod";
const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const sourceUrl = z
  .string()
  .url()
  .refine((s) => {
    const u = new URL(s);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.hash.includes("access_token") &&
      ![...u.searchParams.keys()].some((k) => /token|secret|key|password|code/i.test(k)) &&
      ["mail.google.com", "www.linkedin.com", "linkedin.com"].includes(u.hostname)
    );
  }, "Only credential-free supported source links are accepted");
export const correspondenceSchema = z
  .object({
    organizationId: uuid,
    roadmapId: uuid,
    relationshipId: uuid,
    roadmapRevision: timestamp,
    relationshipRevision: timestamp,
    channel: z.enum(["email", "linkedin", "linkedin_sales_navigator"]),
    kind: z.enum(["sent", "received", "draft", "bounce", "team_outbound_copy"]),
    sourceAccountRef: z.string().min(1).max(200),
    sourceEventId: z.string().min(1).max(300), // Actual provider ID or reviewer-assigned receipt ID, never fabricated Gmail IDs.
    identityKind: z.enum(["provider_id", "reviewed_receipt"]),
    sourceUrl,
    occurredAt: timestamp,
    timestampPrecision: z.enum(["exact", "approximate"]),
    verifiedAt: timestamp,
    subject: z.string().max(1000),
    bodyText: z.string().min(1).max(100000),
    bodyRepresentation: z.enum(["reviewed_full_text", "reviewed_redacted_excerpt"]),
    review: z
      .object({
        reviewerId: uuid,
        reviewedAt: timestamp,
        relevance: z.literal("roadmap_correspondence"),
        identity: z.literal("verified"),
        audience: z.literal("authorized_roadmap_team"),
        unrelatedContentExcluded: z.literal(true),
        quotedHistoryExcluded: z.literal(true),
        secretsExcluded: z.literal(true),
        attachmentsExcluded: z.literal(true),
        sourceRef: z.string().min(1).max(300),
      })
      .strict(),
  })
  .strict();
export type Correspondence = z.infer<typeof correspondenceSchema>;

export const correspondencePageSchema = z
  .object({
    organizationId: z.string().uuid(),
    roadmapId: z.string().uuid(),
    relationshipId: z.string().uuid().nullable(),
    events: z.array(correspondenceSchema),
    nextCursor: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    coverage: z.enum(["unknown", "partial"]),
    readAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type CorrespondencePage = z.infer<typeof correspondencePageSchema>;
export type CorrespondenceReader = (
  organizationId: string,
  roadmapId: string,
  after?: string | null,
) => Promise<CorrespondencePage>;
