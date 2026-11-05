import { supabase } from "@/integrations/trust-tai/supabase";
import { approvedCorrespondenceReadSchema } from "@/domain/comms-approved-correspondence";

export async function listApprovedCorrespondenceFacts(organizationId: string, userId: string) {
  const before = await supabase.auth.getSession();
  if (before.error || before.data.session?.user.id !== userId)
    throw new Error("Session changed. Reopen Conversations.");
  const response = await fetch(
    `/api/public/roadmap/conversation-summary?${new URLSearchParams({ organizationId, mode: "comms" })}`,
    {
      headers: { Authorization: `Bearer ${before.data.session.access_token}` },
      cache: "no-store",
    },
  );
  if (!response.ok)
    throw new Error(
      "Approved Roadmaps correspondence is unavailable under your current access; coverage is unknown.",
    );
  const result = approvedCorrespondenceReadSchema.parse(await response.json());
  const after = await supabase.auth.getSession();
  if (
    after.error ||
    after.data.session?.user.id !== userId ||
    after.data.session.access_token !== before.data.session.access_token ||
    result.organizationId !== organizationId ||
    result.facts.some((f) => f.organizationId !== organizationId)
  )
    throw new Error("Approved correspondence scope changed. Reopen Conversations.");
  return result.facts;
}
