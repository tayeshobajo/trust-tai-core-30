/**
 * Production proof of the drag gesture, without a browser. OPERATIONS ONLY.
 *
 * The board's drag from Ready to Approved is not its own code path: it resolves
 * the card's own authorising action and then runs exactly what the workspace
 * button runs. This script drives that same sequence against the live project:
 *
 *   dropOutcome -> approvalsService.decide -> executeApprovedRequest -> recordDownstream
 *
 * It approves copy and stops. Nothing here sends, and nothing here writes a
 * message row: Comms still owns the Send boundary.
 *
 * Run: bun scripts/approvals/comms-decision-proof.ts <organizationId> <userId> [sourceKey]
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
const wantedKey = process.argv[4];
if (!organizationId || !userId) {
  console.error("FAIL: usage: bun scripts/approvals/comms-decision-proof.ts <orgId> <userId>");
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

const { approvalsService } = await import("../../src/data/supabase/approvals-service");
const { executeApprovedRequest } = await import("../../src/data/approvals/execution");
const { dropOutcome } = await import("../../src/domain/approvals");

const context = { organizationId, userId };

/* Pick one real Comms card that is genuinely waiting. */
const { rows } = await approvalsService.listPage(context, {
  tab: "comms",
  column: "ready",
  sort: "oldest",
  limit: 50,
});
const candidate = wantedKey
  ? rows.find((row) => row.sourceKey === wantedKey)
  : rows.find((row) => row.approvalType === "comms_draft");

if (!candidate) {
  console.error("FAIL: no ready Comms approval found to prove against.");
  process.exit(1);
}

const draftId = String((candidate.payload as Record<string, unknown> | undefined)?.["draftId"] ?? "");
console.log(`card       : ${candidate.title}`);
console.log(`source_key : ${candidate.sourceKey}`);
console.log(`draft      : ${draftId}`);
console.log(`status     : ${candidate.status}`);

const before = await serviceClient
  .from("comms_drafts")
  .select("id, review_state, updated_at")
  .eq("id", draftId)
  .maybeSingle();
console.log(`draft state before: ${before.data?.review_state}`);

const messagesBefore = await serviceClient
  .from("comms_messages")
  .select("id", { count: "exact", head: true })
  .eq("organization_id", organizationId);
console.log(`comms_messages before: ${messagesBefore.count}`);

/* 1. The gesture. */
const outcome = dropOutcome(candidate, "approved");
if (!outcome.ok) {
  console.error(`FAIL: drag refused: ${outcome.because}`);
  process.exit(1);
}
console.log(`drop action: ${outcome.action.id} (confirm: ${Boolean(outcome.confirm)})`);

/* 2. The decision. */
const approved = await approvalsService.decide(context, {
  requestId: candidate.id,
  to: "approved",
  decision: {
    decision: "approve",
    decidedBy: { id: userId, label: "Production proof" },
    decidedAt: new Date().toISOString(),
  },
});
console.log(`after decide: ${approved.status}`);

/* 3. The hand-off to the owning room. */
const execution = await executeApprovedRequest(approved, context);
console.log(`execution: ${execution.result.state} -> ${execution.result.reference}`);
console.log(`because: ${execution.result.because}`);

await approvalsService.recordDownstream(
  context,
  candidate.id,
  execution.result,
  execution.nextStatus,
);

/* --------------------------------------------------------------- verify */

const after = await serviceClient
  .from("comms_drafts")
  .select("id, review_state, updated_at")
  .eq("id", draftId)
  .maybeSingle();
console.log(`draft state after: ${after.data?.review_state}`);

const messagesAfter = await serviceClient
  .from("comms_messages")
  .select("id", { count: "exact", head: true })
  .eq("organization_id", organizationId);
console.log(`comms_messages after: ${messagesAfter.count}`);

const events = await serviceClient
  .from("approval_events")
  .select("kind, at, actor, detail")
  .eq("request_id", candidate.id)
  .order("at", { ascending: true });
console.log(`events (${events.data?.length ?? 0}):`);
for (const event of events.data ?? []) {
  console.log(`  ${event.kind} @ ${event.at}`);
}

const row = await serviceClient
  .from("approval_requests")
  .select("status, decision, downstream, revision")
  .eq("id", candidate.id)
  .maybeSingle();
console.log(JSON.stringify(row.data, null, 2));
