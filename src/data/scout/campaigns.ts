/**
 * Campaign records (browser, RLS as the signed-in member). The table is a
 * proposed Codex-owned migration; until it exists, saving reports unavailable
 * honestly. Drafts themselves always live in Comms and are unaffected.
 */
import { supabase } from "@/integrations/trust-tai/supabase";

const MISSING = /does not exist|schema cache|42P01|PGRST20[0-9]/i;

export type CampaignSave =
  | { stored: true; campaignId: string }
  | { stored: false; because: string };

export async function saveCampaignRecord(input: {
  organizationId: string;
  prospectId: string;
  campaignKey: string;
  name: string;
  subject: string;
  body: string;
  userId: string;
  recipients: { scoutPersonId: string; relationshipId: string | null; draftId: string | null; blockedReason: string | null }[];
}): Promise<CampaignSave> {
  const upsert = await supabase
    .from("scout_campaigns")
    .upsert(
      {
        organization_id: input.organizationId,
        prospect_id: input.prospectId,
        campaign_key: input.campaignKey,
        name: input.name,
        subject_template: input.subject,
        body_template: input.body,
        created_by: input.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,campaign_key" },
    )
    .select("id")
    .maybeSingle();
  if (upsert.error) {
    return MISSING.test(`${upsert.error.code} ${upsert.error.message}`)
      ? { stored: false, because: "Campaigns can't be saved in this workspace yet. The drafts are safe in Comms." }
      : { stored: false, because: "The campaign record could not be saved. The drafts are safe in Comms." };
  }
  const campaignId = String((upsert.data as { id: string }).id);
  if (input.recipients.length > 0) {
    const r = await supabase.from("scout_campaign_recipients").upsert(
      input.recipients.map((x) => ({
        organization_id: input.organizationId,
        campaign_id: campaignId,
        scout_person_id: x.scoutPersonId,
        relationship_id: x.relationshipId,
        draft_id: x.draftId,
        blocked_reason: x.blockedReason,
      })),
      { onConflict: "campaign_id,scout_person_id" },
    );
    if (r.error) return { stored: false, because: "The campaign saved, but its recipients did not. The drafts are safe in Comms." };
  }
  return { stored: true, campaignId };
}
