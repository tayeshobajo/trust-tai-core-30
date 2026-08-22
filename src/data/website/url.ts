/**
 * One join key for the whole Website room.
 *
 * GA4 reports a path, Search Console reports a full URL, our own events report
 * whatever the browser had in the address bar. They only join safely if they
 * are normalized the same way, so every source passes through here first.
 */

/**
 * Normalized path form: leading slash, no host, no query, no fragment, no
 * trailing slash (except the root), lower case. Returns "/" for empty input.
 */
export function normalizePath(input: string | null | undefined): string {
  const raw = (input ?? "").trim();
  if (!raw) return "/";

  let pathname = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      pathname = new URL(raw).pathname;
    } catch {
      pathname = raw;
    }
  } else if (raw.startsWith("//")) {
    try {
      pathname = new URL(`https:${raw}`).pathname;
    } catch {
      pathname = raw;
    }
  }

  pathname = (pathname.split("#")[0] ?? "").split("?")[0] ?? "";
  try {
    pathname = decodeURI(pathname);
  } catch {
    /* leave it as given rather than dropping the row */
  }
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  pathname = pathname.replace(/\/{2,}/g, "/");
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");
  return pathname.toLowerCase() || "/";
}

/** True when two addresses point at the same public page. */
export function samePage(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizePath(a) === normalizePath(b);
}

/**
 * Addresses that are not part of the public story: error pages, back office,
 * sign in and anything private. They never count as something that is working.
 */
const OPERATIONAL_PATTERNS: RegExp[] = [
  /^\/404\b/,
  /^\/500\b/,
  /^\/not-found\b/,
  /^\/page-not-found\b/,
  /^\/error\b/,
  /^\/admin\b/,
  /^\/wp-admin\b/,
  /^\/wp-login\b/,
  /^\/login\b/,
  /^\/signin\b/,
  /^\/sign-in\b/,
  /^\/logout\b/,
  /^\/auth\b/,
  /^\/portal\b/,
  /^\/private\b/,
  /^\/preview\b/,
  /^\/_/,
];

export function isOperationalPath(input: string | null | undefined): boolean {
  const path = normalizePath(input);
  return OPERATIONAL_PATTERNS.some((pattern) => pattern.test(path));
}

/** Bare host of a referrer, or an empty string when there is not one. */
export function referrerHost(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return "";
  }
}
