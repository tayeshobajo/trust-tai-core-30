/**
 * Production Roadmap intake catch-up. OPERATIONS ONLY.
 *
 * Runs the real `backfillRoadmapApprovals()` source-adapter path against the
 * live Trust Tai Supabase project with a server-side service credential, so
 * every submission goes through the same source key, boundary, evidence,
 * revision and idempotency logic the app uses. Nothing here inserts an
 * approval row by hand, and nothing here sends a message.
 *
 * Run: bun scripts/approvals/roadmap-backfill.ts <organizationId> <userId>
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
if (!organizationId || !userId) {
  console.error("FAIL: usage: bun scripts/approvals/roadmap-backfill.ts <organizationId> <userId>");
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

/* The app's single client is browser-shaped; the operator run swaps in the
   server credential and leaves every other line of the intake path alone. */
mock.module("@/integrations/trust-tai/supabase", () => ({
  supabase: serviceClient,
  supabaseConfig: { url, projectRef: "okydosoacqdnursmmenf", configuredFromEnv: true },
  TRUST_TAI_PROJECT_REF: "okydosoacqdnursmmenf",
}));

const { backfillRoadmapApprovals } = await import("../../src/data/approvals/roadmap-intake");

const report = await backfillRoadmapApprovals({ organizationId, userId });
console.log(JSON.stringify(report, null, 2));

const { data } = await serviceClient
  .from("approval_requests")
  .select("source_key, status, source_entity, payload, revision")
  .eq("organization_id", organizationId).eq("source_app", "roadmap")
  .order("created_at", { ascending: true });

console.log(`approval_requests now: ${data?.length ?? 0}`);
for (const row of (data ?? []).slice(0, 3)) {
  const entity = row.source_entity as { type?: string; id?: string } | null;
  const payload = row.payload as { draftId?: string } | null;
  console.log(
    `  ${row.source_key} | ${row.status} | rev ${row.revision} | ${entity?.type}:${entity?.id} | draft ${payload?.draftId}`,
  );
}
