/**
 * A proposal, as structure rather than prose.
 *
 * Scope, deliverables, pricing, assumptions and next steps. The arithmetic is
 * done here, deterministically, in the currency the person chose — nothing is
 * inferred, nothing is rounded into existence, and a total is only stated when
 * every line it rests on has a number.
 *
 * The rendered text is produced from the same structure the checks read, so
 * what a reviewer judges is exactly what the sections say.
 */

export interface ProposalLine {
  /** What is being priced. */
  label: string;
  /** Quantity. Blank means the line has no number yet. */
  quantity: string;
  /** Unit price as typed. Blank means unpriced. */
  unitPrice: string;
}

export interface ProposalSections {
  currency: string;
  scope: string;
  deliverables: string[];
  lines: ProposalLine[];
  assumptions: string[];
  nextSteps: string[];
  /** Optional discount, in the same currency. Never invented. */
  discount: string;
}

export const EMPTY_PROPOSAL: ProposalSections = {
  currency: "GBP",
  scope: "",
  deliverables: [],
  lines: [],
  assumptions: [],
  nextSteps: [],
  discount: "",
};

export const PROPOSAL_CURRENCIES = ["GBP", "USD", "EUR", "NGN"] as const;

/** Minor units per currency. Money is added as integers, never as floats. */
const MINOR: Record<string, number> = { GBP: 100, USD: 100, EUR: 100, NGN: 100 };

export function minorUnits(currency: string): number {
  return MINOR[currency] ?? 100;
}

/** A typed amount as an exact integer of minor units, or null when unusable. */
export function parseAmount(value: string, currency: string): number | null {
  const text = value.replace(/[\s,]/g, "").trim();
  if (!text) return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) return null;
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace("-", "").split(".");
  const scale = minorUnits(currency);
  const minor =
    Number(whole) * scale + Number((fraction + "00").slice(0, String(scale).length - 1));
  return negative ? -minor : minor;
}

export function parseQuantity(value: string): number | null {
  const text = value.replace(/[\s,]/g, "").trim();
  if (!text) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const quantity = Number(text);
  return Number.isFinite(quantity) ? quantity : null;
}

export function formatAmount(minor: number, currency: string): string {
  const scale = minorUnits(currency);
  const sign = minor < 0 ? "-" : "";
  const absolute = Math.abs(minor);
  const whole = Math.floor(absolute / scale);
  const rest = String(absolute % scale).padStart(String(scale).length - 1, "0");
  return `${sign}${currency} ${whole.toLocaleString("en-GB")}.${rest}`;
}

export interface LineTotal {
  line: ProposalLine;
  /** Exact minor units, or null when the line is not fully priced. */
  minor: number | null;
  note: string | null;
}

export interface ProposalArithmetic {
  currency: string;
  lines: LineTotal[];
  /** Only set when every line has a number. Unknown is never treated as zero. */
  subtotalMinor: number | null;
  discountMinor: number | null;
  totalMinor: number | null;
  /** Lines that could not be priced, named so nobody has to guess. */
  unpriced: string[];
}

/** Deterministic: the same sections always produce the same numbers. */
export function priceProposal(sections: ProposalSections): ProposalArithmetic {
  const currency = sections.currency;
  const lines: LineTotal[] = sections.lines.map((line) => {
    const quantity = parseQuantity(line.quantity);
    const unit = parseAmount(line.unitPrice, currency);
    if (quantity === null || unit === null) {
      return {
        line,
        minor: null,
        note:
          quantity === null && unit === null
            ? "No quantity or price yet."
            : quantity === null
              ? "No quantity yet."
              : "No price yet.",
      };
    }
    return { line, minor: Math.round(quantity * unit), note: null };
  });

  const unpriced = lines.filter((entry) => entry.minor === null).map((entry) => entry.line.label);
  const complete = lines.length > 0 && unpriced.length === 0;
  const subtotalMinor = complete
    ? lines.reduce((sum, entry) => sum + (entry.minor ?? 0), 0)
    : null;
  const discountMinor = sections.discount.trim()
    ? parseAmount(sections.discount, currency)
    : null;
  const totalMinor =
    subtotalMinor === null ? null : subtotalMinor - (discountMinor === null ? 0 : discountMinor);

  return { currency, lines, subtotalMinor, discountMinor, totalMinor, unpriced };
}

export interface ProposalIssue {
  code:
    | "scope_missing"
    | "no_deliverables"
    | "unpriced_line"
    | "bad_discount"
    | "discount_exceeds"
    | "no_next_steps"
    | "duplicate_line";
  message: string;
  blocking: boolean;
}

/** Consistency checks. They describe; they never fix anything silently. */
export function checkProposal(sections: ProposalSections): ProposalIssue[] {
  const maths = priceProposal(sections);
  const issues: ProposalIssue[] = [];

  if (!sections.scope.trim()) {
    issues.push({
      code: "scope_missing",
      message: "The scope is empty, so the price is not attached to anything.",
      blocking: true,
    });
  }
  if (sections.deliverables.filter((item) => item.trim()).length === 0) {
    issues.push({
      code: "no_deliverables",
      message: "No deliverables are listed.",
      blocking: true,
    });
  }
  for (const label of maths.unpriced) {
    issues.push({
      code: "unpriced_line",
      message: `"${label || "Unnamed line"}" has no usable number, so no total can be stated.`,
      blocking: true,
    });
  }
  if (sections.discount.trim() && maths.discountMinor === null) {
    issues.push({
      code: "bad_discount",
      message: "The discount is not a readable amount.",
      blocking: true,
    });
  }
  if (
    maths.subtotalMinor !== null &&
    maths.discountMinor !== null &&
    maths.discountMinor > maths.subtotalMinor
  ) {
    issues.push({
      code: "discount_exceeds",
      message: "The discount is larger than the subtotal.",
      blocking: true,
    });
  }
  const labels = sections.lines.map((line) => line.label.trim().toLowerCase()).filter(Boolean);
  if (new Set(labels).size !== labels.length) {
    issues.push({
      code: "duplicate_line",
      message: "Two priced lines share a name; the total may double-count.",
      blocking: false,
    });
  }
  if (sections.nextSteps.filter((item) => item.trim()).length === 0) {
    issues.push({
      code: "no_next_steps",
      message: "No next steps are stated, so nobody knows what happens after they read it.",
      blocking: false,
    });
  }
  return issues;
}

function bullets(items: string[]): string {
  return items
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => `- ${item}`)
    .join("\n");
}

/**
 * The exact words a reviewer judges, built from the sections.
 *
 * A total appears only when the arithmetic produced one; otherwise the text
 * says which lines are still unpriced rather than implying a figure.
 */
export function renderProposal(sections: ProposalSections): string {
  const maths = priceProposal(sections);
  const parts: string[] = [];

  if (sections.scope.trim()) parts.push(`Scope\n${sections.scope.trim()}`);
  const deliverables = bullets(sections.deliverables);
  if (deliverables) parts.push(`Deliverables\n${deliverables}`);

  if (sections.lines.length > 0) {
    const rows = maths.lines
      .map((entry) => {
        const name = entry.line.label.trim() || "Unnamed line";
        if (entry.minor === null) return `- ${name}: price to be confirmed (${entry.note})`;
        return `- ${name}: ${entry.line.quantity.trim()} × ${formatAmount(
          parseAmount(entry.line.unitPrice, maths.currency) ?? 0,
          maths.currency,
        )} = ${formatAmount(entry.minor, maths.currency)}`;
      })
      .join("\n");
    const tail: string[] = [];
    if (maths.subtotalMinor !== null) {
      tail.push(`Subtotal: ${formatAmount(maths.subtotalMinor, maths.currency)}`);
    }
    if (maths.discountMinor !== null) {
      tail.push(`Discount: ${formatAmount(maths.discountMinor, maths.currency)}`);
    }
    if (maths.totalMinor !== null) {
      tail.push(`Total: ${formatAmount(maths.totalMinor, maths.currency)}`);
    } else {
      tail.push("Total: not stated — some lines are still unpriced.");
    }
    parts.push(`Pricing\n${rows}\n${tail.join("\n")}`);
  }

  const assumptions = bullets(sections.assumptions);
  if (assumptions) parts.push(`Assumptions\n${assumptions}`);
  const nextSteps = bullets(sections.nextSteps);
  if (nextSteps) parts.push(`Next steps\n${nextSteps}`);

  return parts.join("\n\n");
}
