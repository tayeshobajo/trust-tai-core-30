/**
 * The Comms panels that live under the suite navigation.
 *
 * Everything here is read from the same derived inbox state the room uses, no
 * separate counts, no implied autonomy. If Comms doesn't know it, it isn't shown.
 */

import { HEALTH_LABEL, type ConversationHealthStatus } from "@/domain/comms-health";
import type { InboxTab, InboxView } from "@/data/comms-inbox";
import type { AttentionEntry } from "@/data/comms-attention";
import { cn } from "@/lib/utils";

import { HealthDot } from "./health-marks";

/**
 * What the glance shows. Three of these are derived health reads; "following_up"
 * is the inbox tab for conversations moving on their own rhythm, so selecting it
 * switches tab rather than filtering by health.
 */
export type GlanceKey = ConversationHealthStatus | "following_up";

const GLANCE: GlanceKey[] = ["needs_attention", "following_up", "at_risk", "quiet"];

const GLANCE_LABEL: Record<GlanceKey, string> = {
  needs_attention: "Needs attention",
  following_up: "Following up",
  at_risk: HEALTH_LABEL.at_risk,
  quiet: HEALTH_LABEL.quiet,
  healthy: HEALTH_LABEL.healthy,
};

/** Real counts, read from the same derived inbox state the room renders. */
export function glanceRows(view: InboxView): { key: GlanceKey; label: string; count: number }[] {
  return GLANCE.map((key) => ({
    key,
    label: GLANCE_LABEL[key],
    count:
      key === "following_up" ? view.tabCounts.following_up : view.healthCounts[key],
  }));
}

export function SidebarStatusCard({
  title,
  rows,
  onSelect,
  active,
}: {
  title: string;
  rows: { key: GlanceKey; label: string; count: number }[];
  onSelect?: (key: GlanceKey) => void;
  active?: GlanceKey | null;
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
                <HealthDot status={row.key === "following_up" ? "healthy" : row.key} />
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
  action,
  onAction,
}: {
  heading: string;
  statement: string;
  detail?: string | undefined;
  action?: string | undefined;
  onAction?: (() => void) | undefined;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <h2 className="tt-eyebrow">{heading}</h2>
      <p className="mt-1.5 font-display text-[17px] leading-snug text-foreground">{statement}</p>
      {detail ? <p className="mt-1 text-[12px] text-muted-foreground">{detail}</p> : null}
      {action && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-2 text-[12px] font-medium text-royal underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {action}
        </button>
      ) : null}
    </section>
  );
}

/**
 * Plain-language driver derived only from what Comms can actually see.
 *
 * Deterministic order of concern: conversations at risk, then people waiting on
 * us, then conversations that have gone quiet, then a calm inbox.
 */
export function commsDriver(view: InboxView): {
  statement: string;
  detail: string;
  focus: GlanceKey | null;
  count: number;
} {
  const needsYou = view.tabCounts.needs_you;
  const atRisk = view.healthCounts.at_risk;
  const quiet = view.healthCounts.quiet;
  const followingUp = view.tabCounts.following_up;
  const plural = (n: number) => (n === 1 ? "" : "s");

  if (atRisk > 0) {
    return {
      statement: "Bring these back to life.",
      detail: `${atRisk} conversation${plural(atRisk)} at risk of going cold.`,
      focus: "at_risk",
      count: atRisk,
    };
  }
  if (needsYou > 0) {
    return {
      statement: "Keep conversations warm.",
      detail: `${needsYou} conversation${plural(needsYou)} waiting on you.`,
      focus: "needs_attention",
      count: needsYou,
    };
  }
  if (quiet > 0) {
    return {
      statement: "Reopen a quiet one.",
      detail: `${quiet} conversation${plural(quiet)} have gone quiet with nothing due.`,
      focus: "quiet",
      count: quiet,
    };
  }
  if (view.tabCounts.all > 0) {
    return {
      statement: "Nothing is waiting on you.",
      detail: `${followingUp} conversation${plural(followingUp)} moving on their own rhythm.`,
      focus: "following_up",
      count: followingUp,
    };
  }
  return {
    statement: "Start with one person.",
    detail: "Add the last person you met and Comms carries it from there.",
    focus: null,
    count: 0,
  };
}

export function CommsSidebarPanels({
  view,
  health,
  tab,
  onHealth,
  onTab,
  onAdd,
  attention,
  onOpenRelationship,
}: {
  view: InboxView;
  health: ConversationHealthStatus | null;
  tab?: InboxTab;
  onHealth: (status: ConversationHealthStatus | null) => void;
  onTab?: (tab: InboxTab) => void;
  onAdd: () => void;
  /** Relationships with a real reason to hear from Tai today. */
  attention?: AttentionEntry[];
  onOpenRelationship?: (id: string) => void;
}) {
  const driver = commsDriver(view);
  const active: GlanceKey | null =
    health ?? (tab === "following_up" ? "following_up" : null);

  function select(key: GlanceKey) {
    if (key === "following_up") {
      onHealth(null);
      onTab?.(tab === "following_up" ? "all" : "following_up");
      return;
    }
    onTab?.("all");
    onHealth(health === key ? null : key);
  }

  return (
    <>
      <SidebarStatusCard
        title="Comms at a glance"
        active={active}
        onSelect={select}
        rows={glanceRows(view)}
      />

      <DriverCard
        heading="Your driver"
        statement={driver.statement}
        detail={driver.detail}
        action={driver.focus ? "Show these" : undefined}
        onAction={driver.focus ? () => select(driver.focus as GlanceKey) : undefined}
      />

      {attention ? (
        <section className="rounded-xl border border-cloud-line bg-cloud/60 p-3">
          <h2 className="tt-eyebrow">Worth your attention today</h2>
          {attention.length === 0 ? (
            <p className="mt-2 text-[12px] text-muted-foreground">
              Nobody needs you today. Comms is watching quietly.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {attention.map((entry) => (
                <li key={entry.relationship.id} className="rounded-lg px-1 py-0.5">
                  <button
                    type="button"
                    onClick={() => onOpenRelationship?.(entry.relationship.id)}
                    className="w-full rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="block text-[13px] text-foreground">
                      {entry.relationship.fullName}
                    </span>
                    <span className="block text-[12px] text-muted-foreground">
                      {entry.move.action}
                    </span>
                  </button>
                  {onSnooze || onMarkReviewed ? (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1.5 pb-1">
                      {onMarkReviewed ? (
                        <button
                          type="button"
                          onClick={() => onMarkReviewed(entry.relationship.id)}
                          className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          Reviewed
                        </button>
                      ) : null}
                      {onSnooze
                        ? SNOOZE_CHOICES.map((choice) => (
                            <button
                              key={choice.id}
                              type="button"
                              onClick={() => onSnooze(entry.relationship.id, choice.id)}
                              className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {choice.label}
                            </button>
                          ))
                        : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {setAside && setAside.length > 0 ? (
            <details className="mt-2.5">
              <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Set aside ({setAside.length})
              </summary>
              <ul className="mt-1.5 space-y-1">
                {setAside.map((item) => (
                  <li
                    key={item.entry.relationship.id}
                    className="flex items-baseline justify-between gap-2 px-1.5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] text-foreground">
                        {item.entry.relationship.fullName}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {item.because}
                      </span>
                    </span>
                    {onRestoreAttention ? (
                      <button
                        type="button"
                        onClick={() => onRestoreAttention(item.entry.relationship.id)}
                        className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Bring back
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}

      <button
        type="button"
        onClick={onAdd}
        className="flex min-h-11 w-full items-center justify-center rounded-lg border border-cloud-line bg-cloud px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-cloud-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        + Add relationship
      </button>
    </>
  );
}
