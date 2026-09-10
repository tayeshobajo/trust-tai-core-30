/**
 * The Commercial surface of a client page.
 *
 * Everything a person entered about what this company is worth, and the
 * proposal lineage behind it, in one place. The read comes first; the existing
 * form, with its existing validation and its single write path, is revealed
 * only when a person asks to edit. Nothing here is inferred and nothing is
 * derived from a message, a document or a model.
 */

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface CommercialTabLines {
  /** `Run · $3,500/mo`, already composed by the client book. */
  headline: string;
  review: string;
  renewal: string;
  provenance: string;
}

const CARD = "tt-surface rounded-2xl";

export function CommercialTab({
  lines,
  form,
  proposals,
}: {
  lines: CommercialTabLines;
  /** The existing commercial form, revealed only when a person asks to edit. */
  form: ReactNode;
  /** Proposal and retainer lineage, owned by the roadmap node it sits on. */
  proposals: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="space-y-6 lg:space-y-8">
      <section aria-labelledby="commercial-state" className={CARD}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-6 py-5">
          <div className="min-w-0">
            <h2
              id="commercial-state"
              className="text-lg font-semibold tracking-tight text-foreground"
            >
              Commercial state
            </h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Entered by a person. Nothing here is inferred.
            </p>
          </div>
          <button
            type="button"
            aria-expanded={editing}
            aria-controls="commercial-state-form"
            onClick={() => setEditing((open) => !open)}
            className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-royal"
          >
            {editing ? "Close" : "Update commercial state"}
            <ChevronDown
              className={cn("size-3.5 transition-transform", editing && "rotate-180")}
              aria-hidden
            />
          </button>
        </div>

        <div className="px-6 py-5">
          <p className="text-[15px] font-medium text-foreground">{lines.headline}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {lines.review} · {lines.renewal}
          </p>
          <p className="mt-2 text-[12px] text-muted-foreground">{lines.provenance}</p>
        </div>

        <div
          id="commercial-state-form"
          hidden={!editing}
          className="border-t border-border px-6 py-5"
        >
          {editing ? form : null}
        </div>
      </section>

      {proposals}
    </div>
  );
}
