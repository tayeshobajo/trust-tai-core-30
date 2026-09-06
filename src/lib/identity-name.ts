/**
 * The signed-in person's display name, resolved truthfully.
 *
 * Order: explicit name fields from the canonical profile row win. When no
 * name is stored anywhere, the truthful fallback is the verified account
 * email itself. We never guess a person's name from the email local-part.
 */

export interface ProfileNameFields {
  full_name?: string | null;
  display_name?: string | null;
  name?: string | null;
}

export function displayName(profile: ProfileNameFields | null, email: string): string {
  const candidate = profile?.full_name ?? profile?.display_name ?? profile?.name;
  if (candidate && String(candidate).trim().length > 0) return String(candidate).trim();
  return email;
}
