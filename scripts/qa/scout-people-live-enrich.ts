/**
 * One real work-email lookup, through exactly the code the app uses.
 *
 * This is the server half of pressing "Find email" on one person: the same
 * provider adapter, the same durable store, the same derivation of the address
 * state from the provider's own answer. It spends exactly one provider lookup
 * for the one person named on the command line, and nothing else.
 *
 *   bun run scripts/qa/scout-people-live-enrich.ts <prospectId> "<Full Name>"
 *
 * Nothing is sent, nobody is written to, and no schema is changed.
 */

import { createClient } from "@supabase/supabase-js";

import { enrichWorkEmail, enrichmentStatus } from "@/lib/contact-enrichment.server";
import { scoutPeopleStore } from "@/lib/scout-people-store.server";
import { savableResearch } from "@/domain/scout-people-persistence";

function must(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is not set in this runtime.`);
  return value;
}

async function main(): Promise<void> {
  const [prospectId, fullName] = process.argv.slice(2);
  if (!prospectId || !fullName) {
    throw new Error('Usage: scout-people-live-enrich.ts <prospectId> "<Full Name>"');
  }

  const status = enrichmentStatus();
  if (!status.connected) throw new Error("No enrichment provider is configured in this runtime.");

  const db = createClient(
    must(process.env["TRUST_TAI_SUPABASE_URL"], "TRUST_TAI_SUPABASE_URL"),
    must(process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"], "TRUST_TAI_SUPABASE_SERVICE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: prospect, error: prospectError } = await db
    .from("prospects")
    .select("id,company_name,website_url,organization_id")
    .eq("id", prospectId)
    .single();
  if (prospectError || !prospect) throw new Error(`Company not found: ${prospectError?.message}`);

  const organizationId = prospect["organization_id"] as string;
  const companyName = prospect["company_name"] as string;
  const domain = ((prospect["website_url"] as string | null) ?? "")
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");

  const { data: member } = await db
    .from("organization_memberships")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (!member) throw new Error("No active member in this workspace to act as.");
  const createdBy = member["user_id"] as string;

  const contact = await db
    .from("contacts")
    .select("title")
    .eq("organization_id", organizationId)
    .eq("full_name", fullName)
    .limit(1)
    .maybeSingle();
  const knownTitle = (contact.data?.["title"] as string | null) ?? undefined;

  console.log(`Looking up ${fullName} at ${companyName} (${domain || "no domain"})…`);
  const result = await enrichWorkEmail({
    fullName,
    companyName,
    ...(domain ? { domain } : {}),
  });
  console.log("provider answer:", {
    provider: result.provider,
    email: result.email ?? null,
    verified: result.verified === true,
    title: result.title ?? null,
    at: result.at,
    because: result.because ?? null,
  });

  const store = scoutPeopleStore({ db });
  const savable = savableResearch({
    fullName,
    companyName,
    ...(domain ? { companyDomain: domain } : {}),
    ...(result.title ?? knownTitle ? { title: result.title ?? knownTitle } : {}),
    ...(result.providerPersonId ? { providerPersonId: result.providerPersonId } : {}),
    provider: result.provider,
    buyingRole: "unknown",
    whyThisPerson: `Looked up at ${companyName} through Scout.`,
  });
  if (!savable) throw new Error("That person could not be recorded.");

  const [saved] = await store.saveResearch({
    organizationId,
    prospectId,
    createdBy,
    people: [savable],
  });
  if (!saved) throw new Error("That person could not be saved.");

  const person = await store.recordEmail({
    organizationId,
    prospectId,
    personId: saved.id,
    answer: {
      email: result.email ?? null,
      verified: result.verified === true,
      provider: result.provider,
      at: result.at,
    },
  });

  console.log("stored row:", {
    id: person.id,
    fullName: person.fullName,
    title: person.title ?? null,
    workEmail: person.workEmail ?? null,
    emailStatus: person.emailStatus,
    emailVerifiedAt: person.emailVerifiedAt ?? null,
    provider: person.provider,
  });

  const reread = await store.list({ organizationId, prospectId });
  console.log(
    "read back:",
    reread.map((row) => ({ name: row.fullName, email: row.workEmail ?? null, state: row.emailStatus })),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
