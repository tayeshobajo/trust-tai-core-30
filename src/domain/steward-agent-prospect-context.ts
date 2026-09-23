/**
 * Scout profile facts as bounded evidence for the AI teammate. Only fields
 * actually present on the exactly-linked prospect row are supplied; missing
 * facts are listed as unknown so the answer says "not recorded", never guesses.
 */

export interface ProspectFact {
  ref: string;
  label: string;
  value: string;
}

export interface ProspectContext {
  ref: string;
  name: string;
  facts: ProspectFact[];
  unknown: string[];
}

const FIELDS: { key: string; label: string }[] = [
  { key: "website_url", label: "Website" },
  { key: "industry", label: "Industry" },
  { key: "stage", label: "Scout stage" },
  { key: "status", label: "Status" },
  { key: "employee_count", label: "Employees" },
  { key: "location", label: "Location" },
  { key: "fit_score", label: "ICP fit score" },
  { key: "summary", label: "Summary" },
  { key: "notes", label: "Notes" },
];

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() ? v.trim().slice(0, 600) : null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

export function toProspectContext(row: Record<string, unknown> | null): ProspectContext | null {
  if (!row || typeof row["id"] !== "string") return null;
  const id = row["id"];
  const name = text(row["name"]) ?? "Company name not recorded";
  const facts: ProspectFact[] = [];
  const unknown: string[] = [];
  for (const f of FIELDS) {
    const value = text(row[f.key]);
    if (value) facts.push({ ref: `prospect:${id}:${f.key}`, label: f.label, value });
    else if (f.key in row) unknown.push(f.label);
  }
  return { ref: `prospect:${id}`, name, facts, unknown };
}

/** Every prospect ref an answer cites must be one that was supplied. */
export function validateProspectRefs(evidenceRefs: string[], ctx: ProspectContext | null): { ok: true } | { ok: false; because: string } {
  const allowed = new Set<string>(ctx ? [ctx.ref, ...ctx.facts.map((f) => f.ref)] : []);
  for (const ref of evidenceRefs) {
    if (ref.startsWith("prospect:") && !allowed.has(ref)) {
      return { ok: false, because: "The AI cited a company fact that isn't on record, so the result was not saved." };
    }
  }
  return { ok: true };
}
