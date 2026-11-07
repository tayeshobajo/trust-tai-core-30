/** Source validation/extraction only; no DNS or socket imports. */
import ipaddr from "ipaddr.js";

export const SOURCE_LIMITS = {
  count: 3,
  bytes: 65536,
  totalBytes: 196608,
  textChars: 3000,
  timeoutMs: 12000,
} as const;
export class PublicSourceError extends Error {
  constructor(
    readonly category:
      | "url_not_approved"
      | "non_public_address"
      | "fetch_failed"
      | "redirect_rejected"
      | "response_rejected"
      | "source_too_large"
      | "timeout"
      | "empty_source",
  ) {
    super(category);
  }
}
export type SourceEvidence = {
  url: string;
  title: string;
  text: string;
  sha256: string;
  retrievedAt: string;
  publishedAt: null;
};
export function approvedSourceUrl(input: string, approved: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new PublicSourceError("url_not_approved");
  }
  if (
    !approved.includes(input) ||
    url.href !== input ||
    input.length > 2048 ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !url.hostname.includes(".") ||
    url.hostname.endsWith(".") ||
    url.hostname.startsWith("[") ||
    ipaddr.isValid(url.hostname) ||
    /(^|\.)(localhost|local|internal|test|invalid|onion)$/.test(url.hostname)
  )
    throw new PublicSourceError("url_not_approved");
  return url;
}
export function isPublicSourceAddress(address: string): boolean {
  try {
    return ipaddr.parse(address).range() === "unicast";
  } catch {
    return false;
  }
}
export function normalizedAddress(address: string): string {
  const parsed = ipaddr.parse(address);
  return parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()
    ? (parsed as ipaddr.IPv6).toIPv4Address().toString()
    : parsed.toNormalizedString();
}
