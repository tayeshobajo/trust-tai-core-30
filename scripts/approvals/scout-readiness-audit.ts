/**
 * Why the strong Scout matches are not ready. OPERATIONS ONLY, read only.
 *
 * Reads the live Scout approvals that landed in Needs context and prints, per
 * company, exactly what Scout says is missing, plus what the organization
 * actually stores about the people at that company. It invents nothing: if the
 * evidence is not there, the report says so.
 *
 * Run: bun scripts/approvals/scout-readiness-audit.ts <orgId>
 */

import { createClient } from "@supabase/supabase-js";
import { mock } from "bun:test";

const url = process.env["TRUST_TAI_SUPABASE_URL"]!;
const key = process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"]!;
const organizationId = process.argv[2]!;

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

const { data } = await serviceClient
  .from("approval_requests")
  .select("source_key, status, title, payload, gaps, source_entity")
  .eq("organization_id", organizationId)
  .eq("approval_type", "scout_relationship")
  .order("created_at", { ascending: true });

const rows = data ?? [];
console.log(`scout approvals: ${rows.length}`);

const blockerCount = new Map<string, number>();
for (const row of rows) {
  const gaps = (row.gaps as string[] | null) ?? [];
  for (const gap of gaps) blockerCount.set(gap, (blockerCount.get(gap) ?? 0) + 1);
}
console.log("=== blockers ===");
for (const [gap, count] of [...blockerCount].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count}x ${gap}`);
}

/* What identity evidence actually exists for those companies. */
const prospectIds = rows
  .map((row) => String((row.payload as Record<string, unknown>)?.["prospectId"] ?? ""))
  .filter(Boolean);

const { data: contacts } = await serviceClient
  .from("contacts")
  .select("id, prospect_id, full_name, role_title, email, metadata")
  .eq("organization_id", organizationId)
  .in("prospect_id", prospectIds);

const byProspect = new Map<string, typeof contacts>();
for (const person of contacts ?? []) {
  const bucket = byProspect.get(String(person.prospect_id)) ?? [];
  bucket.push(person);
  byProspect.set(String(person.prospect_id), bucket as never);
}

console.log("=== per company ===");
for (const row of rows) {
  const prospectId = String((row.payload as Record<string, unknown>)?.["prospectId"] ?? "");
  const people = byProspect.get(prospectId) ?? [];
  const withEmail = people.filter((person) => Boolean(person.email));
  console.log(
    `  ${row.status.padEnd(13)} ${String(row.title).slice(0, 44).padEnd(46)} people ${people.length}` +
      ` (email ${withEmail.length})  gaps: ${((row.gaps as string[] | null) ?? []).join(" | ")}`,
  );
  for (const person of people) {
    console.log(
      `      - ${person.full_name ?? "(no name)"} | ${person.role_title ?? "(no role)"} | ${person.email ?? "(no email)"}`,
    );
  }
}
