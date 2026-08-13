/**
 * Company identity helpers.
 *
 * Trust Tai stays the frame; the company is the subject inside it. Identity is
 * only ever derived from the company's own website: same-site icon paths and,
 * when research has already recorded one, a real `theme-color`/logo value.
 * Nothing is scraped from third-party logo or favicon services, and no colour
 * is ever invented from a hostname.
 */

export interface CompanyIdentity {
  /** Optional real brand colour, already validated. Decorative use only. */
  themeColor?: string;
  /** Optional logo URL recorded by research. Must be same-site or absolute https. */
  logoUrl?: string;
}

/** Bare hostname (no scheme, no `www.`), or null when the URL is unusable. */
export function hostnameOf(websiteUrl: string): string | null {
  const raw = (websiteUrl ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Conservative same-site image candidates, in load order. Each is a real path
 * served by the company itself; the browser simply fails over to the next one.
 */
export function companyIconSources(websiteUrl: string, logoUrl?: string): string[] {
  const host = hostnameOf(websiteUrl);
  const sources: string[] = [];
  if (logoUrl && /^https:\/\//i.test(logoUrl)) sources.push(logoUrl);
  if (host) {
    const origin = `https://${host}`;
    sources.push(
      `${origin}/apple-touch-icon.png`,
      `${origin}/favicon.png`,
      `${origin}/favicon.svg`,
      `${origin}/favicon.ico`,
    );
  }
  return sources;
}

/** One or two initials from the company name. Never empty when a name exists. */
export function companyInitials(name: string): string {
  const words = (name ?? "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/[\s-]+/)
    .filter(Boolean);
  if (words.length === 0) return "•";
  if (words.length === 1) return (words[0] ?? "").slice(0, 2).toUpperCase();
  return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/i;

/** Validated `#rrggbb` string, or null when the value is not a real colour. */
export function normalizeThemeColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase();
  if (!raw) return null;

  if (HEX.test(raw)) {
    if (raw.length === 4) {
      const [, r, g, b] = raw;
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    return raw;
  }

  const rgb = RGB.exec(raw);
  if (rgb) {
    const parts = [rgb[1], rgb[2], rgb[3]].map((n) => Number(n));
    if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
    return `#${parts.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  }

  return null;
}

function channel(hex: string, index: number): number {
  const value = Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance for a validated `#rrggbb` colour. */
export function relativeLuminance(hex: string): number {
  return 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
}

/**
 * True when the colour is legible enough (AA, 4.5:1 against paper) to carry
 * text. Colours that fail stay decorative: rules, dots, washes.
 */
export function isTextSafeOnPaper(hex: string): boolean {
  const paper = 1.0;
  const l = relativeLuminance(hex);
  return (paper + 0.05) / (l + 0.05) >= 4.5;
}

function firstColor(source: unknown): string | null {
  if (!source || typeof source !== "object") return null;
  const row = source as Record<string, unknown>;
  for (const key of ["theme_color", "brand_color", "meta_theme_color", "themeColor"]) {
    const color = normalizeThemeColor(row[key]);
    if (color) return color;
  }
  return null;
}

function firstLogo(source: unknown): string | null {
  if (!source || typeof source !== "object") return null;
  const row = source as Record<string, unknown>;
  for (const key of ["logo_url", "logoUrl", "logo", "icon_url"]) {
    const value = row[key];
    if (typeof value === "string" && /^https:\/\//i.test(value.trim())) return value.trim();
  }
  return null;
}

/**
 * Read an identity from whatever research already persisted. Accepts the
 * prospect's metadata, provenance, inferred block and observed entries, so a
 * future research version can supply `theme_color` or a logo URL without any
 * further UI change.
 */
export function readCompanyIdentity(sources: {
  metadata?: unknown;
  provenance?: unknown;
  inferred?: unknown;
  observed?: unknown[];
}): CompanyIdentity {
  const blocks: unknown[] = [
    sources.metadata,
    (sources.metadata as Record<string, unknown> | undefined)?.["identity"],
    sources.provenance,
    sources.inferred,
  ];

  for (const item of sources.observed ?? []) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    blocks.push(entry);
    const key = typeof entry["key"] === "string" ? entry["key"] : "";
    if (["theme_color", "brand_color", "meta_theme_color"].includes(key)) {
      blocks.push({ theme_color: entry["value"] });
    }
    if (["logo_url", "logo"].includes(key)) {
      blocks.push({ logo_url: entry["value"] });
    }
  }

  const identity: CompanyIdentity = {};
  for (const block of blocks) {
    if (!identity.themeColor) {
      const color = firstColor(block);
      if (color) identity.themeColor = color;
    }
    if (!identity.logoUrl) {
      const logo = firstLogo(block);
      if (logo) identity.logoUrl = logo;
    }
  }
  return identity;
}
