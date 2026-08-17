/**
 * The Comms panels that live under the suite navigation.
 *
 * Everything here is read from the same derived inbox state the room uses — no
 * separate counts, no implied autonomy. If Comms doesn't know it, it isn't shown.
 */

import { HEALTH_LABEL, type ConversationHealthStatus } from "@/domain/comms-health";
import type { InboxView } from "@/data/comms-inbox";
import { cn } from "@/lib/utils";

import { HealthDot } from "./health-marks";

const GLANCE: ConversationHealthStatus[] = ["needs_attention", "at_risk", "quiet", "healthy"];

export function SidebarStatusCard({
  title,
  rows,
  onSelect,
  active,
}: {
  title: string;
  rows: { key: ConversationHealthStatus; label: string; count: number }[];
  onSelect?: (key: ConversationHealthStatus) => void;
  active?: ConversationHealthStatus | null;
}) {
  return (
    <section className="rounded-xl border border-cloud-line bg-cloud/60 p-3">
      <h2 className="tt-eyebrow">{title}</h2>
      <ul className="mt-2 space-y-0.5">
        {rows.map((row) => {
          const selected = active === row.key;
          return (
            <li key={row.key}>
              <button
                type="button"
                onClick={onSelect ? () => onSelect(row.key) : undefined}
                aria-pressed={onSelect ? selected : undefined}
                disabled={!onSelect}
                className={cn(
                  "flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected
                    ? "bg-card font-medium text-foreground"
                    : "text-muted-foreground hover:bg-card/70 hover:text-foreground",
                )}
              >
                <HealthDot status={row.key} />
                <span className="flex-1 truncate">{row.label}</span>
                <span className="font-mono text-[11px] tabular-nums text-foreground/80">
                  {row.count}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function DriverCard({
  heading,
  statement,
  detail,
}: {
  heading: string;
  statement: string;
  detail?: string;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <h2 className="tt-eyebrow">{heading}</h2>
      <p className="mt-1.5 font-display text-[17px] leading-snug text-foreground">{statement}</p>
      {detail ? <p className="mt-1 text-[12px] text-muted-foreground">{detail}</p> : null}
    </section>
  );
}

/** Plain-language driver derived only from what Comms can actually see. */
export function commsDriver(view: InboxView): { statement: string; detail: string } {
  const needsYou = view.tabCounts.needs_you;
  const atRisk = view.healthCounts.at_risk;
  if (atRisk > 0) {
    return {
      statement: "Bring these back to life.",
      detail: `${atRisk} conversation${atRisk === 1 ? "" : "s"} at risk of going cold.`,
    };
  }
  if (needsYou > 0) {
    return {
      statement: "Keep conversations warm.",
      detail: `${needsYou} conversation${needsYou === 1 ? "" : "s"} waiting on you.`,
    };
  }
  if (view.tabCounts.all > 0) {
    return {
      statement: "Nothing is waiting on you.",
      detail: `${view.tabCounts.following_up} conversation${view.tabCounts.following_up === 1 ? "" : "s"} moving on their own rhythm.`,
    };
  }
  return {
    statement: "Start with one person.",
    detail: "Add the last person you met and Comms carries it from there.",
  };
}

export function CommsSidebarPanels({
  view,
  health,
  onHealth,
  onAdd,
}: {
  view: InboxView;
  health: ConversationHealthStatus | null;
  onHealth: (status: ConversationHealthStatus | null) => void;
  onAdd: () => void;
}) {
  const driver = commsDriver(view);
  return (
    <>
      <SidebarStatusCard
        title="Comms at a glance"
        active={health}
        onSelect={(status) => onHealth(health === status ? null : status)}
        rows={GLANCE.map((status) => ({
          key: status,
          label: status === "needs_attention" ? "Needs attention" : HEALTH_LABEL[status],
          count: view.healthCounts[status],
        }))}
      />

      <DriverCard heading="Your driver" statement={driver.statement} detail={driver.detail} />

      <button
        type="button"
        onClick={onAdd}
        className="flex min-h-11 w-full items-center justify-center rounded-lg border border-cloud-line bg-cloud px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-cloud-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        + Add someone you met
      </button>
    </>
  );
}
