/**
 * Trust Tai OS — Comms ↔ People identity.
 *
 * One person, one memory. A Comms relationship is a conversation; the person
 * having it lives once, in the shared `contacts` table. This module holds the
 * pure rules that keep the two honest with each other:
 *
 *  1. Nothing is invented. A company is only derived from an address when the
 *     domain actually belongs to a company — a free mailbox says nothing about
 *     where someone works, so it stays blank rather than becoming "Gmail".
 *  2. A human edit outranks a derivation. A value a person typed is never
 *     replaced by something a sync guessed.
 *  3. Writes are minimal. Only fields that genuinely changed are patched, so a
 *     read-only visit never rewrites history.
 */

/** Mailbox providers: a personal address, never an employer. */
export const FREE_MAIL_DOMAINS: readonly string[] = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.de",
  "mail.com",
  "yandex.com",
  "zoho.com",
  "comcast.net",
  "att.net",
  "verizon.net",
  "btinternet.com",
];

export function domainOf(email: string | undefined | null): string | undefined {
  const value = (email ?? "").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at < 1 || at === value.length - 1) return undefined;
  return value.slice(at + 1);
}

export function isFreeMailDomain(domain: string | undefined): boolean {
  if (!domain) return false;
  return FREE_MAIL_DOMAINS.includes(domain.toLowerCase());
}

/**
 * A company name that can be honestly read from an address, or nothing.
 * Free mailboxes and bare hostnames yield nothing — silence beats invention.
 */
export function companyFromEmail(email: string | undefined | null): string | undefined {
  const domain = domainOf(email);
  if (!domain || isFreeMailDomain(domain)) return undefined;
  const base = domain.split(".")[0] ?? "";
  if (base.length < 2) return undefined;
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * A stored company that was clearly derived from a free mailbox ("Gmail",
 * "Icloud"). It is noise, not knowledge, and Comms should stop showing it.
 */
export function isMailboxNoise(companyName: string | undefined | null, email?: string | null): boolean {
  const value = (companyName ?? "").trim().toLowerCase();
  if (!value) return false;
  const compact = value.replace(/[\s.]/g, "");
  const noise = FREE_MAIL_DOMAINS.some((domain) => {
    const base = (domain.split(".")[0] ?? "").toLowerCase();
    return compact === base || compact === domain.replace(/\./g, "");
  });
  if (!noise) return false;
  // Only noise when it matches the person's own free mailbox, or matches no
  // real domain at all. A person genuinely at "mail.com" keeps their company.
  const domain = domainOf(email);
  return !domain || isFreeMailDomain(domain);
}

export interface PersonIdentity {
  fullName: string;
  roleTitle?: string | undefined;
  companyName?: string | undefined;
}

function clean(value: string | undefined | null): string | undefined {
  const trimmed = (value ?? "").trim().replace(/\s+/g, " ");
  return trimmed ? trimmed : undefined;
}

export function normalizeIdentity(input: {
  fullName?: string | undefined;
  roleTitle?: string | undefined;
  companyName?: string | undefined;
}): PersonIdentity {
  return {
    fullName: clean(input.fullName) ?? "",
    ...(clean(input.roleTitle) ? { roleTitle: clean(input.roleTitle) } : {}),
    ...(clean(input.companyName) ? { companyName: clean(input.companyName) } : {}),
  };
}

export interface IdentitySides {
  relationship: { fullName?: string | undefined; companyName?: string | undefined; email?: string | undefined };
  contact?: { fullName?: string | undefined; roleTitle?: string | undefined; companyName?: string | undefined } | undefined;
}

/**
 * The one identity both sides should agree on. The relationship carries the
 * name the conversation uses; the contact carries the professional detail.
 * A mailbox-derived company is dropped in favour of a real one, or nothing.
 */
export function resolveIdentity(sides: IdentitySides): PersonIdentity {
  const email = sides.relationship.email;
  const relCompany = clean(sides.relationship.companyName);
  const contactCompany = clean(sides.contact?.companyName);
  const stated = [relCompany, contactCompany].find(
    (value) => value && !isMailboxNoise(value, email),
  );
  const company = stated ?? companyFromEmail(email);

  return normalizeIdentity({
    fullName: clean(sides.relationship.fullName) ?? clean(sides.contact?.fullName) ?? "",
    roleTitle: clean(sides.contact?.roleTitle),
    ...(company ? { companyName: company } : {}),
  });
}

export interface IdentityPatches {
  relationship: { fullName?: string; companyName?: string | null };
  contact: { fullName?: string; roleTitle?: string; companyName?: string };
  changed: boolean;
}

/**
 * The smallest set of writes that makes both sides say the same thing.
 * `companyName: null` clears mailbox noise rather than leaving a lie on record.
 */
export function identityPatches(sides: IdentitySides, next: PersonIdentity): IdentityPatches {
  const target = normalizeIdentity(next);
  const patches: IdentityPatches = { relationship: {}, contact: {}, changed: false };
  if (!target.fullName) return patches;

  const relName = clean(sides.relationship.fullName);
  const relCompany = clean(sides.relationship.companyName);
  if (relName !== target.fullName) patches.relationship.fullName = target.fullName;
  if ((target.companyName ?? undefined) !== relCompany) {
    patches.relationship.companyName = target.companyName ?? null;
  }

  const contactName = clean(sides.contact?.fullName);
  const contactTitle = clean(sides.contact?.roleTitle);
  const contactCompany = clean(sides.contact?.companyName);
  if (contactName !== target.fullName) patches.contact.fullName = target.fullName;
  if (target.roleTitle && target.roleTitle !== contactTitle) patches.contact.roleTitle = target.roleTitle;
  if (target.companyName && target.companyName !== contactCompany) {
    patches.contact.companyName = target.companyName;
  }

  patches.changed =
    Object.keys(patches.relationship).length > 0 || Object.keys(patches.contact).length > 0;
  return patches;
}
