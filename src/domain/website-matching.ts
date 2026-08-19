/**
 * Which Scout prospect an inbound Website intake belongs to.
 *
 * Evidence-backed or nothing. A domain is evidence. A company name typed by a
 * founder is not, on its own, enough to merge two companies, so an ambiguous
 * intake is preserved as an unlinked Scout signal for a person to review
 * rather than guessed at.
 */

export interface MatchCandidate {
  id: string;
  name: string;
  /** Full stored website url, exactly as Scout holds it. */
  websiteUrl: string;
}

export interface MatchSubject {
  companyName?: string | null;
  companyWebsite?: string | null;
  personEmail?: string | null;
}

export type MatchOutcome =
  | { kind: "matched"; prospectId: string; because: string }
  | { kind: "create"; name: string; websiteUrl: string; because: string }
  | { kind: "ambiguous"; because: string };

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
]);

/** Bare, comparable host. Empty string when there is nothing usable. */
export function canonicalDomain(value: string | null | undefined): string {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`;
  let host = "";
  try {
    host = new URL(withScheme).hostname;
  } catch {
    return "";
  }
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  return host.includes(".") ? host : "";
}

/** The company domain implied by a work email. Free mailboxes prove nothing. */
export function domainFromEmail(email: string | null | undefined): string {
  const at = (email ?? "").trim().toLowerCase().split("@");
  if (at.length !== 2 || !at[1]) return "";
  const domain = canonicalDomain(at[1]);
  return FREE_EMAIL_DOMAINS.has(domain) ? "" : domain;
}

/** The domain this submission is really about, from strongest evidence first. */
export function subjectDomain(subject: MatchSubject): string {
  return canonicalDomain(subject.companyWebsite) || domainFromEmail(subject.personEmail);
}

/**
 * Resolve an inbound intake against the organization's existing prospects.
 * Fails to "ambiguous" whenever the evidence would require a guess.
 */
export function matchProspect(subject: MatchSubject, candidates: MatchCandidate[]): MatchOutcome {
  const domain = subjectDomain(subject);
  const name = (subject.companyName ?? "").trim();

  if (domain) {
    const hits = candidates.filter((c) => canonicalDomain(c.websiteUrl) === domain);
    if (hits.length === 1) {
      return {
        kind: "matched",
        prospectId: hits[0]!.id,
        because: `Matched on the company domain ${domain}.`,
      };
    }
    if (hits.length > 1) {
      return {
        kind: "ambiguous",
        because: `More than one Scout record already uses ${domain}, so this submission is held for review.`,
      };
    }
    return {
      kind: "create",
      name: name || domain,
      websiteUrl: `https://${domain}`,
      because: `No Scout record used ${domain}, so a new inbound prospect was created from the submission.`,
    };
  }

  if (!name) {
    return {
      kind: "ambiguous",
      because: "The submission carried neither a company website nor a company name.",
    };
  }
  return {
    kind: "ambiguous",
    because: `Only a typed company name ("${name}") was supplied, which is not enough evidence to link or create a company record.`,
  };
}
