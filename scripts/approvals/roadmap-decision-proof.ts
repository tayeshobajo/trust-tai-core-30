/**
 * Production proof that an approved roadmap change is resolved by Roadmap,
 * not by Approvals. OPERATIONS ONLY.
 *
 * Drives the exact path the drag gesture drives, against one real open
 * roadmap decision: `dropOutcome -> decide -> executeApprovedRequest ->
 * recordDownstream`. It writes nothing by hand. Afterwards it reads the
 * roadmap decision row, the approval row and the event history back from the
 * database to show what actually changed and what did not.
 *
 * Run: bun scripts/approvals/roadmap-decision-proof.ts <orgId> <userId> [sourceKey]
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
  console.error("FAIL: usage: bun scripts/approvals/roadmap-decision-proof.ts <orgId> <userId>");
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

const { rows } = await approvalsService.listPage(context, {
  tab: "roadmap",
  column: "ready",
  sort: "oldest",
  limit: 50,
});
const candidate = wantedKey
  ? rows.find((row) => row.sourceKey === wantedKey)
  : rows.find((row) => row.approvalType === "roadmap_change");

if (!candidate) {
  console.error("FAIL: no ready Roadmap approval found to prove against.");
  process.exit(1);
}

const payload = (candidate.payload ?? {}) as Record<string, unknown>;
const decisionId = String(payload["decisionId"] ?? "");
console.log(`card       : ${candidate.title}`);
console.log(`source_key : ${candidate.sourceKey}`);
console.log(`decision   : ${decisionId}`);
console.log(`before     : ${String(payload["before"])}`);
console.log(`after      : ${String(payload["after"])}`);
console.log(`affects    : ${JSON.stringify(payload["affects"])}`);
console.log(`provenance : ${JSON.stringify(payload["provenance"])}`);

const beforeRow = await serviceClient
  .from("roadmap_decisions")
  .select("id, status, resolution_note, resolved_by, resolved_at")
  .eq("id", decisionId)
  .maybeSingle();
console.log(`decision before: ${JSON.stringify(beforeRow.data)}`);

const outcome = dropOutcome(candidate, "approved");
if (!outcome.ok) {
  console.error(`FAIL: drag refused: ${outcome.because}`);
  process.exit(1);
}
console.log(`drop action: ${outcome.action.id}`);

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

const afterRow = await serviceClient
  .from("roadmap_decisions")
  .select("id, status, resolution_note, resolved_by, resolved_at")
  .eq("id", decisionId)
  .maybeSingle();
console.log(`decision after: ${JSON.stringify(afterRow.data)}`);

const events = await serviceClient
  .from("approval_events")
  .select("kind, created_at")
  .eq("request_id", candidate.id)
  .order("created_at", { ascending: true });
console.log(`events (${events.data?.length ?? 0}): ${(events.data ?? []).map((e) => e.kind).join(", ")}`);

const row = await serviceClient
  .from("approval_requests")
  .select("status, decision, downstream, revision, payload")
  .eq("id", candidate.id)
  .maybeSingle();
console.log(JSON.stringify({ ...row.data, payload: undefined }, null, 2));
