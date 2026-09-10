/**
 * Scout, resolving people who are already known.
 *
 * The law: Scout resolves known people before claiming nobody is known.
 *
 * A company can already be represented in canonical Trust Tai data long before
 * anyone opens its Scout page: a founder filled in the roadmap intake and gave
 * their own name and address, or a person with that company's email domain is
 * already on record as a contact. Until now Scout only read contacts already
 * stamped with this prospect's id, so it announced "no person is known" while
 * the person sat one table away. That is not caution, it is a false statement.
 *
 * This module is pure. It decides, from evidence it is handed, what should be
 * linked and what should be created. It never fetches, writes, or guesses:
 *
 *   link    an existing canonical contact belongs to this company (same
 *           registrable domain, or the same person the intake named), so the
 *           existing record is reused rather than duplicated
 *   create  the intake named a person nobody has on record yet; their own
 *           words become an observed record, never a verified one
 *
 * Weak similarity is never a match. Matching is exact email, or exact
 * normalized full name. Nothing is inferred from initials, nicknames, or
 * partial names, and a person is never invented from an address alone.
 */

import { canonicalDomain, domainFromEmail } from "@/domain/website-matching";
import type { Person, Seniority } from "@/domain/people";
import type { WebsiteSubmission } from "@/domain/website";

/** How a resolved person came to be attached to this company. */
export type PersonResolutionReason =
  /** They filled in the roadmap intake for this company themselves. */
  | "inbound_intake"
  /** Their business email is on this company's own domain. */
  | "same_domain"
  /** They are a Trust Tai workspace member on this company's own domain. */
  | "workspace_member"
  /** They are already on record through client work for this same company. */
  | "client_record";

/**
 * A person Trust Tai already knows as an account holder rather than as a
 * contact row: a workspace member. Their own account address is canonical
 * truth about who they are, so it outranks anything inferred from the web.
 */
export interface MemberIdentity {
  userId: string;
  fullName: string;
  email: string;
  roleTitle?: string | null;
}

export interface PersonLinkPlan {
  contactId: string;
  reason: PersonResolutionReason;
  /** Plain-language provenance, stored on the record when it is linked. */
  note: string;
}

export interface PersonCreatePlan {
  fullName: string;
  email?: string;
  roleTitle?: string;
  seniority: Seniority;
  reason: PersonResolutionReason;
  note: string;
  /** The submission this testimony came from. Keeps the claim traceable. */
  submissionId?: string;
  /** The workspace member this identity came from, when that is the source. */
  memberUserId?: string;
}

export interface PersonResolutionPlan {
  link: PersonLinkPlan[];
  create: PersonCreatePlan[];
}

const EMPTY: PersonResolutionPlan = { link: [], create: [] };

function normalizedName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizedEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Founder-shaped titles read as founder; everything else stays honest. */
function seniorityFor(role: string | null | undefined): Seniority {
  const text = (role ?? "").toLowerCase();
  if (/founder|co-?founder/.test(text)) return "founder";
  if (/owner|principal|proprietor/.test(text)) return "owner";
  if (/ceo|cto|coo|cmo|chief|director|partner|managing/.test(text)) return "exec";
  if (/market|growth|brand/.test(text)) return "marketing";
  if (/ops|operation/.test(text)) return "operations";
  return "other";
}

function sameHuman(person: Person, name: string, email: string): boolean {
  const personEmail = normalizedEmail(person.email);
  if (email && personEmail && personEmail === email) return true;
  return Boolean(name) && normalizedName(person.fullName) === name;
}

function shortDate(value: string | null | undefined): string {
  if (!value) return "the roadmap intake";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "the roadmap intake";
  return at.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * What Scout should reuse or record for this company before it is allowed to
 * say nobody is known.
 *
 * @param prospectPeople people already stamped with this prospect
 * @param orgPeople every contact the organization holds, for canonical reuse
 * @param submissions inbound roadmap-intake submissions behind this company
 * @param members workspace members, who are known people too
 * @param websiteUrl the company's own website, for domain resolution
 */
export function planPersonResolution({
  prospectPeople,
  orgPeople,
  submissions,
  members = [],
  websiteUrl,
}: {
  prospectPeople: Person[];
  orgPeople: Person[];
  submissions: WebsiteSubmission[];
  members?: MemberIdentity[];
  websiteUrl?: string | null;
}): PersonResolutionPlan {
  const plan: PersonResolutionPlan = { link: [], create: [] };
  const known = [...prospectPeople];
  const linked = new Set<string>();

  const remember = (person: Person) => known.push(person);

  // 1. The people the founders named themselves. Canonical reuse first: if the
  //    organization already holds that human, that record is the one used.
  for (const submission of submissions) {
    const name = submission.person.name?.trim();
    if (!name) continue; // A person is never invented from an address alone.
    const email = normalizedEmail(submission.person.email);
    const normalized = normalizedName(name);

    if (known.some((person) => sameHuman(person, normalized, email))) continue;

    const existing = orgPeople.find((person) => sameHuman(person, normalized, email));
    const note = `Given by this person in the roadmap intake on ${shortDate(submission.submittedAt)}.`;

    if (existing) {
      if (linked.has(existing.id)) continue;
      linked.add(existing.id);
      plan.link.push({ contactId: existing.id, reason: "inbound_intake", note });
      remember(existing);
      continue;
    }

    plan.create.push({
      fullName: name,
      ...(email ? { email } : {}),
      ...(submission.person.role ? { roleTitle: submission.person.role } : {}),
      seniority: seniorityFor(submission.person.role),
      reason: "inbound_intake",
      note,
      submissionId: submission.id,
    });
    remember({
      id: `pending:${submission.id}`,
      fullName: name,
      ...(email ? { email } : {}),
    } as Person);
  }

  // 2. People whose business address is on the company's own domain. Same
  //    domain is the same company: deterministic, never a similarity guess.
  //    A contact already held through client work for the same domain counts:
  //    it is reused and stays that client's record, it is never moved.
  const domain = canonicalDomain(websiteUrl);
  if (domain) {
    for (const person of orgPeople) {
      if (linked.has(person.id)) continue;
      if (person.prospectId) continue; // Already placed on another company.
      if (domainFromEmail(person.email) !== domain) continue;
      if (known.some((other) => other.id === person.id)) continue;
      linked.add(person.id);
      plan.link.push({
        contactId: person.id,
        reason: person.clientId ? "client_record" : "same_domain",
        note: person.clientId
          ? `Already on record through client work, with an ${domain} business address.`
          : `Already on record with an ${domain} business address.`,
      });
      remember(person);
    }

    // 3. Trust Tai's own people. A workspace member whose account address is
    //    on this company's domain is that company's person, and Scout knows
    //    them for certain. Their account is canonical, so this is reuse of a
    //    known human, never a guess from the web.
    for (const member of members) {
      const email = normalizedEmail(member.email);
      const name = member.fullName.trim();
      if (!email || !name) continue;
      if (domainFromEmail(email) !== domain) continue;
      if (known.some((person) => sameHuman(person, normalizedName(name), email))) continue;

      const existing = orgPeople.find((person) => sameHuman(person, normalizedName(name), email));
      const note = `Known to Trust Tai as a workspace member with an ${domain} address.`;

      if (existing) {
        if (linked.has(existing.id)) continue;
        linked.add(existing.id);
        plan.link.push({ contactId: existing.id, reason: "workspace_member", note });
        remember(existing);
        continue;
      }

      plan.create.push({
        fullName: name,
        email,
        ...(member.roleTitle ? { roleTitle: member.roleTitle } : {}),
        seniority: seniorityFor(member.roleTitle),
        reason: "workspace_member",
        note,
        memberUserId: member.userId,
      });
      remember({ id: `pending:${member.userId}`, fullName: name, email } as Person);
    }
  }

  return plan;
}

export const EMPTY_PERSON_RESOLUTION = EMPTY;
