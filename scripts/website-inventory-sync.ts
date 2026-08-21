/**
 * One real page inventory sync against the public Trust Tai site.
 *
 * Server side, service role, and deliberately boring: it discovers, reads,
 * upserts and reports. It is safe to run again; nothing is deleted and no
 * measurement row is created.
 *
 *   bun scripts/website-inventory-sync.ts
 */

import { createClient } from "@supabase/supabase-js";

import { syncPageInventory } from "@/lib/website-inventory.server";

const ORG_ID = process.env["TRUST_TAI_ORG_ID"] ?? "ee683a64-e045-4226-a8ff-4ae6590d6789";
const ORIGIN = process.env["TRUST_TAI_SITE_ORIGIN"] ?? "https://trusttai.com";

const url = process.env["TRUST_TAI_SUPABASE_URL"] ?? "https://okydosoacqdnursmmenf.supabase.co";
const key =
  process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
if (!key) throw new Error("Missing Trust Tai Supabase service-role key.");

const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const summary = await syncPageInventory(client as never, {
  organizationId: ORG_ID,
  origin: ORIGIN,
});
console.log(JSON.stringify(summary, null, 2));
