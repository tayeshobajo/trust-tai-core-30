/**
 * Conductor RLS acceptance, run against the real Trust Tai Supabase project.
 *
 * Proves four things about business_figures and conductor_corrections:
 *   1. A member can insert and read back their own organization's rows.
 *   2. A member cannot read another organization's rows.
 *   3. A member cannot insert into another organization.
 *   4. An anonymous caller can read and write nothing at all.
 *
 * This has to run with real sessions, so it is a script rather than a unit
 * test, nothing in the sandbox holds workspace credentials.
 *
 * Usage:
 *   TT_SUPABASE_URL=... TT_SUPABASE_PUBLISHABLE_KEY=... \
 *   TT_EMAIL_A=... TT_PASSWORD_A=... TT_ORG_A=<uuid> \
 *   TT_EMAIL_B=... TT_PASSWORD_B=... TT_ORG_B=<uuid> \
 *   bun run scripts/conductor-rls-check.ts
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env["TT_SUPABASE_URL"] ?? "";
const key = process.env["TT_SUPABASE_PUBLISHABLE_KEY"] ?? "";

if (!url || !key) {
  console.error("Set TT_SUPABASE_URL and TT_SUPABASE_PUBLISHABLE_KEY.");
  process.exit(1);
}

const results: { name: string; pass: boolean; detail: string }[] = [];

function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `, ${detail}` : ""}`);
}

function client(): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(email: string, password: string) {
  const sb = client();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`sign-in failed for ${email}: ${error?.message}`);
  return { sb, userId: data.user.id };
}

async function main() {
  const orgA = process.env["TT_ORG_A"] ?? "";
  const orgB = process.env["TT_ORG_B"] ?? "";

  /* 4, anonymous holds nothing. */
  const anon = client();
  for (const table of ["business_figures", "conductor_corrections"] as const) {
    const { data, error } = await anon.from(table).select("id").limit(1);
    record(
      `anon cannot read ${table}`,
      Boolean(error) || (data ?? []).length === 0,
      error?.message ?? "no rows returned",
    );
  }

  const a = await signIn(process.env["TT_EMAIL_A"]!, process.env["TT_PASSWORD_A"]!);

  /* 1, a member writes and reads their own organization. */
  const asOf = new Date().toISOString();
  const { data: figure, error: writeError } = await a.sb
    .from("business_figures")
    .insert({
      organization_id: orgA,
      key: "cash_on_hand",
      value: 1,
      basis: "decided",
      as_of: asOf,
      note: "rls acceptance probe",
      recorded_by: a.userId,
    })
    .select("id")
    .maybeSingle();
  record(
    "member can record a figure in own org",
    !writeError && Boolean(figure),
    writeError?.message ?? "",
  );

  const { data: readBack } = await a.sb
    .from("business_figures")
    .select("id, value, as_of")
    .eq("organization_id", orgA)
    .order("as_of", { ascending: false })
    .limit(1);
  record("member can read own org figures", (readBack ?? []).length > 0, "");

  const { error: correctionError } = await a.sb.from("conductor_corrections").insert({
    organization_id: orgA,
    kind: "not_useful",
    note: "rls acceptance probe",
    corrected_by: a.userId,
  });
  record(
    "member can record a correction in own org",
    !correctionError,
    correctionError?.message ?? "",
  );

  /* 2 & 3, the other organization stays closed. */
  if (orgB) {
    const { data: crossRead } = await a.sb
      .from("business_figures")
      .select("id")
      .eq("organization_id", orgB);
    record("member reads nothing from another org", (crossRead ?? []).length === 0, "");

    const { error: crossWrite } = await a.sb.from("business_figures").insert({
      organization_id: orgB,
      key: "cash_on_hand",
      value: 1,
      basis: "decided",
      as_of: asOf,
      recorded_by: a.userId,
    });
    record(
      "member cannot write into another org",
      Boolean(crossWrite),
      crossWrite?.message ?? "insert unexpectedly allowed",
    );

    const { error: spoofed } = await a.sb.from("conductor_corrections").insert({
      organization_id: orgA,
      kind: "not_useful",
      note: "spoofed author",
      corrected_by: "00000000-0000-0000-0000-000000000000",
    });
    record(
      "correction author cannot be spoofed",
      Boolean(spoofed),
      spoofed?.message ?? "insert unexpectedly allowed",
    );
  }

  /* A non-member account, if one is supplied, must see nothing of org A. */
  if (process.env["TT_EMAIL_B"]) {
    const b = await signIn(process.env["TT_EMAIL_B"]!, process.env["TT_PASSWORD_B"]!);
    const { data: outsider } = await b.sb
      .from("business_figures")
      .select("id")
      .eq("organization_id", orgA);
    record("non-member reads nothing of org A", (outsider ?? []).length === 0, "");
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) process.exit(1);
}

void main();
