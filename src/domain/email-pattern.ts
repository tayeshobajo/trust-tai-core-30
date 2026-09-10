/**
 * Trust Tai OS, email pattern inference.
 *
 * Scout routinely finds a decision-maker's name and title but no address, which
 * dead-ends outreach. Where we already hold verified addresses at the same
 * company domain, those addresses reveal the company's naming convention, and
 * the convention can be applied to the missing person.
 *
 * Three rules hold here, and they are the whole point of the module:
 *  1. What comes out is a GUESS, never a verdict. Callers store it as
 *     `emailStatus: "found"` and a human confirms before anything is sent.
 *     Sending to guessed addresses generates bounces, and bounces quietly
 *     degrade the sending domain's reputation for every other conversation.
 *  2. Every candidate carries a confidence and a rationale a non-technical
 *     person can read and overrule. If we cannot justify a guess, we decline.
 *  3. Disagreement is a finding, not a problem to average away. When known
 *     addresses follow different conventions, we say so rather than pick a
 *     winner, because "this company has no single convention" is true and
 *     useful.
 *
 * Callers must pass only addresses they actually trust (in practice
 * `emailStatus: "verified"`). This module cannot tell a verified address from a
 * guessed one, and inferring a pattern from an earlier guess would launder that
 * guess into apparent corroboration. Filtering is the caller's job.
 *
 * Pure throughout: no network, no clock, no storage.
 */

import type { ConfidenceLevel } from "./confidence";

/**
 * The conventions worth recognising. Ordered most-specific-and-common first:
 * when several patterns explain the same evidence equally well, the earlier one
 * is proposed, because a more specific convention is the safer bet and bare
 * `first@` is the least distinctive thing a company can do.
 */
export const EMAIL_PATTERNS = [
  "first.last",
  "firstlast",
  "flast",
  "f.last",
  "first_last",
  "firstl",
  "last.first",
  "first",
] as const;

export type EmailPatternId = (typeof EMAIL_PATTERNS)[number];

/** Plain-English names, for anything a person reads. */
export const EMAIL_PATTERN_LABEL: Record<EmailPatternId, string> = {
  "first.last": "first.last@",
  firstlast: "firstlast@",
  flast: "flast@",
  "f.last": "f.last@",
  first_last: "first_last@",
  firstl: "firstl@",
  "last.first": "last.first@",
  first: "first@",
};

/**
 * Conventions that collide between colleagues. A second Jose at the company
 * cannot also have `jose@`, so however many examples corroborate the pattern,
 * the guess for any individual stays a coin-flip on whether they were first
 * through the door. Confidence for these is capped at moderate.
 */
const COLLISION_PRONE_PATTERNS: readonly EmailPatternId[] = ["first"];

/**
 * Mailboxes that belong to a function, not a person. These must never be read
 * as evidence of a naming convention: `info@` would "prove" a first-name
 * convention for anyone unlucky enough to be called Info, and more realistically
 * a scraped record like `{ fullName: "Acme Support", email: "support@acme" }`
 * would otherwise corroborate `first@`.
 *
 * Stored without separators and compared the same way, so `no-reply`,
 * `no_reply` and `noreply` are one entry.
 */
const ROLE_MAILBOXES: ReadonlySet<string> = new Set([
  "abuse",
  "accounting",
  "accounts",
  "admin",
  "administrator",
  "appointments",
  "ask",
  "billing",
  "booking",
  "bookings",
  "careers",
  "contact",
  "contactus",
  "donotreply",
  "enquiries",
  "enquiry",
  "feedback",
  "finance",
  "frontdesk",
  "general",
  "hello",
  "help",
  "helpdesk",
  "hi",
  "hr",
  "info",
  "inquiries",
  "inquiry",
  "invoices",
  "jobs",
  "legal",
  "mail",
  "mailbox",
  "marketing",
  "media",
  "newbusiness",
  "newsletter",
  "noreply",
  "office",
  "orders",
  "partnerships",
  "postmaster",
  "pr",
  "press",
  "privacy",
  "reception",
  "recruitment",
  "sales",
  "security",
  "service",
  "services",
  "subscribe",
  "support",
  "team",
  "webmaster",
]);

/**
 * Titles that appear before a name. Dropped, because an honorific is a fact
 * about how to address someone, never part of their mailbox.
 */
const HONORIFICS: ReadonlySet<string> = new Set([
  "capt",
  "col",
  "dame",
  "dr",
  "fr",
  "hon",
  "lt",
  "md",
  "miss",
  "mr",
  "mrs",
  "ms",
  "mx",
  "prof",
  "professor",
  "rev",
  "reverend",
  "sgt",
  "sir",
]);

/**
 * Generational and post-nominal suffixes. Deliberately conservative: tokens
 * that are also real surnames are NOT listed, because mangling a name is worse
 * than leaving a suffix in. "Ma" (Jack Ma), "Do" (a Vietnamese surname), "Ba"
 * and "V" are excluded for exactly that reason.
 */
const NAME_SUFFIXES: ReadonlySet<string> = new Set([
  "cfa",
  "cpa",
  "dds",
  "dphil",
  "dvm",
  "edd",
  "esq",
  "ii",
  "iii",
  "iv",
  "jd",
  "jnr",
  "jr",
  "llm",
  "mba",
  "md",
  "mph",
  "msc",
  "phd",
  "pmp",
  "psyd",
  "snr",
  "sr",
]);

/**
 * Letters that carry meaning no accent-stripping pass can recover, because they
 * are distinct letters rather than a base plus a mark. Unicode decomposition
 * turns `é` into `e`, but leaves `ø` and `ß` alone, so they are spelled out the
 * way the owner of the name would spell them in ASCII.
 */
const ASCII_FOLDING: Record<string, string> = {
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  đ: "d",
  ð: "d",
  þ: "th",
  ł: "l",
  ħ: "h",
  ŧ: "t",
  ı: "i",
};

/** A name broken into the parts an address can be built from. */
export interface ParsedName {
  /** Given name, folded to lowercase ASCII. Empty when nothing usable remained. */
  first: string;
  /** Family name, folded to lowercase ASCII. Empty for a single-word name. */
  last: string;
  /**
   * Everything between first and last, in order. Kept so a caller can show the
   * full name, never used to build an address: companies key mailboxes on
   * first and last, and a middle name in the local part is the rarer case.
   */
  middle: string[];
  /** Honorifics and suffixes removed, as originally written, so a human can audit. */
  dropped: string[];
}

/** One address we already trust, paired with whose it is. */
export interface KnownAddress {
  fullName: string;
  email: string;
}

/** A known address that does fit the company's naming, and how. */
export interface PatternSupport {
  email: string;
  fullName: string;
  /** Every pattern that reproduces this exact address. Usually one. */
  patterns: EmailPatternId[];
}

export type PatternExclusionReason =
  "malformed" | "other_domain" | "role_mailbox" | "unnamed" | "unexplained";

/** A known address that taught us nothing, and the reason in plain English. */
export interface ExcludedAddress {
  email: string;
  reason: PatternExclusionReason;
  because: string;
}

/**
 * What the known addresses at one domain amount to. Three honest outcomes:
 * we found one convention, we found more than one and refuse to choose, or we
 * found nothing usable.
 */
export type PatternInference =
  | {
      kind: "inferred";
      domain: string;
      pattern: EmailPatternId;
      /**
       * Patterns that explain every known address just as well. Non-empty means
       * the evidence is consistent but not decisive, and confidence is capped.
       */
      alsoConsistentWith: EmailPatternId[];
      supporting: PatternSupport[];
      excluded: ExcludedAddress[];
      confidence: ConfidenceLevel;
      because: string;
    }
  | {
      kind: "conflicting";
      domain: string;
      /** Every convention observed, so a human can see the split rather than a winner. */
      patternsSeen: EmailPatternId[];
      supporting: PatternSupport[];
      excluded: ExcludedAddress[];
      because: string;
    }
  | {
      kind: "no_pattern";
      domain: string;
      excluded: ExcludedAddress[];
      because: string;
    };

/** A proposed address. Always a guess; never reachable on its own. */
export interface EmailCandidate {
  email: string;
  pattern: EmailPatternId;
  confidence: ConfidenceLevel;
  /** One sentence naming the support count, for a non-technical reader to judge. */
  rationale: string;
  /** How many known addresses back the convention this was built from. */
  supportingCount: number;
}

export type EmailProposal =
  { kind: "candidate"; candidate: EmailCandidate } | { kind: "declined"; because: string };

function normalizeToken(token: string): string {
  return token.replace(/[.,]/g, "").toLowerCase();
}

/** Fold to lowercase a-z, dropping accents, apostrophes, hyphens and spacing noise. */
function toAsciiToken(token: string): string {
  const decomposed = token.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let folded = "";
  for (const character of decomposed) {
    const lower = character.toLowerCase();
    folded += ASCII_FOLDING[lower] ?? lower;
  }
  return folded.replace(/[^a-z]/g, "");
}

function localPartOf(email: string): string {
  const halves = email.trim().split("@");
  if (halves.length !== 2) return "";
  return (halves[0] ?? "").trim().toLowerCase();
}

function domainOf(email: string): string {
  const halves = email.trim().split("@");
  if (halves.length !== 2) return "";
  return (halves[1] ?? "").trim().toLowerCase();
}

/** Drop separators so `no-reply`, `no_reply` and `noreply` compare as one thing. */
function withoutSeparators(localPart: string): string {
  return localPart.replace(/[._\-’']/g, "");
}

/**
 * Normalise a domain for comparison only. Intentionally minimal: this module
 * does not own domain canonicalisation, it just refuses to compare `Acme.COM`
 * and `acme.com` as different companies.
 */
export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^@/, "");
}

/**
 * Whether an address belongs to a function rather than a person. Checked BEFORE
 * any name matching, so a role mailbox can never become evidence even in the
 * unlucky case where someone's name happens to spell one.
 */
export function isRoleMailbox(email: string): boolean {
  const local = localPartOf(email);
  if (!local) return false;
  return ROLE_MAILBOXES.has(withoutSeparators(local));
}

/**
 * Split a written name into address-building parts.
 *
 * Judgement calls, all deliberate:
 *  - Accents fold to ASCII, because mailboxes are ASCII in practice: `José` is
 *    `jose`.
 *  - Apostrophes and hyphens are removed rather than kept or split on, so
 *    `O'Brien` is `obrien` and `Smith-Jones` is `smithjones`. Both are valid
 *    local parts and both are what companies overwhelmingly use.
 *  - Middle names are recorded but never used. More than two parts means first
 *    and last are the outer two.
 *  - Honorifics are stripped from the front and suffixes from the back, but
 *    only while at least two parts survive, so a short name is never eaten by
 *    an over-eager match.
 *  - A single-word name yields an empty `last`, which makes every pattern that
 *    needs a surname correctly inapplicable.
 */
export function parsePersonName(fullName: string): ParsedName {
  const tokens = fullName
    .normalize("NFC")
    .split(/[\s,]+/)
    .filter((token) => token.trim().length > 0);

  const dropped: string[] = [];
  let parts = tokens;

  // Titles lead, and stack: "Dr. Prof. Ada Lovelace".
  while (parts.length > 1 && HONORIFICS.has(normalizeToken(parts[0] ?? ""))) {
    dropped.push(parts[0] ?? "");
    parts = parts.slice(1);
  }

  // Suffixes trail, and stack: "Harold Reed Jr., PhD". Never drop below two
  // parts: "Reed Jr" with no given name is not worth guessing from.
  while (parts.length > 2 && NAME_SUFFIXES.has(normalizeToken(parts[parts.length - 1] ?? ""))) {
    dropped.push(parts[parts.length - 1] ?? "");
    parts = parts.slice(0, -1);
  }

  const cleaned = parts.map(toAsciiToken).filter((part) => part.length > 0);
  if (cleaned.length === 0) return { first: "", last: "", middle: [], dropped };
  if (cleaned.length === 1) return { first: cleaned[0] ?? "", last: "", middle: [], dropped };

  return {
    first: cleaned[0] ?? "",
    last: cleaned[cleaned.length - 1] ?? "",
    middle: cleaned.slice(1, -1),
    dropped,
  };
}

/**
 * Build the local part a pattern implies for a name, or null when the name does
 * not carry the parts the pattern needs. Null is the honest answer for
 * `first.last` applied to a single-word name.
 */
export function buildLocalPart(pattern: EmailPatternId, name: ParsedName): string | null {
  const { first, last } = name;
  if (!first) return null;
  const firstInitial = first.charAt(0);
  const lastInitial = last.charAt(0);

  switch (pattern) {
    case "first":
      return first;
    case "firstl":
      return last ? `${first}${lastInitial}` : null;
    case "first.last":
      return last ? `${first}.${last}` : null;
    case "firstlast":
      return last ? `${first}${last}` : null;
    case "first_last":
      return last ? `${first}_${last}` : null;
    case "f.last":
      return last ? `${firstInitial}.${last}` : null;
    case "flast":
      return last ? `${firstInitial}${last}` : null;
    case "last.first":
      return last ? `${last}.${first}` : null;
  }
}

/**
 * Which patterns reproduce this person's actual address. Empty means the
 * address is not explainable by the name, which is the signal that it is a role
 * mailbox, a nickname, or somebody else's.
 *
 * Hyphens and apostrophes in the stored address are tolerated, so a company
 * writing `jane.smith-jones@` is still recognised as `first.last` rather than
 * discarded as unexplainable. The separator the pattern owns (`.` or `_`) is
 * never stripped, so `first.last` and `first_last` stay distinguishable.
 */
export function patternsExplaining(known: KnownAddress): EmailPatternId[] {
  const local = localPartOf(known.email);
  if (!local) return [];
  if (isRoleMailbox(known.email)) return [];

  const name = parsePersonName(known.fullName);
  const bare = local.replace(/[’'-]/g, "");

  return EMAIL_PATTERNS.filter((pattern) => {
    const candidate = buildLocalPart(pattern, name);
    return candidate !== null && (local === candidate || bare === candidate);
  });
}

/** More corroboration earns more confidence. One example is never high. */
function confidenceFromSupport(supportingCount: number): ConfidenceLevel {
  if (supportingCount >= 3) return "high";
  if (supportingCount === 2) return "moderate";
  if (supportingCount === 1) return "low";
  return "unknown";
}

function lowerOf(a: ConfidenceLevel, b: ConfidenceLevel): ConfidenceLevel {
  const order: ConfidenceLevel[] = ["unknown", "low", "moderate", "high"];
  return order.indexOf(a) <= order.indexOf(b) ? a : b;
}

function excludeFor(known: KnownAddress, domain: string): ExcludedAddress | null {
  const local = localPartOf(known.email);
  const addressDomain = domainOf(known.email);

  if (!local || !addressDomain) {
    return {
      email: known.email,
      reason: "malformed",
      because: `"${known.email}" is not a readable email address.`,
    };
  }
  if (addressDomain !== domain) {
    return {
      email: known.email,
      reason: "other_domain",
      because: `${known.email} is not at ${domain}, so it says nothing about how ${domain} names mailboxes.`,
    };
  }
  if (isRoleMailbox(known.email)) {
    return {
      email: known.email,
      reason: "role_mailbox",
      because: `${known.email} is a shared role mailbox, not a person's address.`,
    };
  }
  if (!known.fullName.trim()) {
    return {
      email: known.email,
      reason: "unnamed",
      because: `${known.email} has nobody's name attached, so there is nothing to compare it to.`,
    };
  }
  return null;
}

function listPatterns(patterns: EmailPatternId[]): string {
  const labels = patterns.map((pattern) => EMAIL_PATTERN_LABEL[pattern]);
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1] ?? ""}`;
}

/**
 * Read a company's naming convention off the addresses we already trust.
 *
 * Only addresses at `domain` count, role mailboxes are discarded before any
 * matching, and anything the person's own name cannot explain is discarded too.
 * If what survives points at more than one convention, the outcome is
 * `conflicting` and no winner is chosen: a company that genuinely uses two
 * conventions is a company we should not be guessing about.
 */
export function inferEmailPattern(input: {
  domain: string;
  known: KnownAddress[];
}): PatternInference {
  const domain = normalizeDomain(input.domain);
  const excluded: ExcludedAddress[] = [];
  const supporting: PatternSupport[] = [];

  for (const known of input.known) {
    const exclusion = excludeFor(known, domain);
    if (exclusion) {
      excluded.push(exclusion);
      continue;
    }
    const patterns = patternsExplaining(known);
    if (patterns.length === 0) {
      excluded.push({
        email: known.email,
        reason: "unexplained",
        because: `${known.email} cannot be built from "${known.fullName}", so it follows no convention we can reuse.`,
      });
      continue;
    }
    supporting.push({ email: known.email, fullName: known.fullName, patterns });
  }

  if (supporting.length === 0) {
    return {
      kind: "no_pattern",
      domain,
      excluded,
      because: domain
        ? `No address at ${domain} could be matched to the name of the person who holds it, so there is no convention to apply.`
        : "No domain was given, so there is no convention to apply.",
    };
  }

  // A convention must explain every surviving address, not merely the loudest.
  const agreed = EMAIL_PATTERNS.filter((pattern) =>
    supporting.every((support) => support.patterns.includes(pattern)),
  );

  if (agreed.length === 0) {
    const seen = EMAIL_PATTERNS.filter((pattern) =>
      supporting.some((support) => support.patterns.includes(pattern)),
    );
    return {
      kind: "conflicting",
      domain,
      patternsSeen: seen,
      supporting,
      excluded,
      because: `The ${supporting.length} known addresses at ${domain} disagree: they follow ${listPatterns(seen)}. ${domain} has no single convention, so guessing an address would be picking one at random.`,
    };
  }

  const pattern = agreed[0] ?? "first.last";
  const alsoConsistentWith = agreed.slice(1);
  const supported = confidenceFromSupport(supporting.length);
  // Consistent but not decisive evidence cannot reach high confidence: the
  // examples simply do not distinguish the conventions they both satisfy.
  const confidence = alsoConsistentWith.length > 0 ? lowerOf(supported, "moderate") : supported;

  const exampleCount =
    supporting.length === 1 ? "1 known address" : `${supporting.length} known addresses`;
  const ambiguity =
    alsoConsistentWith.length > 0
      ? ` Those examples fit ${listPatterns(alsoConsistentWith)} equally well, so the convention is not settled.`
      : "";

  return {
    kind: "inferred",
    domain,
    pattern,
    alsoConsistentWith,
    supporting,
    excluded,
    confidence,
    because: `${exampleCount} at ${domain} follow ${EMAIL_PATTERN_LABEL[pattern]} (for example ${supporting[0]?.email ?? ""}).${ambiguity}`,
  };
}

/**
 * Propose the address a named person most likely holds, given what we inferred
 * about their company.
 *
 * Declines rather than guesses when there is no convention, when the company
 * uses more than one, or when the name does not carry the parts the convention
 * needs. The returned rationale is written for the human who has to decide
 * whether to trust it, and says out loud that nobody has confirmed the address.
 */
export function proposeEmail(fullName: string, inference: PatternInference): EmailProposal {
  if (inference.kind === "no_pattern") {
    return { kind: "declined", because: inference.because };
  }
  if (inference.kind === "conflicting") {
    return { kind: "declined", because: inference.because };
  }

  const name = parsePersonName(fullName);
  if (!name.first) {
    return {
      kind: "declined",
      because: `"${fullName}" does not contain a usable name, so there is nothing to build an address from.`,
    };
  }

  const local = buildLocalPart(inference.pattern, name);
  if (!local) {
    return {
      kind: "declined",
      because: `${inference.domain} uses ${EMAIL_PATTERN_LABEL[inference.pattern]}, but "${fullName}" has no surname to put in it.`,
    };
  }

  const supportingCount = inference.supporting.length;
  const collisionProne = COLLISION_PRONE_PATTERNS.includes(inference.pattern);
  const confidence = collisionProne
    ? lowerOf(inference.confidence, "moderate")
    : inference.confidence;

  const example = inference.supporting[0]?.email ?? "";
  const countPhrase =
    supportingCount === 1 ? "1 known address" : `${supportingCount} known addresses`;
  const ambiguity =
    inference.alsoConsistentWith.length > 0
      ? ` Those addresses fit ${listPatterns(inference.alsoConsistentWith)} just as well, so this is a best guess between conventions.`
      : "";
  const collision = collisionProne
    ? ` Because the convention is only a first name, a second ${name.first} at ${inference.domain} could not share it.`
    : "";

  return {
    kind: "candidate",
    candidate: {
      email: `${local}@${inference.domain}`,
      pattern: inference.pattern,
      confidence,
      supportingCount,
      rationale: `Guess only: ${countPhrase} at ${inference.domain} use ${EMAIL_PATTERN_LABEL[inference.pattern]} (for example ${example}), so ${fullName.trim()} most likely uses ${local}@${inference.domain}.${ambiguity}${collision} Nobody has confirmed this address, so check it before sending.`,
    },
  };
}

/**
 * The whole job in one call, for the common case: known addresses in, a guess
 * or a refusal out. Kept alongside the two halves so a caller that wants to
 * show the inference to a human can still reach it.
 */
export function proposeEmailFromKnown(input: {
  fullName: string;
  domain: string;
  known: KnownAddress[];
}): EmailProposal {
  return proposeEmail(
    input.fullName,
    inferEmailPattern({ domain: input.domain, known: input.known }),
  );
}
