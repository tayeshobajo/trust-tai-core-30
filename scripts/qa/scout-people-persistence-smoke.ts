/**
 * Durable Scout people, proved against the real database without spending a
 * provider credit and without leaving anything behind.
 *
 * A clearly marked probe company is created in a real workspace, one synthetic
 * person is saved through the same server store the app uses, the answer is
 * recorded the way a lookup records it, the row is read back the way a reload
 * reads it, and then the probe company is deleted. The person row goes with it
 * through the table's own cascade, which is the only honest way to clean up:
 * no application role may delete researched provenance directly.
 *
 * No Apollo or Clay call is made here. The provider answer is invented locally
 * and marked `manual`, so nothing claims a provider said something it did not.
 */

import { createClient } from "@supabase/supabase-js";

import { scoutPeopleStore } from "@/lib/scout-people-store.server";

const PROBE = "QA probe, Scout people persistence (safe to delete)";

function must(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is not set in this runtime.`);
  return value;
}

async function main(): Promise<void> {
  const db = createClient(
    must(process.env["TRUST_TAI_SUPABASE_URL"], "TRUST_TAI_SUPABASE_URL"),
    must(process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"], "TRUST_TAI_SUPABASE_SERVICE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: member, error: memberError } = await db
    .from("organization_memberships")
    .select("organization_id,user_id")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (memberError || !member) throw new Error(`No active member to act as: ${memberError?.message}`);

  const organizationId = member["organization_id"] as string;
  const createdBy = member["user_id"] as string;

  const { data: prospect, error: prospectError } = await db
    .from("prospects")
    .insert({ organization_id: organizationId, company_name: PROBE, status: "discovered" })
    .select("id")
    .single();
  if (prospectError || !prospect) throw new Error(`Probe company failed: ${prospectError?.message}`);
  const prospectId = prospect["id"] as string;

  let failure: unknown = null;
  try {
    const store = scoutPeopleStore({ db });

    const [saved] = await store.saveResearch({
      organizationId,
      prospectId,
      createdBy,
      people: [
        {
          fullName: "Probe Person",
          title: "Operations Lead",
          companyName: PROBE,
          companyDomain: "probe.invalid",
          buyingRole: "owner",
          whyThisPerson: "Synthetic row proving durable storage.",
          provider: "manual",
          providerPersonId: `probe-${Date.now()}`,
          discoveredAt: new Date().toISOString(),
        },
      ],
    });
    if (!saved) throw new Error("Nothing came back from the save.");
    console.log("saved:", saved.id, saved.title, saved.providerPersonId, saved.emailStatus);

    const recorded = await store.recordEmail({
      organizationId,
      prospectId,
      personId: saved.id,
      answer: {
        email: "probe.person@probe.invalid",
        verified: true,
        provider: "manual",
        at: new Date().toISOString(),
      },
    });
    console.log("recorded:", recorded.emailStatus, recorded.workEmail, recorded.emailVerifiedAt);

    // The reload path: exactly what the page reads when it opens again.
    const reloaded = await store.list({ organizationId, prospectId });
    const person = reloaded[0];
    console.log(
      "reloaded:",
      reloaded.length,
      person?.title,
      person?.providerPersonId,
      person?.emailStatus,
      person?.workEmail,
      person?.provider,
      person?.emailFetchedAt,
    );

    // Saving the same research again must not make a second person.
    await store.saveResearch({
      organizationId,
      prospectId,
      createdBy,
      people: [
        {
          fullName: "Probe Person",
          title: "Operations Lead",
          companyName: PROBE,
          buyingRole: "owner",
          whyThisPerson: "Second save of the same person.",
          provider: "manual",
          providerPersonId: saved.providerPersonId ?? "",
          discoveredAt: new Date().toISOString(),
        },
      ],
    });
    const afterRepeat = await store.list({ organizationId, prospectId });
    console.log(
      "after repeat save:",
      afterRepeat.length,
      "address kept:",
      afterRepeat[0]?.workEmail,
      afterRepeat[0]?.emailStatus,
    );
  } catch (error) {
    failure = error;
  } finally {
    const { error: cleanupError } = await db.from("prospects").delete().eq("id", prospectId);
    const { count } = await db
      .from("scout_people")
      .select("id", { count: "exact", head: true })
      .eq("prospect_id", prospectId);
    console.log("cleanup:", cleanupError?.message ?? "probe company removed", "rows left:", count);
  }

  if (failure) throw failure;
}

await main();
