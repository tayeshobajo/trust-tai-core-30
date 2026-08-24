/**
 * Scout, person readiness — the specific missing step on the Person stage.
 *
 * `relationshipResearchEligible()` answers one lawful question: is this
 * company eligible for deeper relationship research? It collapses every
 * person gap into a single no. This read exists because the page must never
 * turn that internal eligibility rule back into a riddle for Tai: a strong
 * match with nobody on record is "find the founder", a known founder with no
 * route is "find a way in", and a known person whose decision role is not
 * established is "confirm who decides". Three different human actions, three
 * different states — derived from the same normalized people evidence, never
 * from the eligibility boolean.
 *
 * Pure and deterministic; nothing here fetches, sends, or mutates. The
 * eligibility law itself is unchanged — this read only names WHERE the
 * person stage stands, it never lowers the bar.
 */

import {
  bestEntryPerson,
  traceableDecisionMaker,
  type OpportunityPerson,
} from "../relationship-development";

export type PersonReadinessState =
  /** No named person is on record at all. */
  | "no_person"
  /** A person is known, but their decision-maker role is not established. */
  | "role_unestablished"
  /** A founder/decision maker is known, but no legitimate route exists. */
  | "no_route"
  /** A route exists, but the email on record is not verified. */
  | "route_unverified"
  /** A decision maker with a legitimate, usable route is on record. */
  | "ready";

export interface PersonReadiness {
  state: PersonReadinessState;
  /** The person the state speaks about, when one is on record. */
  person: OpportunityPerson | null;
}

/**
 * Where the Person stage stands, derived from the reconciled people evidence
 * (governed People records merged with discovered intel by identity).
 *
 * The subject is chosen honestly: when no decision maker is traceable, the
 * read speaks about the best-known decision maker (no route) or the
 * best-known person (role unestablished) — never about an anonymous company.
 */
export function personReadiness(people: OpportunityPerson[]): PersonReadiness {
  const entry = bestEntryPerson(people);
  if (!entry) return { state: "no_person", person: null };

  const traceable = traceableDecisionMaker(people);
  if (!traceable) {
    const decider = bestEntryPerson(people.filter((person) => person.decisionMaker));
    if (decider) return { state: "no_route", person: decider };
    return { state: "role_unestablished", person: entry };
  }

  // A found address is a route, but not a usable one: a person's confirmation
  // is what makes it safely reachable. A profile link needs no such gate.
  if (traceable.email && !traceable.emailVerified) {
    return { state: "route_unverified", person: traceable };
  }

  return { state: "ready", person: traceable };
}
