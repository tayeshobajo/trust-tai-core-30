/**
 * Tier and evidence display.
 *
 * The one visual rule Roadmap cannot break: a person must be able to see, at a
 * glance, whether a line is observed truth, an inference, or a human decision.
 */

import type { EvidenceRef } from "@/domain/confidence";
import type { Tier } from "@/domain/roadmap";
import { TIER_LABEL } from "@/domain/roadmap";
import { cn } from "@/lib/utils";

const TIER_CLASS: Record<Tier, string> = {
  observed: "border-border bg-secondary text-foreground",
  inferred: "border-royal/25 bg-royal/5 text-royal",
  decided: "border-success/30 bg-success/5 text-success",
};

export function TierChip({ tier, className }: { tier: Tier; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]",
        TIER_CLASS[tier],
        className,
      )}
    >
      {TIER_LABEL[tier]}
    </span>
  );
}

/** What a statement rests on. No evidence is stated plainly, never hidden. */
export function EvidenceList({ evidence }: { evidence: EvidenceRef[] }) {
  if (evidence.length === 0) {
    return (
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        No evidence recorded
      </p>
    );
  }

  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {evidence.map((ref, index) => (
        <li key={`${ref.label}-${index}`} className="text-xs text-muted-foreground">
          {ref.url ? (
            <a
              href={ref.url}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2 hover:text-foreground"
            >
              {ref.label}
            </a>
          ) : (
            ref.label
          )}
        </li>
      ))}
    </ul>
  );
}
