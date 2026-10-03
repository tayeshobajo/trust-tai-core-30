import { supabase } from "@/integrations/trust-tai/supabase";
import { dayBounds, projectOutbound } from "@/domain/outreach-today/live";
export const OUTREACH_LIMIT = 200;
export const outreachKey = (org: string, user: string, day: string) => ["outreach-live", org, user, day, "all-member-visible-mailboxes"] as const;
export async function readOutreachToday(organizationId: string, userId: string, day: string) {
  const { start, end } = dayBounds(day);
  const assertUser = async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !userId || data.user?.id !== userId) throw new Error("Sign-in changed. Reload this page.");
  };
  await assertUser();
  const { data, error } = await supabase.from("comms_messages")
    .select("organization_id,provider,provider_message_id,relationship_id,thread_id,direction,from_email,occurred_at,provenance")
    .eq("organization_id", organizationId).eq("direction", "outbound")
    .gte("occurred_at", start).lt("occurred_at", end)
    .order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(OUTREACH_LIMIT + 1);
  if (error) throw new Error("Outbound metadata could not be read. Coverage is unknown.");
  await assertUser();
  if (!Array.isArray(data)) throw new Error("Unexpected metadata response. Coverage is unknown.");
  return { ...projectOutbound(data.slice(0, OUTREACH_LIMIT), organizationId, day), truncated: data.length > OUTREACH_LIMIT };
}
