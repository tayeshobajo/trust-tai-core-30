/**
 * What makes a researched person the same person, and what may be written.
 *
 * Pure rules, shared by the server store and the tests. Two things matter
 * here and nothing else:
 *
 *  1. Identity. A person is matched on the strongest identifier available:
 *     the provider's own id, then a professional address, then a public
 *     profile link, and only then a key a person entered by hand. Two records
 *     that share nothing but a name are never the same row.
 *  2. Honesty of the address state. "Verified" is a claim a provider made,
 *     never something a browser may assert, so the stored state is always
 *     derived here from the provider answer.
 */

import type {
  EnrichmentProviderId,
  ScoutPerson,
  StoredEmailStatus,
} from "@/domain/scout-people";

export type MatchKind = "provider" | "email" | "profile" | "manual";

export interface PersonIdentityKey {
  kind: MatchKind;
  value: string;
}

function tidy(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * The identity this person is stored under, inside one prospect. A name alone
 * never produces a match key: manual rows carry a key of their own so that two
 * different people called the same thing stay two rows.
 */
export function identityKey(
  person: Pick<ScoutPerson, "providerPersonId" | "workEmail" | "profileUrl" | "fullName" | "key">,
): PersonIdentityKey {
  const providerId = tidy(person.providerPersonId);
  if (providerId) return { kind: "provider", value: providerId };

  const email = tidy(person.workEmail);
  if (email.includes("@")) return { kind: "email", value: email };

  const profile = tidy(person.profileUrl).replace(/\/+$/, "");
  if (profile) return { kind: "profile", value: profile };

  // Deliberately not the name: the session key is unique per discovered row,
  // so two unidentified people at one company never collapse into one.
  return { kind: "manual", value: tidy(person.key) || tidy(person.fullName) };
}

/** Never merge two rows automatically on a name alone. */
export function canAutoMatch(a: PersonIdentityKey, b: PersonIdentityKey): boolean {
  if (a.kind === "manual" || b.kind === "manual") return a.kind === b.kind && a.value === b.value;
  return a.kind === b.kind && a.value === b.value;
}

export interface ProviderEmailAnswer {
  email?: string | null;
  /** Exactly what the provider asserted, never what a client asked for. */
  verified: boolean;
  provider: EnrichmentProviderId;
  at: string;
}

export interface StoredEmailFacts {
  workEmail: string | null;
  emailStatus: StoredEmailStatus;
  emailFetchedAt: string | null;
  emailVerifiedAt: string | null;
  provider: EnrichmentProviderId;
}

/**
 * The address state that may be stored, derived from the provider answer
 * alone. This is the only place a "verified" state can come into existence.
 */
export function storedEmailFacts(answer: ProviderEmailAnswer): StoredEmailFacts {
  const email = (answer.email ?? "").trim();
  if (!email) {
    return {
      workEmail: null,
      emailStatus: "not_found",
      emailFetchedAt: answer.at,
      emailVerifiedAt: null,
      provider: answer.provider,
    };
  }
  return {
    workEmail: email,
    emailStatus: answer.verified ? "verified" : "found_unverified",
    emailFetchedAt: answer.at,
    emailVerifiedAt: answer.verified ? answer.at : null,
    provider: answer.provider,
  };
}

/** Fields a client may state when saving research. Addresses are not here. */
export interface SavableResearch {
  fullName: string;
  title?: string | undefined;
  companyName: string;
  companyDomain?: string | undefined;
  profileUrl?: string | undefined;
  buyingRole: ScoutPerson["buyingRole"];
  buyingRoleEvidence?: string | undefined;
  whyThisPerson: string;
  provider: EnrichmentProviderId;
  providerPersonId?: string | undefined;
  discoveredAt: string;
  thoughtLeadershipSummary?: string | undefined;
  thoughtLeadershipSource?: string | undefined;
}

/**
 * Strip a client-supplied person down to what it is allowed to state. Anything
 * about an address, a verification or a timestamp of one is dropped: only the
 * server's own provider call may write those.
 */
export function savableResearch(input: Partial<ScoutPerson> & { fullName?: string }): SavableResearch | null {
  const fullName = (input.fullName ?? "").trim();
  const companyName = (input.companyName ?? "").trim();
  if (!fullName || !companyName) return null;
  const provider: EnrichmentProviderId =
    input.provider === "apollo" || input.provider === "clay" || input.provider === "manual"
      ? input.provider
      : "other";
  return {
    fullName,
    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
    companyName,
    ...(input.companyDomain?.trim() ? { companyDomain: input.companyDomain.trim() } : {}),
    ...(input.profileUrl?.trim() ? { profileUrl: input.profileUrl.trim() } : {}),
    buyingRole:
      input.buyingRole === "owner" ||
      input.buyingRole === "influencer" ||
      input.buyingRole === "champion"
        ? input.buyingRole
        : "unknown",
    ...(input.buyingRoleEvidence?.trim()
      ? { buyingRoleEvidence: input.buyingRoleEvidence.trim() }
      : {}),
    whyThisPerson: (input.whyThisPerson ?? "").trim() || `Researched at ${companyName}.`,
    provider,
    ...(input.providerPersonId?.trim() ? { providerPersonId: input.providerPersonId.trim() } : {}),
    discoveredAt: input.discoveredAt ?? new Date().toISOString(),
    ...(input.thoughtLeadership?.summary
      ? { thoughtLeadershipSummary: input.thoughtLeadership.summary }
      : {}),
    ...(input.thoughtLeadership?.sourceUrl
      ? { thoughtLeadershipSource: input.thoughtLeadership.sourceUrl }
      : {}),
  };
}
