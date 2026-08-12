/**
 * Website address handling shared by Scout's input area and its repository.
 *
 * One rule decides everything: if the typed text resolves to a hostname it is
 * treated as a company website to research live; otherwise it is a
 * plain-English prompt for preview discovery.
 */

/** Canonical `https://hostname` form, or null when the text is not an address. */
export function normalizeWebsiteUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  const tld = host.split(".").pop() ?? "";
  if (tld.length < 2 || /^\d+$/.test(tld)) return null;
  return `https://${host}`;
}

/** True when the input should trigger live website research. */
export function looksLikeWebsite(input: string): boolean {
  return normalizeWebsiteUrl(input) !== null;
}
