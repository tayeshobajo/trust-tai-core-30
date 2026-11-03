import { supabase } from "@/integrations/trust-tai/supabase";
import {
  canonicalEvidenceSchema,
  type CanonicalEvidenceReader,
} from "@/domain/roadmap-canonical-evidence";
export function canonicalEvidenceReader(userId: string): CanonicalEvidenceReader {
  return async (organizationId, roadmapId) => {
    const session = await supabase.auth.getSession();
    if (session.error || session.data.session?.user.id !== userId)
      throw new Error("Session changed. Reopen the roadmap.");
    const response = await fetch(
      `/api/public/roadmap/evidence?${new URLSearchParams({ organizationId, roadmapId })}`,
      {
        headers: { Authorization: `Bearer ${session.data.session.access_token}` },
        cache: "no-store",
      },
    );
    if (!response.ok) throw new Error("Canonical read unavailable. No evidence has been changed.");
    const result = canonicalEvidenceSchema.parse(await response.json());
    const after = await supabase.auth.getSession();
    if (after.error || after.data.session?.user.id !== userId)
      throw new Error("Session changed. Reopen the roadmap.");
    if (result.canonical.id !== roadmapId || result.canonical.organization_id !== organizationId)
      throw new Error("Canonical identity mismatch. Reopen the roadmap.");
    return result;
  };
}
