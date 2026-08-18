import { Bot } from "lucide-react";
import type { ReactNode } from "react";

import type { StewardAgentRead, StewardTask } from "@/domain/steward-accountability";
import type { TeamGlance } from "@/data/steward/accountability";

function RailCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="tt-surface p-5">
      <p className="tt-eyebrow">{title}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Line({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-border/60 py-2 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-mono text-sm text-foreground">{value}</span>
    </div>
  );
}

/** Small, honest counts. No charts, no trends, nothing derived from nothing. */
export function TeamRail({
  glance,
  unownedCount,
  overdueTasks,
  agents,
  onReviewUnowned,
  onReviewOverdue,
  stacked = false,
}: {
  glance: TeamGlance;
  unownedCount: number;
  overdueTasks: StewardTask[];
  agents: StewardAgentRead | undefined;
  onReviewUnowned: () => void;
  onReviewOverdue: () => void;
  /** True when the rail sits under the checklist on narrow screens. */
  stacked?: boolean;
}) {
  const approvals = agents?.agents.reduce((total, agent) => total + agent.awaitingApproval.length, 0) ?? 0;
  const needsTai =
    unownedCount > 0 || overdueTasks.length > 0 || approvals > 0;

  return (
    <aside
      className={
        stacked
          ? "grid gap-4 sm:grid-cols-2 lg:sticky lg:top-6 lg:grid-cols-1"
          : "space-y-4"
      }
    >
      <RailCard title="Team at a glance">
        <Line label="Team members" value={glance.teamMembers} />
        <Line label="Active tasks" value={glance.activeTasks} />
        <Line label="Overdue" value={glance.overdue} />
        <Line label="Blocked" value={glance.blocked} />
        <Line label="No owner" value={glance.noOwner} />
      </RailCard>

      <RailCard title="Needs you">
        {needsTai ? (
          <ul className="space-y-3">
            {unownedCount > 0 ? (
              <li>
                <button
                  type="button"
                  onClick={onReviewUnowned}
                  className="text-left text-sm text-foreground hover:underline"
                >
                  {unownedCount} commitment{unownedCount === 1 ? "" : "s"} need an owner
                </button>
              </li>
            ) : null}
            {overdueTasks.length > 0 ? (
              <li>
                <button
                  type="button"
                  onClick={onReviewOverdue}
                  className="text-left text-sm text-foreground hover:underline"
                >
                  {overdueTasks.length} promise{overdueTasks.length === 1 ? "" : "s"} past their date
                </button>
              </li>
            ) : null}
            {approvals > 0 ? (
              <li className="text-sm text-foreground">
                {approvals} agent task{approvals === 1 ? "" : "s"} waiting on approval
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing is waiting on you right now.</p>
        )}
      </RailCard>

      {agents && agents.agents.length > 0 ? (
        <RailCard title="Agents">
          <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Bot className="size-4" /> Paperclip workforce
          </p>
          <Line label="Registered" value={agents.agents.length} />
          <Line
            label="Tasks in progress"
            value={agents.agents.reduce((total, agent) => total + agent.activeTasks.length, 0)}
          />
          <Line label="Awaiting approval" value={approvals} />
        </RailCard>
      ) : null}
    </aside>
  );
}
