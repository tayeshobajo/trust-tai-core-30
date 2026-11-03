import { z } from "zod";
export const canonicalEvidenceSchema = z.object({
  canonical: z.object({
    id: z.string(),
    organization_id: z.string(),
    status: z.string(),
    updated_at: z.string(),
  }),
  evidence: z.object({
    state: z.literal("privacy_integration_pending"),
    coverage: z.literal("unknown"),
    sentCount: z.null(),
    interactions: z.null(),
    mailboxSources: z.null(),
  }),
});
export type CanonicalEvidence = z.infer<typeof canonicalEvidenceSchema>;
export type CanonicalEvidenceReader = (
  organizationId: string,
  roadmapId: string,
) => Promise<CanonicalEvidence>;
