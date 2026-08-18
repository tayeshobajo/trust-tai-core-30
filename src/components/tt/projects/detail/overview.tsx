/**
 * Overview: what we are building, why, what is happening, what is stopping it.
 */

import { AlertTriangle, ArrowRight, CheckCircle2, Circle, Clock } from "lucide-react";

import { TTButton } from "@/components/tt/primitives";
import {
  blockerAgeDays,
  currentWorkItem,
  standsModel,
  upNextItem,
  type CompletionModel,
} from "@/data/projects/detail-projection";
import type { ProjectLineage } from "@/data/projects/index-projection";
import type { ProjectBlocker, WorkItem } from "@/domain/project-delivery";
import { WORK_ITEM_STATUS_LABEL, WORK_ITEM_STATUS_TONE } from "@/domain/project-delivery";
import type { ExecutionProject } from "@/domain/projects";
import { cn } from "@/lib/utils";

export function Panel({
  title,
  tone = "plain",
  action,
  children,
}: {
  title: string;
  tone?: "plain" | "risk";
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "tt-surface p-6",
        tone === "risk" && "border-destructive/30 bg-destructive/[0.03]",
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className={cn("tt-eyebrow", tone === "risk" && "text-destructive")}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function WorkLine({ item }: { item: WorkItem }) {
  const Icon =
    item.status === "complete" ? CheckCircle2 : item.status === "in_progress" ? Clock : Circle;
  return (
    <div className="flex items-start gap-3">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-[15px] text-foreground">{item.title}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]",
              WORK_ITEM_STATUS_TONE[item.status],
            )}
          >
            {WORK_ITEM_STATUS_LABEL[item.status]}
          </span>
          {item.ownerLabel ? <span>{item.ownerLabel}</span> : null}
          {item.dueDate ? <span>Due {new Date(item.dueDate).toLocaleDateString()}</span> : null}
        </p>
      </div>
    </div>
  );
}

export function OverviewTab({
  project,
  lineage,
  items,
  blockers,
  completion,
  onOpenTab,
}: {
  project: ExecutionProject;
  lineage: ProjectLineage;
  items: WorkItem[];
  blockers: ProjectBlocker[];
  completion: CompletionModel;
  onOpenTab: (tab: "work" | "blockers" | "decisions") => void;
}) {
  const stands = standsModel(project, items, blockers);
  const current = currentWorkItem(items);
  const next = upNextItem(items);
  const openBlocker = blockers.find((entry) => entry.status === "open") ?? null;
  const finished = project.state === "delivered";

  return (
    <div className="space-y-5">
      <Panel title="Where this stands">
        <p className="max-w-reading text-[15px] leading-relaxed text-foreground">
          {stands.because}
        </p>
        <div className="mt-4 space-y-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-royal transition-[width] duration-500"
              style={{ width: `${stands.progress.percent}%` }}
            />
          </div>
          <p className="text-[13px] text-muted-foreground">{stands.progress.line}</p>
        </div>
      </Panel>

      <div className="grid gap-5 md:grid-cols-2">
        <Panel
          title="Current work"
          action={
            <TTButton size="sm" variant="quiet" onClick={() => onOpenTab("work")}>
              All work
              <ArrowRight aria-hidden />
            </TTButton>
          }
        >
          {current ? (
            <WorkLine item={current} />
          ) : (
            <p className="text-[15px] text-muted-foreground">
              Nothing is in progress. Start the next item when you are ready.
            </p>
          )}
        </Panel>

        <Panel title="Up next">
          {next ? (
            <WorkLine item={next} />
          ) : (
            <p className="text-[15px] text-muted-foreground">
              Nothing is queued after the current work.
            </p>
          )}
        </Panel>
      </div>

      {openBlocker ? (
        <Panel
          title="Blocker"
          tone="risk"
          action={
            <TTButton size="sm" variant="quiet" onClick={() => onOpenTab("blockers")}>
              Resolve
              <ArrowRight aria-hidden />
            </TTButton>
          }
        >
          <div className="flex gap-3">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="min-w-0 space-y-1">
              <p className="text-[15px] text-foreground">{openBlocker.reason}</p>
              <p className="text-[13px] text-muted-foreground">
                Open for {blockerAgeDays(openBlocker)} day
                {blockerAgeDays(openBlocker) === 1 ? "" : "s"}.{" "}
                {openBlocker.ownerLabel ? `Carried by ${openBlocker.ownerLabel}. ` : ""}
                {openBlocker.nextMove ?? "No next move recorded."}
              </p>
            </div>
          </div>
        </Panel>
      ) : null}

      <Panel title="Why this project exists">
        <div className="max-w-reading space-y-4 text-[15px] leading-relaxed">
          <div>
            <p className="tt-eyebrow">Point A</p>
            <p className="mt-1 text-foreground">
              {project.pointA.trim() || "No current truth was recorded."}
            </p>
          </div>
          <div>
            <p className="tt-eyebrow">Point B</p>
            <p className="mt-1 text-foreground">{completion.outcome}</p>
          </div>
          <p className="text-[13px] text-muted-foreground">
            {lineage.fromRoadmap
              ? `Approved on the ${lineage.company} roadmap${
                  lineage.milestoneName ? ` as ${lineage.milestoneName}` : ""
                }.`
              : "Started directly in Projects, with no roadmap milestone behind it."}
          </p>
        </div>
      </Panel>

      {finished ? (
        <Panel title="What this changed">
          {completion.changed.length ? (
            <ul className="space-y-2">
              {completion.changed.map((line) => (
                <li key={line} className="flex items-start gap-3 text-[15px] text-foreground">
                  <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                  {line}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[15px] text-muted-foreground">
              No completed items were recorded on this project.
            </p>
          )}
          {completion.roadmapSignal ? (
            <p className="mt-4 text-[13px] text-muted-foreground">{completion.roadmapSignal}</p>
          ) : null}
        </Panel>
      ) : null}
    </div>
  );
}
