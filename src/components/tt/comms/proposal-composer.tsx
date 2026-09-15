/**
 * Writing a proposal as sections rather than prose.
 *
 * Scope, deliverables, pricing, assumptions, next steps. The numbers are
 * computed here from what was typed — never suggested, never filled in — and
 * the text underneath is exactly what a reviewer will judge.
 */

import { TTButton } from "@/components/tt/primitives";
import {
  checkProposal,
  formatAmount,
  priceProposal,
  PROPOSAL_CURRENCIES,
  renderProposal,
  type ProposalSections,
} from "@/domain/comms-proposal";
import { cn } from "@/lib/utils";

const field =
  "w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Lines({
  label,
  items,
  placeholder,
  onChange,
}: {
  label: string;
  items: string[];
  placeholder: string;
  onChange: (items: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      {items.map((item, index) => (
        <div key={index} className="flex gap-2">
          <input
            className={field}
            value={item}
            placeholder={placeholder}
            onChange={(event) => {
              const next = [...items];
              next[index] = event.target.value;
              onChange(next);
            }}
          />
          <TTButton
            type="button"
            variant="quiet"
            size="sm"
            onClick={() => onChange(items.filter((_, at) => at !== index))}
          >
            Remove
          </TTButton>
        </div>
      ))}
      <TTButton type="button" variant="quiet" size="sm" onClick={() => onChange([...items, ""])}>
        Add {label.toLowerCase().replace(/s$/, "")}
      </TTButton>
    </div>
  );
}

export function ProposalComposer({
  sections,
  onChange,
}: {
  sections: ProposalSections;
  onChange: (sections: ProposalSections) => void;
}) {
  const maths = priceProposal(sections);
  const issues = checkProposal(sections);
  const text = renderProposal(sections);

  const set = (patch: Partial<ProposalSections>) => onChange({ ...sections, ...patch });

  return (
    <div className="space-y-5">
      <label className="block space-y-1.5 text-sm">
        <span className="text-muted-foreground">Scope</span>
        <textarea
          className={cn(field, "min-h-24 leading-relaxed")}
          value={sections.scope}
          onChange={(event) => set({ scope: event.target.value })}
          placeholder="What this work covers, in your own words."
        />
      </label>

      <Lines
        label="Deliverables"
        items={sections.deliverables}
        placeholder="What they receive."
        onChange={(deliverables) => set({ deliverables })}
      />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">Pricing</span>
          <label className="text-xs text-muted-foreground">
            Currency{" "}
            <select
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              value={sections.currency}
              onChange={(event) => set({ currency: event.target.value })}
            >
              {PROPOSAL_CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </label>
        </div>
        {sections.lines.map((line, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_90px_120px_auto]">
            <input
              className={field}
              value={line.label}
              placeholder="What is priced"
              onChange={(event) => {
                const lines = [...sections.lines];
                lines[index] = { ...line, label: event.target.value };
                set({ lines });
              }}
            />
            <input
              className={field}
              value={line.quantity}
              inputMode="decimal"
              placeholder="Qty"
              onChange={(event) => {
                const lines = [...sections.lines];
                lines[index] = { ...line, quantity: event.target.value };
                set({ lines });
              }}
            />
            <input
              className={field}
              value={line.unitPrice}
              inputMode="decimal"
              placeholder="Unit price"
              onChange={(event) => {
                const lines = [...sections.lines];
                lines[index] = { ...line, unitPrice: event.target.value };
                set({ lines });
              }}
            />
            <TTButton
              type="button"
              variant="quiet"
              size="sm"
              onClick={() => set({ lines: sections.lines.filter((_, at) => at !== index) })}
            >
              Remove
            </TTButton>
          </div>
        ))}
        <TTButton
          type="button"
          variant="quiet"
          size="sm"
          onClick={() =>
            set({ lines: [...sections.lines, { label: "", quantity: "", unitPrice: "" }] })
          }
        >
          Add priced line
        </TTButton>
        <label className="block space-y-1.5 text-sm">
          <span className="text-muted-foreground">Discount (optional)</span>
          <input
            className={cn(field, "max-w-[180px]")}
            value={sections.discount}
            inputMode="decimal"
            placeholder="0.00"
            onChange={(event) => set({ discount: event.target.value })}
          />
        </label>
        <p className="text-[13px] text-foreground">
          {maths.totalMinor === null
            ? "No total yet. Every line needs a quantity and a price before one can be stated."
            : `Total ${formatAmount(maths.totalMinor, maths.currency)}`}
        </p>
      </div>

      <Lines
        label="Assumptions"
        items={sections.assumptions}
        placeholder="What this price depends on."
        onChange={(assumptions) => set({ assumptions })}
      />
      <Lines
        label="Next steps"
        items={sections.nextSteps}
        placeholder="What happens after they read it."
        onChange={(nextSteps) => set({ nextSteps })}
      />

      {issues.length > 0 ? (
        <ul className="space-y-1 rounded-lg bg-secondary p-3 text-[13px]">
          {issues.map((issue) => (
            <li
              key={issue.code + issue.message}
              className={issue.blocking ? "text-destructive" : "text-muted-foreground"}
            >
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="space-y-1.5">
        <span className="text-sm text-muted-foreground">What will be reviewed, word for word</span>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-card p-3 text-sm leading-relaxed text-foreground">
          {text || "Nothing yet."}
        </pre>
      </div>
    </div>
  );
}
