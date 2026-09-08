/**
 * Research coverage, how much of the public website has actually been read,
 * and which page kinds were never reached. Absence is not a gap.
 */

import type { ResearchCoverage } from "@/domain/prospect-modules";
import { cn } from "@/lib/utils";

import { RailCard } from "./panel";

function readDate(at: string): string | null {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function CoverageCard({ coverage }: { coverage: ResearchCoverage }) {
  const headline =
    coverage.state === "read"
      ? [
          coverage.checked.length > 0
            ? `${coverage.reached} of ${coverage.checked.length} page kinds read`
            : null,
          `${coverage.pages} ${coverage.pages === 1 ? "page" : "pages"} read`,
          `${coverage.facts} ${coverage.facts === 1 ? "fact" : "facts"} held`,
        ]
          .filter(Boolean)
          .join(" · ")
      : coverage.state === "unreadable"
        ? "The website could not be read."
        : "Not researched yet.";
  const lastRead = coverage.lastReadAt ? readDate(coverage.lastReadAt) : null;

  return (
    <RailCard title="Research coverage">
      <div className="space-y-3">
        <p className="text-sm text-foreground">{headline}</p>

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
        {lastRead && coverage.state !== "never_read" ? (
          <p className="text-[13px] text-muted-foreground">Last read {lastRead}.</p>
        ) : null}
      </div>
    </RailCard>
  );
}
