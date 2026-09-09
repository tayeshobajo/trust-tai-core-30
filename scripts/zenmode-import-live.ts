/**
 * ZenMode → Scout import harness — DEVELOPMENT/QA ONLY.
 *
 * Runs the exact `importZenModeLeadsAsProspects` path the app would run, against
 * the live database, so the import can be proven against real campaign leads
 * before it is wired to any UI or schedule. Not part of the app bundle and not
 * routable.
 *
 * DRY RUN IS THE DEFAULT. Without `--commit` it lists what ZenMode returned and
 * what would be written, and touches nothing. `--commit` performs the inserts.
 *
 *   bun scripts/zenmode-import-live.ts <organization_id> [--commit]
 *
 * Env is read from .env/.env.local (TRUST_TAI_SUPABASE_URL +
 * TRUST_TAI_SUPABASE_SERVICE_KEY) and CREDENTIALS-provided ZENMODE_API_KEY.
 * Secrets are never printed.
 */

import { createClient } from "@supabase/supabase-js";

import {
  importZenModeLeadsAsProspects,
  resolveCompanyName,
} from "../src/lib/zenmode-scout-import.server";
import { zenModeListLeads } from "../src/lib/zenmode-provider.server";

const organizationId = process.argv[2];
const commit = process.argv.includes("--commit");

if (!organizationId) {
  console.error("usage: bun scripts/zenmode-import-live.ts <organization_id> [--commit]");
  process.exit(1);
}

const supabaseUrl = process.env["TRUST_TAI_SUPABASE_URL"] ?? process.env["SUPABASE_URL"];
const serviceKey = process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"];
const zenModeKey = process.env["ZENMODE_API_KEY"];

if (!supabaseUrl || !serviceKey) {
  console.error("FAIL: TRUST_TAI_SUPABASE_URL / TRUST_TAI_SUPABASE_SERVICE_KEY not set.");
  process.exit(1);
}
if (!zenModeKey) {
  console.error("FAIL: ZENMODE_API_KEY not set.");
  process.exit(1);
}

// The provider and import are both feature-gated off by default; this harness
// opts itself in explicitly rather than depending on ambient prod flags.
const env = {
  ...process.env,
  ZENMODE_READ_ENABLED: "true",
  ZENMODE_API_KEY: zenModeKey,
  ZENMODE_SCOUT_IMPORT_ENABLED: "true",
};

const leads = await zenModeListLeads({ limit: 200 }, env);
console.log(`ZenMode returned ${leads.length} lead(s).`);
let repaired = 0;
for (const lead of leads) {
  const resolved = resolveCompanyName(lead);
  const zenModeGuess = lead.companyName ?? lead.name ?? "ZenMode lead";
  if (resolved !== zenModeGuess) repaired += 1;
}

for (const lead of leads.slice(0, 25)) {
  const resolved = resolveCompanyName(lead);
  const zenModeGuess = lead.companyName ?? lead.name ?? "ZenMode lead";
  console.log(
    [
      `  lead ${lead.leadId}`,
      lead.name ?? "(no name)",
      `${JSON.stringify(zenModeGuess)} -> ${JSON.stringify(resolved)}`,
      lead.location ?? "(no location)",
      lead.linkedinUrl ?? "NO LINKEDIN URL — would be skipped",
    ].join(" | "),
  );
}
console.log(`\nDisplay name repaired for ${repaired} of ${leads.length} lead(s).`);

if (!commit) {
  const withRoute = leads.filter((lead) => lead.linkedinUrl).length;
  console.log(
    `\nDRY RUN. ${withRoute} lead(s) have a LinkedIn route and are import candidates; ` +
      `${leads.length - withRoute} would be skipped. Re-run with --commit to write.`,
  );
  process.exit(0);
}

const client = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

const result = await importZenModeLeadsAsProspects(client, { organizationId }, env);
console.log("\n" + JSON.stringify(result, null, 2));
