/**
 * Approved source, compliant enrichment, behind the backend.
 *
 * Trust Tai never calls an enrichment vendor from the browser: no provider key
 * may reach the client bundle. This provider speaks only to authenticated
 * Supabase Edge Functions (`people-discovery`, `email-verify`), which hold the
 * credentials and enforce the vendor's terms.
 *
 * Until those functions are deployed, `available()` is false and Scout says so
 * plainly rather than pretending an enrichment run happened.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import {
  guessSeniority,
  type EmailStatus,
  type EmailVerification,
  type PeopleProvider,
  type PersonDraft,
} from "@/domain/people";

const DISCOVERY_FUNCTION = "people-discovery";
const VERIFY_FUNCTION = "email-verify";

const EMAIL_STATUSES: EmailStatus[] = [
  "unknown",
  "found",
  "verified",
  "risky",
  "invalid",
  "bounced",
];

function toEmailStatus(value: unknown, fallback: EmailStatus): EmailStatus {
  return typeof value === "string" && (EMAIL_STATUSES as string[]).includes(value)
    ? (value as EmailStatus)
    : fallback;
}

function toDraft(entry: unknown): PersonDraft | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const fullName =
    typeof record["full_name"] === "string"
      ? record["full_name"]
      : typeof record["name"] === "string"
        ? record["name"]
        : "";
  if (!fullName.trim()) return null;

  const roleTitle =
    typeof record["role_title"] === "string"
      ? record["role_title"]
      : typeof record["title"] === "string"
        ? record["title"]
        : undefined;
  const email = typeof record["email"] === "string" ? record["email"] : undefined;

  return {
    fullName: fullName.trim(),
    ...(roleTitle ? { roleTitle } : {}),
    seniority: guessSeniority(roleTitle),
    ...(email ? { email, emailStatus: toEmailStatus(record["email_status"], "found") } : {}),
    ...(typeof record["linkedin_url"] === "string"
      ? { linkedinUrl: record["linkedin_url"] }
      : {}),
    ...(typeof record["source_url"] === "string" ? { sourceUrl: record["source_url"] } : {}),
    confidence: "asserted_by_provider",
  };
}

/** A missing Edge Function must read as "not wired yet", never as an outage. */
async function functionExists(name: string): Promise<boolean> {
  try {
    const { error } = await supabase.functions.invoke(name, { body: { probe: true } });
    if (!error) return true;
    return !/not found|404|failed to send|does not exist/i.test(error.message ?? "");
  } catch {
    return false;
  }
}

export const enrichmentProvider: PeopleProvider = {
  id: "compliant-enrichment",
  label: "Compliant enrichment",
  description:
    "An approved enrichment vendor, called only from the Trust Tai backend. No provider key ever reaches the browser.",
  kind: "enrichment",
  approved: true,
  baseConfidence: "asserted_by_provider",

  async available() {
    return functionExists(DISCOVERY_FUNCTION);
  },

  async discover(input) {
    const { data, error } = await supabase.functions.invoke(DISCOVERY_FUNCTION, {
      body: {
        organization_id: input.organizationId,
        prospect_id: input.prospectId,
        company_name: input.companyName,
        website_url: input.websiteUrl ?? null,
        domain: input.domain ?? null,
      },
    });
    if (error) throw new Error(error.message);
    const people = (data as { people?: unknown[] } | null)?.people ?? [];
    return people.map(toDraft).filter((draft): draft is PersonDraft => draft !== null);
  },

  async verifyEmail(email) {
    const { data, error } = await supabase.functions.invoke(VERIFY_FUNCTION, {
      body: { email },
    });
    if (error) throw new Error(error.message);
    const record = (data ?? {}) as Record<string, unknown>;
    const result: EmailVerification = {
      email,
      status: toEmailStatus(record["status"], "unknown"),
      ...(typeof record["note"] === "string" ? { note: record["note"] } : {}),
    };
    return result;
  },
};
