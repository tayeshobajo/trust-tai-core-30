/**
 * Prepare one real editorial batch in production. OPERATIONS ONLY.
 *
 * Runs the real Content Engine and the real Marketing source adapter against
 * the live Trust Tai backend with a server credential. Nothing here writes an
 * article by hand, nothing here approves anything, and nothing here publishes.
 * Internal links are resolved only against the real trusttai.com inventory in
 * `website_pages`.
 *
 * Run: bun scripts/content/production-batch.ts <organizationId> <userId> "<keyword>" [count]
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
const keyword = process.argv[4];
const count = Math.min(Math.max(Number(process.argv[5] ?? 10) || 10, 1), 12);
if (!organizationId || !userId || !keyword) {
  console.error(
    'FAIL: usage: bun scripts/content/production-batch.ts <organizationId> <userId> "<keyword>" [count]',
  );
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

const { runContentCommand } = await import("../../src/lib/content-engine.server");
const { contentService } = await import("../../src/data/supabase/content-service");
const { submitContentBatchForApproval } = await import("../../src/data/content/intake");

const context = { organizationId, userId };

const pages = await serviceClient
  .from("website_pages")
  .select("path,title")
  .eq("organization_id", organizationId)
  .limit(200);
const knownPaths = (pages.data ?? []).map((row) => ({
  path: String(row.path ?? ""),
  title: String(row.title ?? ""),
}));
console.log(`known paths: ${knownPaths.length}`);

let plan: Record<string, unknown> | null = null;
const items: Record<string, unknown>[] = [];

for await (const stage of runContentCommand({
  token: key,
  organizationId,
  keyword,
  count,
  knownPaths,
})) {
  console.log(`[${stage.stage}] ${stage.message}`);
  if (stage.stage === "plan" && stage.data) plan = stage.data as Record<string, unknown>;
  if (stage.stage === "post" && stage.data) items.push(stage.data as Record<string, unknown>);
}

if (!plan) {
  console.error("FAIL: the run ended without a plan.");
  process.exit(1);
}

const batch = await contentService.createBatch(context, {
  keyword: String(plan["keyword"] ?? keyword),
  topicCluster: (plan["topicCluster"] ?? []) as string[],
  searchIntent: String(plan["searchIntent"] ?? ""),
  audienceProblem: String(plan["audienceProblem"] ?? ""),
  whyTogether: String(plan["whyTogether"] ?? ""),
  editorialPlan: (plan["editorialPlan"] ?? []) as never,
  provenance: (plan["provenance"] ?? {}) as never,
});
for (const item of items) {
  await contentService.saveItem(context, batch.id, {
    ...(item as never),
    generation: (item["generation"] ?? null) as never,
  });
}
await contentService.setBatchState(context, batch.id, "prepared");
console.log(`batch ${batch.id} prepared with ${items.length} posts`);

const first = await submitContentBatchForApproval(batch.id, context);
const second = await submitContentBatchForApproval(batch.id, context);
console.log(`submitted: ${first?.id ?? "none"}`);
console.log(`resubmitted (must be the same id): ${second?.id ?? "none"}`);

const { data: rows } = await serviceClient
  .from("approval_requests")
  .select("id, source_key, status, revision")
  .eq("organization_id", organizationId)
  .eq("source_app", "marketing");
console.log(`marketing approval_requests: ${rows?.length ?? 0}`);
for (const row of rows ?? []) {
  console.log(`  ${row.id} | ${row.source_key} | ${row.status} | rev ${row.revision}`);
}
