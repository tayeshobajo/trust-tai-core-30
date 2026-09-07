/**
 * Research coverage, how much of the public website has actually been read,
 * and which page kinds were never reached. Absence is not a gap.
 */

import type { ResearchCoverage } from "@/domain/prospect-modules";
import { cn } from "@/lib/utils";

import { RailCard } from "./panel";

export function CoverageCard({ coverage }: { coverage: ResearchCoverage }) {
  return (
    <RailCard title="Research coverage">
      <div className="space-y-3">
        <p className="text-sm text-foreground">
          {coverage.checked.length === 0
            ? `${coverage.pages} ${coverage.pages === 1 ? "page" : "pages"} read`
            : `${coverage.checked.filter((kind) => kind.reached).length} of ${coverage.checked.length} page kinds read · ${coverage.pages} ${coverage.pages === 1 ? "page" : "pages"} read`}
        </p>

        {coverage.checked.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {coverage.checked.map((kind) => (
              <li
                key={kind.key}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]",
                  kind.reached
                    ? "border-border bg-secondary text-foreground"
                    : "border-dashed border-border text-muted-foreground",
                )}
              >
                {kind.label}
                <span className="opacity-60">{kind.reached ? "read" : "unread"}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-[13px] text-muted-foreground">{coverage.note}</p>
      </div>
    </RailCard>
  );
}
