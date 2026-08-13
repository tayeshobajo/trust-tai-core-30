/**
 * People — who carries this company.
 *
 * v1 shows only what was actually read from the public website. No provider
 * enrichment is wired yet, and nothing here is ever invented.
 */

import type { FitCriterion } from "@/domain/scout-fit";

import { CriterionRow, Panel, TierTag } from "./panel";

export function PeoplePanel({ criteria }: { criteria: FitCriterion[] }) {
  const met = criteria.some((c) => c.state === "met");

  return (
    <Panel
      eyebrow="Who carries what"
      title="Decision maker"
      description="Only what has been seen on public pages. Nothing here is invented."
      aside={<TierTag tier="fact" />}
    >
      <div className="space-y-4">
        <ul className="space-y-4">
          {criteria.map((criterion) => (
            <CriterionRow key={criterion.key} criterion={criterion} />
          ))}
        </ul>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {met
            ? "A named person is on record. Verify the contact route before Comms."
            : "No verified business email is on record yet."}
        </p>
      </div>
    </Panel>
  );
}
