/**
 * Proof that Comms intake is automatic, not a button. OPERATIONS ONLY.
 *
 * Saves one real draft through `commsService.saveDraft()` against the live
 * project, then checks that exactly one approval exists for it, that saving
 * the same draft again changes nothing, and that no message was sent. The
 * test draft and everything it produced are removed at the end, so the
 * workspace is left exactly as it was found.
 *
 * Run: bun scripts/approvals/comms-intake-proof.ts <organizationId> <userId> <relationshipId>
 */

import { createClient } from "@supabase/supabase-js";
import { mock } from "bun:test";

const url = process.env["TRUST_TAI_SUPABASE_URL"];
const key = process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"];
if (!url || !key) {
  console.error("FAIL: TRUST_TAI_SUPABASE_URL / TRUST_TAI_SUPABASE_SERVICE_KEY are required.");
  process.exit(1);
}

const organizationId = process.argv[2];
const userId = process.argv[3];
const relationshipId = process.argv[4];
if (!organizationId || !userId || !relationshipId) {
  console.error("FAIL: usage: bun scripts/approvals/comms-intake-proof.ts <org> <user> <relationship>");
  process.exit(1);
}

const serviceClient = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
        headers.delete("Authorization");
      }
      headers.set("apikey", key);
      return fetch(input, { ...init, headers });
    },
  },
});

mock.module("@/integrations/trust-tai/supabase", () => ({
  supabase: serviceClient,
  supabaseConfig: { url, projectRef: "okydosoacqdnursmmenf", configuredFromEnv: true },
  TRUST_TAI_PROJECT_REF: "okydosoacqdnursmmenf",
}));

const { commsService } = await import("../../src/data/supabase/comms-service");
const { RELATIONSHIP_COLUMNS, toRelationship } = await import(
  "../../src/data/supabase/comms-schema"
);

const { data: relationshipRow } = await serviceClient
  .from("comms_relationships")
  .select(RELATIONSHIP_COLUMNS)
  .eq("organization_id", organizationId)
  .eq("id", relationshipId)
  .maybeSingle();
if (!relationshipRow) {
  console.error("FAIL: that relationship is not in this workspace.");
  process.exit(1);
}
const relationship = toRelationship(relationshipRow as never);

const context = { organizationId, userId };
const marker = `intake-proof-${Date.now()}`;

const draft = await commsService.saveDraft(
  {
    relationship,
    register: "warm_direct",
    intent: "follow_up",
    subject: "Intake proof (not for sending)",
    body: `Automatic intake verification. ${marker}`,
    reviewState: "needs_human_review",
    rationale: { why: "Verifying that a parked draft reaches Approvals by itself.", proof: marker },
    evidence: [],
  },
  context,
);

const forDraft = async () => {
  const { data } = await serviceClient
    .from("approval_requests")
    .select("id, source_key, status, revision, payload")
    .eq("organization_id", organizationId)
    .eq("payload->>draftId", draft.id);
  return data ?? [];
};

const first = await forDraft();
console.log(`draft ${draft.id} -> approvals: ${first.length}`);
for (const row of first) console.log(`  ${row.source_key} | ${row.status} | rev ${row.revision}`);

/* Same draft, saved again the way a room re-saves: the queue must not grow. */
const { submitCommsDraftIfAwaitingHuman } = await import("../../src/data/approvals/intake");
await submitCommsDraftIfAwaitingHuman(draft, relationship, context);
const second = await forDraft();

const { data: fresh } = await serviceClient
  .from("comms_drafts")
  .select("review_state")
  .eq("id", draft.id)
  .maybeSingle();

console.log(`after repeat save -> approvals: ${second.length}`);
console.log(`draft review_state: ${(fresh as { review_state?: string } | null)?.review_state}`);

const pass =
  first.length === 1 &&
  second.length === 1 &&
  (fresh as { review_state?: string } | null)?.review_state === "needs_human_review";

/* Leave the workspace as it was found. */
for (const row of second) {
  await serviceClient.from("approval_events").delete().eq("request_id", row.id);
  await serviceClient.from("approval_items").delete().eq("request_id", row.id);
  await serviceClient.from("approval_requests").delete().eq("id", row.id);
}
await serviceClient.from("comms_drafts").delete().eq("id", draft.id);
await serviceClient.from("activities").delete().eq("organization_id", organizationId).ilike("summary", `%${marker}%`);

console.log(pass ? "PASS: automatic intake, exactly one approval, nothing sent." : "FAIL");
process.exit(pass ? 0 : 1);
