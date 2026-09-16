/**
 * Scout, the people layer for a qualified account.
 *
 * Scout answers four questions about a company that already matches the ICP:
 * who owns or influences the problem, why each person matters here, whether we
 * hold a professional address we can stand behind, and who should move into
 * Comms.
 *
 * Three rules hold throughout and are enforced by the functions below:
 *  1. Evidence wins. A buying role is "unknown" unless the evidence supports
 *     something better, and thought leadership only exists when a provider
 *     returned it.
 *  2. An address is never called verified unless the provider evidence said
 *     so. Age is a product policy, not a claim the address stopped working.
 *  3. Nothing here reaches a provider, spends a credit or sends a message.
 *     This module is pure: same input, same answer.
 */

export type BuyingRole = "owner" | "influencer" | "champion" | "unknown";

export const BUYING_ROLE_LABEL: Record<BuyingRole, string> = {
  owner: "Owner",
  influencer: "Influencer",
  champion: "Champion",
  unknown: "Unknown",
};

/** What is stored about an address. Staleness is derived, never stored. */
export type StoredEmailStatus = "verified" | "found_unverified" | "not_found" | "not_checked";

/** What a person reads on the card. */
export type WorkEmailState = StoredEmailStatus | "stale";

export const EMAIL_STATE_LABEL: Record<WorkEmailState, string> = {
  verified: "Verified",
  found_unverified: "Found, not verified",
  not_found: "Not found",
  not_checked: "Not checked",
  stale: "Stale",
};

export type EnrichmentProviderId = "apollo" | "clay" | "manual" | "other";

export const PROVIDER_LABEL: Record<EnrichmentProviderId, string> = {
  apollo: "Apollo",
  clay: "Clay",
  manual: "Entered by a person",
  other: "Other source",
};

/**
 * Product policy, not a verdict on the address: after this many days we ask
 * for a fresh check before treating the address as current.
 */
export const EMAIL_STALE_AFTER_DAYS = 90;

export interface ThoughtLeadership {
  /** One short sentence a provider actually returned. Never composed here. */
  summary: string;
  sourceUrl?: string;
  provider: EnrichmentProviderId;
  observedAt: string;
}

/** A person Scout has researched for one account. */
export interface ScoutPerson {
  /** Stable key within the account. Provider id when there is one. */
  key: string;
  fullName: string;
  title?: string;
  companyName: string;
  companyDomain?: string;
  /** A public profile link a provider returned. Never a crawl target. */
  profileUrl?: string;
  buyingRole: BuyingRole;
  /** The evidence behind the buying role, in the provider's own words. */
  buyingRoleEvidence?: string;
  /** One concise evidence-backed sentence: why this person, this account. */
  whyThisPerson: string;
  workEmail?: string;
  emailStatus: StoredEmailStatus;
  provider: EnrichmentProviderId;
  providerPersonId?: string;
  discoveredAt: string;
  /** When the address was fetched from a provider. */
  emailFetchedAt?: string;
  /** When a provider actually asserted the address is deliverable. */
  emailVerifiedAt?: string;
  thoughtLeadership?: ThoughtLeadership | null;
  selectedForOutreach?: boolean;
  /** Another person on this account who could be the same human. */
  ambiguousWith?: string[];
  /** How much evidence stands behind this recommendation, 0 to 100. */
  support: number;
}

function days(from: string, to: string): number {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return (b - a) / 86_400_000;
}

/** What the card shows for this address right now. */
export function workEmailState(
  person: Pick<ScoutPerson, "emailStatus" | "workEmail" | "emailVerifiedAt" | "emailFetchedAt">,
  now: string,
  staleAfterDays: number = EMAIL_STALE_AFTER_DAYS,
): WorkEmailState {
  if (!person.workEmail) {
    return person.emailStatus === "not_found" ? "not_found" : "not_checked";
  }
  const checkedAt = person.emailVerifiedAt ?? person.emailFetchedAt;
  if (checkedAt && days(checkedAt, now) >= staleAfterDays) return "stale";
  return person.emailStatus === "verified" ? "verified" : "found_unverified";
}

/** The one action that moves this person forward. */
export type PersonAction = "find_email" | "refresh" | "prepare_outreach";

export function nextAction(state: WorkEmailState): PersonAction {
  if (state === "not_checked" || state === "not_found") return "find_email";
  if (state === "stale") return "refresh";
  return "prepare_outreach";
}

/* ------------------------------------------------------- buying role */

/**
 * The functional families that could own the problem for THIS account. Scout
 * passes the ones the opportunity actually implies; nothing is hardcoded as
 * globally correct, and "find the C-suite" is never the rule.
 */
export interface OpportunityContext {
  /** e.g. ["operations", "digital", "learning"] for this opportunity. */
  functionalOwners: string[];
  /** The problem in a few words, used only to read evidence, never invented. */
  problem?: string;
}

const SENIOR = /\b(founder|co-?founder|owner|ceo|coo|cto|cmo|cfo|chief|president|managing director|partner|principal|vp|vice president|head of|director)\b/i;

function mentions(title: string, family: string): boolean {
  const value = title.toLowerCase();
  const key = family.toLowerCase();
  if (value.includes(key)) return true;
  const aliases: Record<string, string[]> = {
    operations: ["operations", "operating", "ops", "coo", "delivery", "service"],
    digital: ["digital", "technology", "technical", "cto", "engineering", "product"],
    marketing: ["marketing", "brand", "growth", "demand", "communications"],
    learning: ["learning", "training", "enablement", "development", "l&d"],
    customer: ["customer", "client", "experience", "success", "support"],
    finance: ["finance", "financial", "commercial"],
    people: ["people", "hr", "human resources", "talent"],
  };
  return (aliases[key] ?? []).some((alias) => value.includes(alias));
}

/**
 * The buying role, read from evidence. When the evidence cannot carry a
 * conclusion the answer is "unknown": a guess here becomes a wrong message.
 */
export function inferBuyingRole(input: {
  title?: string | undefined;
  opportunity: OpportunityContext;
  thoughtLeadership?: ThoughtLeadership | null | undefined;
}): { role: BuyingRole; evidence?: string } {
  const title = (input.title ?? "").trim();
  if (!title) {
    if (input.thoughtLeadership?.summary) {
      return {
        role: "champion",
        evidence: `Publishes on this area: ${input.thoughtLeadership.summary}`,
      };
    }
    return { role: "unknown" };
  }

  const ownsFunction = input.opportunity.functionalOwners.some((family) =>
    mentions(title, family),
  );
  const senior = SENIOR.test(title);

  if (ownsFunction && senior) {
    return { role: "owner", evidence: `Title "${title}" leads the function this work sits in.` };
  }
  if (input.thoughtLeadership?.summary && ownsFunction) {
    return {
      role: "champion",
      evidence: `Works in this area and publishes on it: ${input.thoughtLeadership.summary}`,
    };
  }
  if (senior) {
    return { role: "influencer", evidence: `Title "${title}" is senior enough to weigh in.` };
  }
  if (ownsFunction) {
    return { role: "influencer", evidence: `Title "${title}" works inside the function affected.` };
  }
  return { role: "unknown" };
}

/* ---------------------------------------------------------- dedupe */

function normaliseName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normaliseEmail(value: string | undefined): string | undefined {
  return value ? value.trim().toLowerCase() : undefined;
}

function normaliseUrl(value: string | undefined): string | undefined {
  return value ? value.trim().toLowerCase().replace(/\/+$/, "") : undefined;
}

function conflicts(a: ScoutPerson, b: ScoutPerson): boolean {
  const idA = a.providerPersonId;
  const idB = b.providerPersonId;
  if (idA && idB && idA !== idB) return true;
  const emailA = normaliseEmail(a.workEmail);
  const emailB = normaliseEmail(b.workEmail);
  if (emailA && emailB && emailA !== emailB) return true;
  const urlA = normaliseUrl(a.profileUrl);
  const urlB = normaliseUrl(b.profileUrl);
  if (urlA && urlB && urlA !== urlB) return true;
  const titleA = a.title?.trim().toLowerCase();
  const titleB = b.title?.trim().toLowerCase();
  return Boolean(titleA && titleB && titleA !== titleB);
}

function merge(into: ScoutPerson, other: ScoutPerson): ScoutPerson {
  const pick = (a: string | undefined, b: string | undefined) => a ?? b;
  const title = pick(into.title, other.title);
  const profileUrl = pick(into.profileUrl, other.profileUrl);
  const companyDomain = pick(into.companyDomain, other.companyDomain);
  const workEmail = pick(into.workEmail, other.workEmail);
  const emailFetchedAt = pick(into.emailFetchedAt, other.emailFetchedAt);
  const emailVerifiedAt = pick(into.emailVerifiedAt, other.emailVerifiedAt);
  const providerPersonId = pick(into.providerPersonId, other.providerPersonId);
  return {
    ...into,
    ...(title ? { title } : {}),
    ...(profileUrl ? { profileUrl } : {}),
    ...(companyDomain ? { companyDomain } : {}),
    ...(workEmail ? { workEmail } : {}),
    emailStatus: into.workEmail ? into.emailStatus : other.emailStatus,
    ...(emailFetchedAt ? { emailFetchedAt } : {}),
    ...(emailVerifiedAt ? { emailVerifiedAt } : {}),
    ...(providerPersonId ? { providerPersonId } : {}),
    thoughtLeadership: into.thoughtLeadership ?? other.thoughtLeadership ?? null,
    support: Math.max(into.support, other.support),
  };
}

/**
 * One row per human, on the strongest identifier available. Two records that
 * only share a name are merged when nothing about them disagrees; when
 * anything disagrees they both stay, each pointing at the other, and a person
 * decides. Automatic merging of ambiguous people is never right.
 */
export function dedupePeople(people: ScoutPerson[]): ScoutPerson[] {
  const kept: ScoutPerson[] = [];

  for (const person of people) {
    const strongIndex = kept.findIndex((existing) => {
      const sameProvider =
        existing.providerPersonId &&
        person.providerPersonId &&
        existing.provider === person.provider &&
        existing.providerPersonId === person.providerPersonId;
      const sameEmail =
        normaliseEmail(existing.workEmail) &&
        normaliseEmail(existing.workEmail) === normaliseEmail(person.workEmail);
      const sameProfile =
        normaliseUrl(existing.profileUrl) &&
        normaliseUrl(existing.profileUrl) === normaliseUrl(person.profileUrl);
      return Boolean(sameProvider || sameEmail || sameProfile);
    });

    if (strongIndex >= 0) {
      kept[strongIndex] = merge(kept[strongIndex] as ScoutPerson, person);
      continue;
    }

    const nameIndex = kept.findIndex(
      (existing) =>
        normaliseName(existing.fullName) === normaliseName(person.fullName) &&
        normaliseName(existing.companyName) === normaliseName(person.companyName),
    );

    if (nameIndex >= 0) {
      const existing = kept[nameIndex] as ScoutPerson;
      if (!conflicts(existing, person)) {
        kept[nameIndex] = merge(existing, person);
        continue;
      }
      kept[nameIndex] = {
        ...existing,
        ambiguousWith: [...(existing.ambiguousWith ?? []), person.key],
      };
      kept.push({ ...person, ambiguousWith: [...(person.ambiguousWith ?? []), existing.key] });
      continue;
    }

    kept.push(person);
  }

  return kept;
}

/* ------------------------------------------------- recommendation */

export const RECOMMENDED_LIMIT = 4;

function rank(person: ScoutPerson): number {
  const role = person.buyingRole === "owner" ? 40 : person.buyingRole === "champion" ? 30 : person.buyingRole === "influencer" ? 20 : 0;
  const email =
    person.emailStatus === "verified" ? 15 : person.emailStatus === "found_unverified" ? 8 : 0;
  const leadership = person.thoughtLeadership?.summary ? 10 : 0;
  const reasoned = person.whyThisPerson.trim().length > 0 ? 5 : 0;
  const ambiguous = (person.ambiguousWith ?? []).length > 0 ? -10 : 0;
  return role + email + leadership + reasoned + ambiguous + Math.min(person.support, 30);
}

export interface PeopleRecommendation {
  /** At most four, best supported first. */
  recommended: ScoutPerson[];
  /** Everyone else, kept but not shown by default. */
  others: ScoutPerson[];
}

export function recommendPeople(
  people: ScoutPerson[],
  limit: number = RECOMMENDED_LIMIT,
): PeopleRecommendation {
  const unique = dedupePeople(people);
  const ordered = [...unique].sort((a, b) => {
    const difference = rank(b) - rank(a);
    return difference !== 0 ? difference : a.fullName.localeCompare(b.fullName);
  });
  return { recommended: ordered.slice(0, limit), others: ordered.slice(limit) };
}

/* ------------------------------------------------ provider policy */

export interface ProviderConfigRead {
  apolloConfigured: boolean;
  clayConfigured: boolean;
  /** Workspace preference. Apollo first when nothing is set. */
  preferred?: EnrichmentProviderId[];
  /** A workspace admin may allow bounded automatic enrichment. Off by default. */
  automaticEnrichment?: boolean;
}

/** Which providers will actually be tried, in order. Empty means unconfigured. */
export function providerOrder(config: ProviderConfigRead): EnrichmentProviderId[] {
  const preference = config.preferred?.length ? config.preferred : (["apollo", "clay"] as const);
  return preference.filter((id) =>
    id === "apollo" ? config.apolloConfigured : id === "clay" ? config.clayConfigured : false,
  ) as EnrichmentProviderId[];
}

export function isEnrichmentConnected(config: ProviderConfigRead): boolean {
  return providerOrder(config).length > 0;
}

/** The calm, honest line when nothing is wired up in this app. */
export const NOT_CONNECTED_MESSAGE =
  "Contact enrichment is not connected. An admin adds an Apollo or Clay key in Settings, Integrations before Scout can look people up.";

/* ------------------------------------------------ credit safety */

export interface BulkEnrichmentPlan {
  people: number;
  /** The most provider operations this can cost, one per person per attempt. */
  maximumProviderOperations: number;
  provider: EnrichmentProviderId | null;
  /** Fallback provider, used only when the first fails in a retryable way. */
  fallback: EnrichmentProviderId | null;
  requiresConfirmation: boolean;
  because: string;
}

/**
 * What a bulk run would cost, in operations, before anybody clicks. Anything
 * above one person is a paid batch and asks first.
 */
export function planBulkEnrichment(
  count: number,
  config: ProviderConfigRead,
): BulkEnrichmentPlan {
  const order = providerOrder(config);
  const provider = order[0] ?? null;
  const fallback = order[1] ?? null;
  if (!provider) {
    return {
      people: count,
      maximumProviderOperations: 0,
      provider: null,
      fallback: null,
      requiresConfirmation: false,
      because: NOT_CONNECTED_MESSAGE,
    };
  }
  const maximum = fallback ? count * 2 : count;
  return {
    people: count,
    maximumProviderOperations: maximum,
    provider,
    fallback,
    requiresConfirmation: count > 1,
    because:
      count > 1
        ? `Looking up ${count} ${count === 1 ? "address" : "addresses"} with ${PROVIDER_LABEL[provider]} uses up to ${maximum} provider ${maximum === 1 ? "operation" : "operations"}, which your ${PROVIDER_LABEL[provider]} account pays for. Confirm before this runs.`
        : `One lookup with ${PROVIDER_LABEL[provider]}.`,
  };
}

/* ---------------------------------------------------- Comms handoff */

export interface OutreachHandoff {
  recipientName: string;
  recipientEmail: string | null;
  emailState: WorkEmailState;
  provider: EnrichmentProviderId;
  companyName: string;
  companyDomain: string | null;
  whyThisPerson: string;
  buyingRole: BuyingRole;
  buyingRoleEvidence: string | null;
  thoughtLeadership: ThoughtLeadership | null;
  /** What Scout already observed about the company, as research, not fact. */
  companyContext: string[];
  /** Shown before approval when the address cannot be stood behind. */
  warning: string | null;
  note: string;
}

export const RESEARCH_NOTE =
  "These lines are research and context from Scout. Nothing here is a fact to build on beyond the evidence attached to it.";

export function canPrepareOutreach(
  state: WorkEmailState,
  options: { otherConfirmedChannel?: boolean } = {},
): boolean {
  if (state === "verified" || state === "found_unverified" || state === "stale") return true;
  return Boolean(options.otherConfirmedChannel);
}

export function buildOutreachHandoff(input: {
  person: ScoutPerson;
  now: string;
  companyContext: string[];
  opportunity?: OpportunityContext | undefined;
}): OutreachHandoff {
  const state = workEmailState(input.person, input.now);
  const warning =
    state === "stale"
      ? `This address was last checked over ${EMAIL_STALE_AFTER_DAYS} days ago. Refresh it or confirm it by hand before approval.`
      : state === "found_unverified"
        ? "This address was found but never verified by the provider. Confirm it before approval."
        : state === "not_checked" || state === "not_found"
          ? "No professional address is on record for this person."
          : null;

  return {
    recipientName: input.person.fullName,
    recipientEmail: input.person.workEmail ?? null,
    emailState: state,
    provider: input.person.provider,
    companyName: input.person.companyName,
    companyDomain: input.person.companyDomain ?? null,
    whyThisPerson: input.person.whyThisPerson,
    buyingRole: input.person.buyingRole,
    buyingRoleEvidence: input.person.buyingRoleEvidence ?? null,
    thoughtLeadership: input.person.thoughtLeadership ?? null,
    companyContext: input.companyContext,
    warning,
    note: RESEARCH_NOTE,
  };
}

/* ------------------------------------------------------- privacy */

const PERSONAL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "live.com",
  "me.com",
];

/** Personal addresses are not professional outreach, so they never show. */
export function isProfessionalEmail(email: string | undefined, companyDomain?: string): boolean {
  if (!email) return false;
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  if (PERSONAL_DOMAINS.includes(domain)) return false;
  if (companyDomain) {
    const company = companyDomain.toLowerCase().replace(/^www\./, "");
    return domain === company || domain.endsWith(`.${company}`) || !PERSONAL_DOMAINS.includes(domain);
  }
  return true;
}

/**
 * The card only ever holds what this capability is for: a professional
 * address, no personal address, and never a phone number.
 */
export function forDisplay(person: ScoutPerson): ScoutPerson {
  const professional = isProfessionalEmail(person.workEmail, person.companyDomain);
  if (professional) return person;
  const { workEmail: _dropped, ...rest } = person;
  return { ...rest, emailStatus: "not_found" };
}
