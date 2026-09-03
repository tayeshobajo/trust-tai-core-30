/**
 * Approved source, the company's own public website.
 *
 * This provider reads nothing new. It re-reads what `scout-research` already
 * pulled from the company's public pages (team page, contact page, structured
 * data) and turns named people and published business emails into drafts.
 *
 * Nothing is invented: a draft only exists when a name or an address was
 * literally present in the stored research output.
 */

import {
  guessSeniority,
  type PeopleDiscoveryInput,
  type PeopleProvider,
  type PersonDraft,
} from "@/domain/people";

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const ROLE_HINT =
  /(founder|co-?founder|owner|principal|partner|ceo|cto|coo|cmo|cfo|chief|president|managing director|director|head of|manager|lead)/i;

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function readString(source: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

/** Names published on a team/about page, when the backend recorded them. */
function peopleFromFacts(facts: Record<string, unknown>): PersonDraft[] {
  const buckets = ["people", "team", "team_members", "decision_makers", "leadership"];
  const drafts: PersonDraft[] = [];

  for (const bucket of buckets) {
    for (const entry of asArray(facts[bucket])) {
      if (typeof entry === "string") {
        const name = entry.trim();
        if (name.length > 2 && /\s/.test(name)) {
          drafts.push({ fullName: name, seniority: "other", confidence: "observed" });
        }
        continue;
      }
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const fullName = readString(record, "name", "full_name", "person");
      if (!fullName) continue;
      const roleTitle = readString(record, "role", "title", "role_title", "position");
      const email = readString(record, "email");
      drafts.push({
        fullName,
        ...(roleTitle ? { roleTitle } : {}),
        seniority: guessSeniority(roleTitle),
        ...(email ? { email, emailStatus: "found" as const } : {}),
        ...(readString(record, "linkedin", "linkedin_url")
          ? { linkedinUrl: readString(record, "linkedin", "linkedin_url")! }
          : {}),
        ...(readString(record, "source_url", "url")
          ? { sourceUrl: readString(record, "source_url", "url")! }
          : {}),
        confidence: "observed",
      });
    }
  }

  return drafts;
}

/** Published business addresses. Found, never verified, nobody tested them. */
function emailsFromText(input: PeopleDiscoveryInput): PersonDraft[] {
  const haystack = [
    ...(input.statements ?? []),
    ...Object.values(input.facts ?? {}).map((value) =>
      typeof value === "string" ? value : JSON.stringify(value ?? ""),
    ),
  ].join(" ");

  const found = new Set((haystack.match(EMAIL_RE) ?? []).map((email) => email.toLowerCase()));
  const drafts: PersonDraft[] = [];

  for (const email of found) {
    const local = email.split("@")[0] ?? "";
    const generic =
      /^(info|hello|contact|admin|support|sales|office|team|enquiries|inquiries)$/i.test(local);
    if (generic) continue;
    const guessName = local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
    if (guessName.length < 3) continue;
    drafts.push({
      fullName: guessName,
      email,
      emailStatus: "found",
      seniority: "other",
      confidence: "inferred",
      note: "Name inferred from a published address. Confirm before using it.",
    });
  }

  return drafts;
}

/** Role mentions in observed statements, e.g. "Founder Jane Doe leads …". */
function rolesFromStatements(input: PeopleDiscoveryInput): PersonDraft[] {
  const drafts: PersonDraft[] = [];
  for (const statement of input.statements ?? []) {
    const match = statement.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*[,–, -]\s*([^.,;]{3,60})/);
    if (!match) continue;
    const [, fullName, roleTitle] = match;
    if (!fullName || !roleTitle || !ROLE_HINT.test(roleTitle)) continue;
    drafts.push({
      fullName,
      roleTitle: roleTitle.trim(),
      seniority: guessSeniority(roleTitle),
      confidence: "observed",
      sourceUrl: input.websiteUrl ?? "",
    });
  }
  return drafts;
}

export const websitePeopleProvider: PeopleProvider = {
  id: "website-people",
  label: "Company website",
  description:
    "Named people and published business emails already read from the company's own public pages.",
  kind: "public_website",
  approved: true,
  baseConfidence: "observed",

  async available() {
    return true;
  },

  async discover(input) {
    const drafts = [
      ...peopleFromFacts(input.facts ?? {}),
      ...rolesFromStatements(input),
      ...emailsFromText(input),
    ];

    // Collapse repeats by name, keeping the richest record.
    const byName = new Map<string, PersonDraft>();
    for (const draft of drafts) {
      const key = draft.fullName.toLowerCase();
      const current = byName.get(key);
      if (!current) {
        byName.set(key, draft);
        continue;
      }
      const roleTitle = current.roleTitle ?? draft.roleTitle;
      const email = current.email ?? draft.email;
      byName.set(key, {
        ...current,
        ...draft,
        ...(roleTitle ? { roleTitle } : {}),
        ...(email ? { email } : {}),
      });
    }

    return [...byName.values()];
  },
};
