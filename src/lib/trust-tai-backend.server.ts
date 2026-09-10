/**
 * Which backend the server talks to.
 *
 * Trust Tai OS has exactly one backend: the externally managed Supabase
 * project `okydosoacqdnursmmenf`. Environment variables are honoured only when
 * they point at that project, so a leftover Lovable Cloud URL can never shadow
 * the real workspace and silently reject perfectly good sessions.
 */

export const TRUST_TAI_PROJECT_REF = "okydosoacqdnursmmenf";

const FALLBACK_URL = `https://${TRUST_TAI_PROJECT_REF}.supabase.co`;
const FALLBACK_PUBLISHABLE_KEY = "sb_publishable_uARvNwZli88tfhOHBwFTsQ_JUpQo-UL";

function envUrl(): string | undefined {
  const candidate = process.env["TRUST_TAI_SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"] || "";
  return candidate.includes(TRUST_TAI_PROJECT_REF) ? candidate : undefined;
}

/** The Trust Tai Supabase URL. Never another project's. */
export function trustTaiSupabaseUrl(): string {
  return envUrl() ?? FALLBACK_URL;
}

/** The publishable key that belongs to the resolved URL. */
export function trustTaiSupabaseKey(): string {
  if (!envUrl()) return FALLBACK_PUBLISHABLE_KEY;
  return (
    process.env["TRUST_TAI_SUPABASE_PUBLISHABLE_KEY"] ||
    process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
    FALLBACK_PUBLISHABLE_KEY
  );
}
