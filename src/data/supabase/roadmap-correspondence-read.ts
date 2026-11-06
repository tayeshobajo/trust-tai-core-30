import { supabase } from "@/integrations/trust-tai/supabase";
import {
  correspondencePageSchema,
  type CorrespondenceReader,
} from "@/domain/roadmap-correspondence";
export function correspondenceReader(userId: string): CorrespondenceReader {
  return async (organizationId, roadmapId, after) => {
    const before = await supabase.auth.getSession();
    if (before.error || before.data.session?.user.id !== userId)
      throw new Error("Session changed. Reopen the roadmap.");
    const params = new URLSearchParams({ organizationId, roadmapId });
    if (after) params.set("after", after);
    const response = await fetch(`/api/public/roadmap/correspondence?${params}`, {
      headers: { Authorization: `Bearer ${before.data.session.access_token}` },
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(
        "Saved conversations are unavailable or changed. Refresh to recheck access and stored history.",
      );
    const page = correspondencePageSchema.parse(await response.json());
    const current = await supabase.auth.getSession();
    if (
      current.error ||
      current.data.session?.user.id !== userId ||
      current.data.session.access_token !== before.data.session.access_token
    )
      throw new Error("Session changed. Reopen the roadmap.");
    if (
      page.organizationId !== organizationId ||
      page.roadmapId !== roadmapId ||
      page.events.some(
        (e) =>
          e.organizationId !== organizationId ||
          e.roadmapId !== roadmapId ||
          e.relationshipId !== page.relationshipId,
      )
    )
      throw new Error("Conversation identity mismatch.");
    return page;
  };
}

import {
  conversationSummarySchema,
  type ConversationSummaryReader,
} from "@/domain/roadmap-correspondence-summary";
export function conversationSummaryReader(userId: string): ConversationSummaryReader {
  return async (organizationId) => {
    const before = await supabase.auth.getSession();
    if (before.error || before.data.session?.user.id !== userId)
      throw new Error("Session changed.");
    const response = await fetch(
      `/api/public/roadmap/conversation-summary?${new URLSearchParams({ organizationId })}`,
      {
        headers: { Authorization: `Bearer ${before.data.session.access_token}` },
        cache: "no-store",
      },
    );
    if (!response.ok) throw new Error("Conversation summary unavailable.");
    const summary = conversationSummarySchema.parse(await response.json());
    const after = await supabase.auth.getSession();
    if (
      after.error ||
      after.data.session?.user.id !== userId ||
      after.data.session.access_token !== before.data.session.access_token ||
      summary.organizationId !== organizationId
    )
      throw new Error("Conversation summary scope changed.");
    return summary;
  };
}
