/**
 * Steward, Tasks.
 *
 * The full accountability checklist across people and agents. Same rows as
 * Team, grouped the way a person asks for them.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/tt/app-shell";
import { MetaPill, TTButton, TTInput } from "@/components/tt/primitives";
import { ReassignPicker, type AssignablePerson } from "@/components/tt/steward/reassign-picker";
import { StewardHero } from "@/components/tt/steward/steward-hero";
import { StewardTabs } from "@/components/tt/steward/steward-tabs";
import { TaskDetailPanel } from "@/components/tt/steward/task-detail";
import { TaskRow } from "@/components/tt/steward/task-row";
import { StewardUnavailable } from "@/components/tt/steward/unavailable";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import {
  applyTasksFilter,
  groupByDue,
  groupByFocus,
  groupByOwner,
  groupByProject,
  searchTasks,
  TASKS_FILTER_LABEL,
  type TasksFilter,
} from "@/data/steward/accountability";
import { fathomStatusLine, readStewardTeam } from "@/data/steward/team-read";
import { reassignAuthority } from "@/data/steward/authority";
import { useStewardActions } from "@/data/steward/use-steward-actions";
import { STEWARD_FOCUS_LABEL, type StewardTask } from "@/domain/steward-accountability";
import { personKeyOf } from "@/domain/steward";
import { cn } from "@/lib/utils";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Steward · Tasks · Trust Tai OS";
const DESCRIPTION =
  "Everything people and agents own across Trust Tai, grouped by priority, owner, project or date.";

export const Route = createFileRoute("/modules/steward/tasks")({
  /* Activity links here with the task it recorded and the moment it happened. */
  validateSearch: (search: Record<string, unknown>) => ({
    task: typeof search["task"] === "string" ? (search["task"] as string).slice(0, 200) : "",
    at: typeof search["at"] === "string" ? (search["at"] as string).slice(0, 40) : "",
  }),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: TasksRoute,
});

function TasksRoute() {
  const { task, at } = Route.useSearch();
  return (
    <WorkspaceGate>
      {(identity) => (
        <AppShell identity={identity}>
          <StewardTasks identity={identity} openKey={task} recordedAt={at} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

const FILTERS: TasksFilter[] = [
  "all",
  "mine",
  "team",
  "agents",
  "today",
  "upcoming",
  "overdue",
  "completed",
  "no_owner",
];

type Grouping = "priority" | "assignee" | "project" | "due";

const GROUPING_LABEL: Record<Grouping, string> = {
  priority: "Priority",
  assignee: "Assignee",
  project: "Project",
  due: "Due date",
};

function StewardTasks({
  identity,
  openKey,
  recordedAt,
}: {
  identity: WorkspaceIdentity;
  openKey: string;
  recordedAt: string;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["steward", "team", identity.organizationId];
  const [filter, setFilter] = useState<TasksFilter>("all");
  const [grouping, setGrouping] = useState<Grouping>("priority");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [openTask, setOpenTask] = useState<StewardTask | null>(null);
  const [reassign, setReassign] = useState<StewardTask | null>(null);

  const navigate = Route.useNavigate();
  const actor = { userId: identity.userId, canManage: identity.canManage };
  const read = useQuery({ queryKey, queryFn: () => readStewardTeam(identity.organizationId) });
  const actions = useStewardActions({ identity, queryKey });

  const tasks = read.data?.tasks ?? [];

  /* Opened from the activity stream: show the task the event was about, and
   * say plainly that the row is as it stands now, not a snapshot. */
  const linkedTask = openKey ? (tasks.find((row) => row.key === openKey) ?? null) : null;
  const linkedMissing = Boolean(openKey) && !linkedTask && !read.isPending;
  const shownTask = openTask ?? linkedTask;
  const viewerKey = personKeyOf({ email: identity.email, name: identity.name });
  const visible = useMemo(
    () =>
      searchTasks(
        applyTasksFilter(tasks, filter, { now: read.data?.now ?? new Date().toISOString(), viewerKey }),
        query,
      ),
    [tasks, filter, query, read.data?.now, viewerKey],
  );

  const groups = useMemo(() => {
    switch (grouping) {
      case "assignee":
        return groupByOwner(visible);
      case "project":
        return groupByProject(visible);
      case "due":
        return groupByDue(visible);
      default:
        return groupByFocus(visible).map((group) => ({
          label: STEWARD_FOCUS_LABEL[group.focus],
          tasks: group.tasks,
        }));
    }
  }, [visible, grouping]);

  const people = useMemo<AssignablePerson[]>(() => {
    const map = new Map<string, AssignablePerson>();
    for (const task of tasks) {
      if (task.owner.kind !== "human") continue;
      map.set(task.owner.key, {
        key: task.owner.key,
        name: task.owner.name,
        initials: task.owner.initials,
      });
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);

  const selectedTasks = tasks.filter((task) => selected.includes(task.key));

  function bulkComplete() {
    const allowed = selectedTasks.filter(
      (task) => task.completionPath === "steward" && task.state !== "complete",
    );
    for (const task of allowed) actions.complete(task, "");
    setSelected([]);
  }

  return (
    <div className="space-y-8">
      <StewardHero status={fathomStatusLine(read.data)} />

      <StewardTabs active="tasks" />

      <div>
        <h2 className="font-display text-2xl text-foreground">What everyone owns.</h2>
        <p className="mt-2 max-w-reading text-sm text-muted-foreground">
          Meeting promises, project work and agent work in one list. Each row is completed in the
          room that owns it.
        </p>
      </div>

      {read.isError ? (
        <StewardUnavailable error={read.error} />
      ) : read.isLoading ? (
        <p className="text-sm text-muted-foreground">Reading what everyone owns…</p>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-1">
              {FILTERS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs transition-colors",
                    filter === value
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {TASKS_FILTER_LABEL[value]}
                </button>
              ))}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Group by
              </label>
              <select
                value={grouping}
                onChange={(event) => setGrouping(event.target.value as Grouping)}
                className="h-10 rounded-lg border border-input bg-card px-3 text-sm text-foreground"
              >
                {(Object.keys(GROUPING_LABEL) as Grouping[]).map((value) => (
                  <option key={value} value={value}>
                    {GROUPING_LABEL[value]}
                  </option>
                ))}
              </select>
              <TTInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search tasks"
                aria-label="Search tasks"
                className="h-10 w-[200px]"
              />
            </div>
          </div>

          {selected.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <MetaPill>{selected.length} selected</MetaPill>
              <TTButton type="button" size="sm" variant="secondary" onClick={bulkComplete}>
                Mark complete where valid
              </TTButton>
              <TTButton
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setReassign(selectedTasks[0] ?? null)}
                disabled={selectedTasks.length !== 1}
              >
                Reassign
              </TTButton>
              <button
                type="button"
                onClick={() => setSelected([])}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            </div>
          ) : null}

          {groups.length === 0 ? (
            <div className="tt-surface px-6 py-10">
              <p className="font-display text-xl text-foreground">Nothing in this view.</p>
              <p className="mt-2 max-w-reading text-sm text-muted-foreground">
                Promises confirmed in Meetings and work created in Projects both land here.
              </p>
            </div>
          ) : (
            groups.map((group) => (
              <section key={group.label} className="tt-surface overflow-hidden">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <p className="tt-eyebrow">{group.label}</p>
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {group.tasks.length}
                  </span>
                </div>
                <ul>
                  {group.tasks.map((task) => (
                    <TaskRow
                      key={task.key}
                      task={task}
                      actor={actor}
                      showSelect
                      selected={selected.includes(task.key)}
                      onSelect={(checked) =>
                        setSelected((current) =>
                          checked
                            ? [...current, task.key]
                            : current.filter((key) => key !== task.key),
                        )
                      }
                      onOpen={() => setOpenTask(task)}
                      onComplete={() => actions.complete(task, "")}
                      onReassign={() => setReassign(task)}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      )}

      <TaskDetailPanel
        task={shownTask}
        {...(shownTask && shownTask === linkedTask && recordedAt
          ? { recordedAt }
          : {})}
        actor={actor}
        onClose={() => {
          setOpenTask(null);
          if (openKey) navigate({ search: { task: "", at: "" }, replace: true });
        }}
        onComplete={(note) => {
          if (shownTask) actions.complete(shownTask, note);
          setOpenTask(null);
        }}
        onReassign={() => {
          setReassign(shownTask);
          setOpenTask(null);
        }}
        onFocus={(focus) => shownTask && actions.setFocus(shownTask, focus)}
        onDue={(due) => shownTask && actions.setDue(shownTask, due)}
      />

      <ReassignPicker
        open={Boolean(reassign)}
        task={reassign}
        people={people}
        agents={read.data?.agents.agents ?? []}
        eligibleAgent={actions.eligibleAgent}
        refusal={reassign ? reassignAuthority(reassign, actor).because : null}
        onClose={() => setReassign(null)}
        onAssignPerson={(target) => {
          if (reassign) actions.reassignToPerson(reassign, target);
          setReassign(null);
          setSelected([]);
        }}
        onAssignAgent={(agent) => {
          if (reassign) actions.requestAgentAssignment(reassign, agent);
          setReassign(null);
          setSelected([]);
        }}
      />

      <p className="sr-only" aria-live="polite">
        {queryClient.isFetching() ? "Updating tasks" : ""}
      </p>
    </div>
  );
}
