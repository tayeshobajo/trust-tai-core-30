/**
 * Scout — who to approach, and the honest reason why.
 *
 * Deterministic. A person rises because of their role's relationship to a
 * website/technology decision, the quality of the evidence behind the record,
 * and whether a real contact route exists — never because a provider said so
 * loudly. Human-confirmed records always outrank provider assertions.
 */

import {
  DECIDING_SENIORITIES,
  EMAIL_STATUS_LABEL,
  type Person,
  type Seniority,
} from "@/domain/people";
import type { PersonPlan, PersonRecommendation } from "@/domain/scout-intel";

/** Relevance of each seniority to a Trust Tai engagement decision. */
const SENIORITY_WEIGHT: Record<Seniority, number> = {
  founder: 40,
  owner: 40,
  exec: 32,
  marketing: 26,
  operations: 18,
  other: 8,
};

const SENIORITY_WHY: Record<Seniority, string> = {
  founder: "Founders normally own this decision outright in a company this size.",
  owner: "Owners normally own this decision outright in a company this size.",
  exec: "Executives can authorise a web or growth engagement.",
  marketing: "Marketing usually holds the website and its performance.",
  operations: "Operations feels the friction, but rarely signs for it.",
  other: "The role's relationship to this decision is unclear.",
};

function routeFor(person: Person): {
  route: PersonRecommendation["route"];
  score: number;
  note: string;
} {
  if (person.email && person.emailStatus === "verified") {
    return { route: "verified_email", score: 30, note: "Verified business email on record." };
  }
  if (person.email && (person.emailStatus === "found" || person.emailStatus === "risky")) {
    return {
      route: "unverified_email",
      score: 16,
      note: `${EMAIL_STATUS_LABEL[person.emailStatus]} — verify before sending.`,
    };
  }
  if (person.linkedinUrl) {
    return { route: "linkedin", score: 10, note: "Profile link only. No email route yet." };
  }
  return { route: "none", score: 0, note: "No contact route has been found for this person." };
}

function evidenceScore(person: Person): { score: number; why: string } {
  switch (person.confidence) {
    case "human_confirmed":
      return { score: 30, why: "Confirmed by a Trust Tai member." };
    case "observed":
      return { score: 24, why: "Read from a public page on the company's own site." };
    case "asserted_by_provider":
      return { score: 14, why: "Asserted by an enrichment provider, not yet confirmed." };
    default:
      return { score: 8, why: "Inferred by Scout. Treat the role as unconfirmed." };
  }
}

export function recommendPerson(person: Person): PersonRecommendation {
  const route = routeFor(person);
  const evidence = evidenceScore(person);
  const seniority = SENIORITY_WEIGHT[person.seniority];
  const weight = Math.min(100, seniority + evidence.score + route.score);
  return {
    personId: person.id,
    fullName: person.fullName,
    ...(person.roleTitle ? { roleTitle: person.roleTitle } : {}),
    weight,
    why: `${SENIORITY_WHY[person.seniority]} ${evidence.why}`,
    route: route.route,
    routeNote: route.note,
  };
}

/**
 * Rank the people on record. Ties break toward the better-evidenced record, so
 * a confirmed person never sits behind an equally-scored provider guess.
 */
export function buildPersonPlan(people: Person[]): PersonPlan {
  if (people.length === 0) {
    return {
      primary: null,
      supporting: [],
      gap: "No person has been found yet. Outreach cannot be prepared without one.",
    };
  }

  const ranked = people
    .map((person) => ({ person, rec: recommendPerson(person) }))
    .sort((a, b) => {
      if (b.rec.weight !== a.rec.weight) return b.rec.weight - a.rec.weight;
      const confirmed = (p: Person) => (p.confidence === "human_confirmed" ? 1 : 0);
      return confirmed(b.person) - confirmed(a.person);
    });

  const primary = ranked[0]!.rec;
  const supporting = ranked.slice(1, 4).map((entry) => entry.rec);

  const decider = ranked.find((entry) =>
    DECIDING_SENIORITIES.includes(entry.person.seniority),
  );
  let gap: string | null = null;
  if (!decider) {
    gap = "Nobody on record clearly decides on a web engagement. Find a founder, owner, or executive.";
  } else if (primary.route === "none") {
    gap = `No contact route exists for ${primary.fullName}. Find an email or a profile link first.`;
  } else if (primary.route === "unverified_email") {
    gap = `${primary.fullName}'s email has not been verified. Verify it before Comms sends anything.`;
  }

  return { primary, supporting, gap };
}
