/**
 * Trust Tai OS — Supabase row shapes and write helpers.
 *
 * The schema is owned and managed outside this project. Nothing here creates
 * or alters tables; these are read-only expectations about the existing public
 * tables plus small helpers that keep writes resilient to harmless column
 * differences (an optional column we send that the table does not have is
 * dropped and the write is retried, rather than failing the user's action).
 */

import type { PostgrestError } from "@supabase/supabase-js";

export type Row = Record<string, unknown>;

export interface ProfileRow {
  id: string;
  email?: string | null;
  full_name?: string | null;
  display_name?: string | null;
  name?: string | null;
  avatar_url?: string | null;
}

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
}

export interface MembershipRow {
  id?: string;
  organization_id: string;
  user_id: string;
  role: string;
  status?: string | null;
}

/**
 * Exact shape of `public.prospects`. The schema is known, so nothing here is
 * inferred and no column is optional-by-tolerance: a mismatch must fail loudly.
 */
export interface ProspectRow {
  id: string;
  organization_id: string;
  company_name: string;
  website_url: string | null;
  status: string;
  source: string | null;
  fit_score: number | null;
  observed: Row | unknown[] | null;
  inferred: Row | unknown[] | null;
  suggested: Row | unknown[] | null;
  provenance: Row | null;
  metadata: Row | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** The exact status vocabulary allowed by the database. */
export const PROSPECT_STATUSES = [
  "discovered",
  "reviewing",
  "qualified",
  "passed",
  "ready_for_comms",
  "converted",
  "archived",
] as const;

export interface IcpProfileRow {
  id: string;
  organization_id: string;
  title?: string | null;
  content_markdown: string;
  source_filename?: string | null;
  version: number;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Roles allowed to mutate organization-level intelligence such as the ICP. */
export const ADMIN_ROLES = ["owner", "admin"];

export function isMissingColumn(error: PostgrestError | null): string | null {
  if (!error) return null;
  const message = `${error.message} ${error.details ?? ""}`;
  if (error.code !== "PGRST204" && !/column/i.test(message)) return null;
  const match = message.match(/'([^']+)' column/) ?? message.match(/column "([^"]+)"/);
  return match?.[1] ?? null;
}

/**
 * Run a write, dropping any optional column the table does not have and
 * retrying. `required` keys are never dropped — if one of those is rejected the
 * error surfaces so the mismatch is reported rather than silently swallowed.
 */
export async function writeTolerant<T>(
  payload: Row,
  required: string[],
  run: (payload: Row) => Promise<{ data: T | null; error: PostgrestError | null }>,
): Promise<{ data: T | null; error: PostgrestError | null }> {
  const current = { ...payload };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const result = await run(current);
    const missing = isMissingColumn(result.error);
    if (!missing || required.includes(missing) || !(missing in current)) {
      return result;
    }
    delete current[missing];
  }
  return run(current);
}
