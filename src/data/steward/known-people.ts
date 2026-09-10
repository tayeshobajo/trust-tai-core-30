/**
 * Who this workspace already knows, resolved before Steward says it knows nobody.
 *
 * Steward used to read only its own `steward_role_memory` table, so a person
 * recorded anywhere else in Trust Tai — a workspace member, a canonical contact
 * — was invisible to interpretation. That is a second people registry beside
 * the canonical one, and it makes Steward claim absence for people the system
 * has already met.
 *
 * This is the deterministic merge. Pure, no I/O, no invention:
 *
 *   1. Steward role memory first. It is human-recorded and outranks anything
 *      derived from a directory row.
 *   2. Then workspace members, who are known humans by definition.
 *   3. Then canonical contacts.
 *
 * The same person read twice is one person: matched on email when both sides
 * carry one, otherwise on an exact normalised name. Nothing is matched on weak
 * similarity, and no person is created from an email address alone.
 */

export type KnownPersonSource = "role_memory" | "workspace_member" | "contact";

export interface KnownPersonInput {
  name: string;
  email?: string | null;
  /** Role, title, pod, responsibilities — whatever the source actually recorded. */
  title?: string | null;
}

export interface KnownPerson {
  name: string;
  title?: string;
  source: KnownPersonSource;
}

const MAX_PEOPLE = 100;

function normalName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function clean(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

/**
 * One list of the people this workspace knows, strongest source first.
 *
 * Order is deterministic: role memory in the order given, then members, then
 * contacts. A later source never overwrites an earlier one; it only fills in a
 * title the earlier source left empty.
 */
export function resolveKnownPeople(input: {
  roleMemory: KnownPersonInput[];
  members: KnownPersonInput[];
  contacts: KnownPersonInput[];
}): KnownPerson[] {
  const resolved: KnownPerson[] = [];
  const byEmail = new Map<string, number>();
  const byName = new Map<string, number>();

  const lanes: { source: KnownPersonSource; rows: KnownPersonInput[] }[] = [
    { source: "role_memory", rows: input.roleMemory },
    { source: "workspace_member", rows: input.members },
    { source: "contact", rows: input.contacts },
  ];

  for (const lane of lanes) {
    for (const row of lane.rows) {
      const name = clean(row.name);
      /* A person without a name is not a person Steward can name. */
      if (!name) continue;

      const email = normalEmail(row.email);
      const key = normalName(name);
      const existingIndex = (email ? byEmail.get(email) : undefined) ?? byName.get(key);

      if (existingIndex !== undefined) {
        const existing = resolved[existingIndex];
        const title = clean(row.title);
        /* Fill a gap; never overwrite what a stronger source already said. */
        if (existing && !existing.title && title) existing.title = title;
        if (email && !byEmail.has(email)) byEmail.set(email, existingIndex);
        continue;
      }

      if (resolved.length >= MAX_PEOPLE) continue;

      const title = clean(row.title);
      resolved.push({ name, ...(title ? { title } : {}), source: lane.source });
      const index = resolved.length - 1;
      byName.set(key, index);
      if (email) byEmail.set(email, index);
    }
  }

  return resolved;
}

/** How the read is described, honestly, from where the people actually came. */
export function describeKnownPeople(people: KnownPerson[]): string {
  if (people.length === 0) return "Read from this workspace's open commitments.";
  const sources = new Set(people.map((person) => person.source));
  const named: string[] = [];
  if (sources.has("role_memory")) named.push("recorded role memory");
  if (sources.has("workspace_member")) named.push("workspace members");
  if (sources.has("contact")) named.push("canonical contacts");
  return `Read from this workspace's open commitments and known people (${named.join(", ")}).`;
}
