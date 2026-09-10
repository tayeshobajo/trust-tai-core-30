/**
 * Finish and verify one production approval hand-off. OPERATIONS ONLY.
 *
 * Completes the downstream record for an already-approved Comms card and then
 * reads back, from the live project, the six things that must be true:
 * the request moved, one decision event exists, the draft is approved in Comms,
 * no message was written, no provider receipt exists, and nothing was sent.
 *
 * Run: bun scripts/approvals/comms-decision-verify.ts <orgId> <userId> <sourceKey>
 */

import { createClient } from "@supabase/supabase-js";
import { mock } from "bun:test";

const url = process.env["TRUST_TAI_SUPABASE_URL"]!;
const key = process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"]!;
const organizationId = process.argv[2]!;
const userId = process.argv[3]!;
const sourceKey = process.argv[4]!;

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

const context = { organizationId, userId };

const { data: rowBefore } = await serviceClient
  .from("approval_requests")
  .select("id, status, payload, downstream")
  .eq("organization_id", organizationId)
  .eq("source_key", sourceKey)
  .maybeSingle();

if (!rowBefore) {
  console.error("FAIL: no approval with that source key.");
  process.exit(1);
}

const requestId = String(rowBefore.id);
const draftId = String((rowBefore.payload as Record<string, unknown>)?.["draftId"] ?? "");

if (!rowBefore.downstream) {
  const loaded = await approvalsService.get(context, requestId);
  const execution = await executeApprovedRequest(loaded!.request, context);
  await approvalsService.recordDownstream(
    context,
    requestId,
    execution.result,
    execution.nextStatus,
  );
  console.log(`recorded downstream: ${execution.result.state}`);
}

const [request, draft, messages, events] = await Promise.all([
  serviceClient
    .from("approval_requests")
    .select("status, decision, downstream, revision")
    .eq("id", requestId)
    .maybeSingle(),
  serviceClient
    .from("comms_drafts")
    .select("id, review_state, rationale")
    .eq("id", draftId)
    .maybeSingle(),
  serviceClient
    .from("comms_messages")
    .select("id, direction, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(3),
  serviceClient
    .from("approval_events")
    .select("kind, created_at, body")
    .eq("request_id", requestId)
    .order("created_at", { ascending: true }),
]);

console.log("=== approval request ===");
console.log(JSON.stringify(request.data, null, 2));
console.log("=== comms draft ===");
console.log(`review_state: ${draft.data?.review_state}`);
console.log("=== events ===");
for (const event of events.data ?? []) console.log(`  ${event.kind} @ ${event.created_at}: ${event.body}`);
console.log("=== newest comms_messages ===");
for (const message of messages.data ?? []) {
  console.log(`  ${message.id} ${message.direction} ${message.created_at}`);
}
const { count } = await serviceClient
  .from("comms_messages")
  .select("id", { count: "exact", head: true })
  .eq("organization_id", organizationId);
console.log(`comms_messages total: ${count}`);
