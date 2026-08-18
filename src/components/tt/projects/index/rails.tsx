/** Left glance rail and right support rail for the Projects room. */

import { Link } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";

import { ProjectStatusPill } from "@/components/tt/projects/index/status-pill";
import type { ProjectRowModel, ProjectsGlance } from "@/data/projects/index-projection";

function RailSection({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="tt-eyebrow">{title}</h2>
      {note ? <p className="mt-1 text-[12px] text-muted-foreground">{note}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function ProjectsGlanceRail({
  glance,
  driver,
}: {
  glance: ProjectsGlance;
  driver: ProjectRowModel | null;
}) {
  const metrics: { label: string; value: number }[] = [
    { label: "Active", value: glance.active },
    { label: "Need attention", value: glance.attention },
    { label: "Due this week", value: glance.dueThisWeek },
    { label: "Blocked", value: glance.blocked },
    { label: "Companies", value: glance.companies },
  ];

  return (
    <div className="space-y-4">
      <RailSection title="Projects at a glance">
        <dl className="space-y-2.5">
          {metrics.map((metric) => (
            <div key={metric.label} className="flex items-baseline justify-between gap-3">
              <dt className="text-[13px] text-muted-foreground">{metric.label}</dt>
              <dd className="font-display text-lg leading-none text-foreground">{metric.value}</dd>
            </div>
          ))}
        </dl>
      </RailSection>

      <RailSection title="Your driver" note="The one project worth moving first.">
        {driver ? (
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {driver.lineage.company}
            </p>
            <p className="mt-1.5 text-[14px] font-medium text-foreground">{driver.project.name}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">{driver.because}</p>
            <Link
              to="/modules/projects/$projectId"
              params={{ projectId: driver.project.id }}
              className="mt-3 inline-flex h-9 items-center rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open project
            </Link>
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Nothing is waiting on you in delivery right now.
          </p>
        )}
      </RailSection>
    </div>
  );
}

function MiniRow({ row, suffix }: { row: ProjectRowModel; suffix: string }) {
  return (
    <li>
      <Link
        to="/modules/projects/$projectId"
        params={{ projectId: row.project.id }}
        className="block rounded-lg px-2 py-2 -mx-2 transition-colors hover:bg-secondary"
      >
        <span className="block truncate text-[13px] text-foreground">{row.project.name}</span>
        <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
          {row.lineage.company} · {suffix}
        </span>
      </Link>
    </li>
  );
}

export function ProjectsSupportRail({
  thisWeek,
  needsYou,
  completed,
}: {
  thisWeek: ProjectRowModel[];
  needsYou: ProjectRowModel[];
  completed: ProjectRowModel[];
}) {
  return (
    <div className="space-y-4">
      <RailSection title="This week" note="Agreed dates landing in the next seven days.">
        {thisWeek.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No dates agreed this week.</p>
        ) : (
          <ul className="space-y-1">
            {thisWeek.slice(0, 5).map((row) => (
              <MiniRow key={row.project.id} row={row} suffix={row.due} />
            ))}
          </ul>
        )}
      </RailSection>

      <RailSection title="Needs you" note="Waiting on a person, not on the work.">
        {needsYou.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nothing needs your decision.</p>
        ) : (
          <ul className="space-y-2">
            {needsYou.map((row) => (
              <li key={row.project.id}>
                <Link
                  to="/modules/projects/$projectId"
                  params={{ projectId: row.project.id }}
                  className="block rounded-lg px-2 py-2 -mx-2 transition-colors hover:bg-secondary"
                >
                  <span className="flex items-center gap-2">
                    <ProjectStatusPill status={row.status} />
                  </span>
                  <span className="mt-1.5 block truncate text-[13px] text-foreground">
                    {row.project.name}
                  </span>
                  <span className="block text-[12px] text-muted-foreground">
                    {row.ownerLabel === "No one yet" ? "No owner recorded" : row.because}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </RailSection>

      <RailSection title="Recently completed">
        {completed.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nothing delivered yet.</p>
        ) : (
          <ul className="space-y-2">
            {completed.map((row) => (
              <li key={row.project.id} className="flex items-start gap-2">
                <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-foreground">
                    {row.project.name}
                  </span>
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {row.lineage.company}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </RailSection>
    </div>
  );
}
