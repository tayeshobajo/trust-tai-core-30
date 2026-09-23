/**
 * Scout People as bounded evidence for the internal AI teammate.
 *
 * Only saved people for the task's linked Scout prospect are ever supplied.
 * Every person the answer names must be one of them, otherwise the run fails.
 */

export interface AgentPersonRow {
  id: string;
  full_name: string;
  title: string | null;
  company_name: string;
  email_status: "verified" | "found_unverified" | "not_found" | "not_checked";
  work_email: string | null;
  buying_role: string;
  why_this_person: string;
}

export interface AgentPersonEvidence {
  ref: string;
  name: string;
  title: string;
  company: string;
  email: string;
  buyingRole: string;
  why: string;
}

export const MAX_AGENT_PEOPLE = 4;

const SCOUT_CORRELATION = /^scout:prospect:([0-9a-f-]{36}):/i;

/** Exact linkage only: canonical source fields, then the exact Scout correlation key. */
export function linkedProspectId(task: {
  sourceApp?: string;
  sourceEntityType?: string;
  sourceEntityId?: string;
  correlationId?: string;
}): string | null {
  if (task.sourceApp === "scout" && task.sourceEntityType === "prospect" && task.sourceEntityId) {
    return task.sourceEntityId;
  }
  const match = task.correlationId ? SCOUT_CORRELATION.exec(task.correlationId) : null;
  return match?.[1] ?? null;
}

function emailLabel(row: AgentPersonRow): string {
  if (row.email_status === "verified" && row.work_email) return `${row.work_email} (verified)`;
  if (row.email_status === "found_unverified" && row.work_email)
    return `${row.work_email} (not verified)`;
  return "No work email on file";
}

export function toPeopleEvidence(rows: AgentPersonRow[]): AgentPersonEvidence[] {
  return rows.slice(0, MAX_AGENT_PEOPLE).map((row) => ({
    ref: `person:${row.id}`,
    name: row.full_name.trim(),
    title: row.title?.trim() || "Title not recorded",
    company: row.company_name,
    email: emailLabel(row),
    buyingRole: row.buying_role,
    why: row.why_this_person,
  }));
}

/**
 * Validates that every cited person ref is supplied, and that any supplied
 * person's name appearing in the artifact is cited. Names outside the set are
 * detected via the model's declared `people_named` list.
 */
export function validatePeopleUse(input: {
  artifact: string;
  evidenceRefs: string[];
  peopleNamed: string[];
  people: AgentPersonEvidence[];
}): { ok: true } | { ok: false; because: string } {
  const known = new Map(input.people.map((p) => [p.name.toLowerCase(), p]));
  for (const name of input.peopleNamed) {
    const person = known.get(name.trim().toLowerCase());
    if (!person) {
      return { ok: false, because: `The answer named “${name}”, who is not a saved Scout person.` };
    }
    if (!input.evidenceRefs.includes(person.ref)) {
      return { ok: false, because: `The answer named ${person.name} without citing the saved record.` };
    }
  }
  const refs = new Set(input.people.map((p) => p.ref));
  for (const ref of input.evidenceRefs) {
    if (ref.startsWith("person:") && !refs.has(ref)) {
      return { ok: false, because: "The answer cited a person record that was not supplied." };
    }
  }
  for (const person of input.people) {
    if (input.artifact.includes(person.name) && !input.evidenceRefs.includes(person.ref)) {
      return { ok: false, because: `The answer named ${person.name} without citing the saved record.` };
    }
  }
  return { ok: true };
}
