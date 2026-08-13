/**
 * Client identity for a composed roadmap.
 *
 * A client document may carry the client's own logo and colour, but only when
 * those were read from the company's own public website and already validated.
 * Nothing here guesses: no favicon service, no colour derived from a name or a
 * domain, no palette invented to make a page look finished. When there is no
 * validated identity the document falls back to Roadmap's own accent, which is
 * honest about whose frame it is.
 */

import type { CompanyIdentity } from "@/lib/company-identity";
import { isTextSafeOnPaper, normalizeThemeColor } from "@/lib/company-identity";

export interface RoadmapBrand {
  accent?: string;
  logoUrl?: string;
}

/**
 * Keep only what is real. Returns null when the subject has no validated
 * identity, so callers pass nothing rather than passing a placeholder.
 */
export function validatedBrand(identity: CompanyIdentity | null | undefined): RoadmapBrand | null {
  if (!identity) return null;

  const accent = normalizeThemeColor(identity.themeColor);
  const logoUrl =
    typeof identity.logoUrl === "string" && /^https:\/\//i.test(identity.logoUrl.trim())
      ? identity.logoUrl.trim()
      : null;

  const brand: RoadmapBrand = {
    // A colour that cannot be read on paper is decoration, not identity.
    ...(accent && isTextSafeOnPaper(accent) ? { accent } : {}),
    ...(logoUrl ? { logoUrl } : {}),
  };

  return brand.accent || brand.logoUrl ? brand : null;
}
