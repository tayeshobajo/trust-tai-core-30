/**
 * The structured source a proposal's words were rendered from.
 *
 * A proposal is written as sections. The text a reviewer judges is rendered
 * from those sections — deterministically, on the server — and the exact
 * sections are kept with the version, so an audit can rebuild the reviewed
 * words from the same structure rather than taking a browser's word for them.
 *
 * Three rules hold here:
 *   1. the structure is schema-versioned, so an old row is read as what it is,
 *   2. the structure is validated for size, shape, numbers and currency
 *      before anything is stored,
 *   3. the rendered text is derived, never supplied. Text that does not match
 *      the sections is refused rather than quietly stored beside them.
 */

import {
  EMPTY_PROPOSAL,
  PROPOSAL_CURRENCIES,
  parseAmount,
  parseQuantity,
  renderProposal,
  type ProposalLine,
  type ProposalSections,
} from "./comms-proposal";

export const PROPOSAL_SCHEMA_VERSION = 1;

export interface ProposalStructuredSource {
  schemaVersion: number;
  kind: "proposal";
  sections: ProposalSections;
  /** Exactly what `renderProposal` produced from these sections. */
  renderedText: string;
}

/* Bounds. They exist so a single paste cannot become an unbounded row. */
const LIMIT = {
  scope: 8_000,
  item: 1_000,
  items: 60,
  lines: 80,
  label: 300,
  number: 24,
  total: 120_000,
} as const;

export type ProposalValidation =
  { ok: true; sections: ProposalSections } | { ok: false; error: string };

function textAt(value: unknown, max: number, what: string): string | { error: string } {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return { error: `${what} is not text.` };
  if (value.length > max) return { error: `${what} is longer than this can store.` };
  return value;
}

function listAt(value: unknown, what: string): string[] | { error: string } {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return { error: `${what} is not a list.` };
  if (value.length > LIMIT.items) return { error: `${what} has too many entries.` };
  const out: string[] = [];
  for (const entry of value) {
    const text = textAt(entry, LIMIT.item, `An entry in ${what.toLowerCase()}`);
    if (typeof text !== "string") return text;
    out.push(text);
  }
  return out;
}

function numberText(value: unknown, what: string): string | { error: string } {
  const text = textAt(value, LIMIT.number, what);
  if (typeof text !== "string") return text;
  return text.trim();
}

/**
 * Validate sections as they arrived from a browser. Nothing is coerced into
 * shape: a bad number is an error, not a zero.
 */
export function validateProposalSections(value: unknown): ProposalValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "The proposal sections are missing or malformed." };
  }
  const raw = value as Record<string, unknown>;

  const currency = typeof raw["currency"] === "string" ? raw["currency"] : "";
  if (!PROPOSAL_CURRENCIES.some((candidate) => candidate === currency)) {
    return { ok: false, error: "That currency is not one this workspace can price in." };
  }

  const scope = textAt(raw["scope"], LIMIT.scope, "The scope");
  if (typeof scope !== "string") return { ok: false, error: scope.error };

  const deliverables = listAt(raw["deliverables"], "Deliverables");
  if (!Array.isArray(deliverables)) return { ok: false, error: deliverables.error };
  const assumptions = listAt(raw["assumptions"], "Assumptions");
  if (!Array.isArray(assumptions)) return { ok: false, error: assumptions.error };
  const nextSteps = listAt(raw["nextSteps"], "Next steps");
  if (!Array.isArray(nextSteps)) return { ok: false, error: nextSteps.error };

  const rawLines = raw["lines"];
  if (rawLines !== undefined && rawLines !== null && !Array.isArray(rawLines)) {
    return { ok: false, error: "The priced lines are not a list." };
  }
  const lineList = Array.isArray(rawLines) ? rawLines : [];
  if (lineList.length > LIMIT.lines) {
    return { ok: false, error: "There are too many priced lines to store." };
  }
  const lines: ProposalLine[] = [];
  for (const entry of lineList) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, error: "A priced line is malformed." };
    }
    const row = entry as Record<string, unknown>;
    const label = textAt(row["label"], LIMIT.label, "A priced line's name");
    if (typeof label !== "string") return { ok: false, error: label.error };
    const quantity = numberText(row["quantity"], "A quantity");
    if (typeof quantity !== "string") return { ok: false, error: quantity.error };
    const unitPrice = numberText(row["unitPrice"], "A unit price");
    if (typeof unitPrice !== "string") return { ok: false, error: unitPrice.error };
    if (quantity && parseQuantity(quantity) === null) {
      return { ok: false, error: `"${quantity}" is not a quantity this can use.` };
    }
    if (unitPrice && parseAmount(unitPrice, currency) === null) {
      return { ok: false, error: `"${unitPrice}" is not an amount this can use.` };
    }
    lines.push({ label, quantity, unitPrice });
  }

  const discount = numberText(raw["discount"], "The discount");
  if (typeof discount !== "string") return { ok: false, error: discount.error };
  if (discount && parseAmount(discount, currency) === null) {
    return { ok: false, error: "The discount is not an amount this can use." };
  }

  const sections: ProposalSections = {
    currency,
    scope,
    deliverables,
    lines,
    assumptions,
    nextSteps,
    discount,
  };

  if (JSON.stringify(sections).length > LIMIT.total) {
    return { ok: false, error: "This proposal is too large to store as structure." };
  }
  return { ok: true, sections };
}

/** The canonical stored source: the sections, plus the text they render to. */
export function structuredProposalSource(sections: ProposalSections): ProposalStructuredSource {
  return {
    schemaVersion: PROPOSAL_SCHEMA_VERSION,
    kind: "proposal",
    sections,
    renderedText: renderProposal(sections),
  };
}

/**
 * Read a stored structure back. An unknown schema version, or a shape that no
 * longer validates, reads as "not reconstructable" rather than as a guess.
 */
export function readStructuredSource(value: unknown): ProposalStructuredSource | null {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (row["kind"] !== "proposal") return null;
  if (row["schemaVersion"] !== PROPOSAL_SCHEMA_VERSION) return null;
  const checked = validateProposalSections(row["sections"]);
  if (!checked.ok) return null;
  const rendered = renderProposal(checked.sections);
  if (typeof row["renderedText"] === "string" && row["renderedText"] !== rendered) {
    /* The stored text and the stored sections disagree. Neither is trusted to
       stand for the other, so this reads as not reconstructable. */
    return null;
  }
  return {
    schemaVersion: PROPOSAL_SCHEMA_VERSION,
    kind: "proposal",
    sections: checked.sections,
    renderedText: rendered,
  };
}

/** Whether a person has actually written anything, headings aside. */
export function proposalHasContent(sections: ProposalSections): boolean {
  return (
    sections.scope.trim().length > 0 ||
    sections.deliverables.some((item) => item.trim()) ||
    sections.assumptions.some((item) => item.trim()) ||
    sections.nextSteps.some((item) => item.trim()) ||
    sections.discount.trim().length > 0 ||
    sections.lines.some(
      (line) => line.label.trim() || line.quantity.trim() || line.unitPrice.trim(),
    )
  );
}

export function emptyProposal(): ProposalSections {
  return { ...EMPTY_PROPOSAL, deliverables: [], lines: [], assumptions: [], nextSteps: [] };
}
