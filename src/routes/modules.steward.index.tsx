/**
 * Steward, Team.
 *
 * One question: what should everyone be focused on right now? A single
 * checklist across people and agents, the commitments nobody has taken, the
 * last three conversations, and two small cards. Nothing else.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useMemo, useState, type DragEvent } from "react";

import { AppShell } from "@/components/tt/app-shell";
import { TTButton, TTInput } from "@/components/tt/primitives";
import { FathomSyncControl } from "@/components/tt/steward/fathom-sync";
import { MemberDetailPanel } from "@/components/tt/steward/member-detail";
import { ReassignPicker, type AssignablePerson } from "@/components/tt/steward/reassign-picker";
import { RecentMeetings } from "@/components/tt/steward/recent-meetings";
import { StewardHero } from "@/components/tt/steward/steward-hero";
import { StewardTabs } from "@/components/tt/steward/steward-tabs";
import { TaskDetailPanel } from "@/components/tt/steward/task-detail";
import { TaskRow } from "@/components/tt/steward/task-row";
import { TeamRail } from "@/components/tt/steward/team-rail";
import { StewardUnavailable } from "@/components/tt/steward/unavailable";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import {
  applyTeamFilter,
  glanceOf,
  personRead,
  searchTasks,
  TEAM_FILTER_LABEL,
  type TeamFilter,
} from "@/data/steward/accountability";
import { fathomLastSync, fathomStatusLine, readStewardTeam } from "@/data/steward/team-read";
import { reassignAuthority } from "@/data/steward/authority";
import { useStewardActions } from "@/data/steward/use-steward-actions";
import type { StewardTask } from "@/domain/steward-accountability";
import { cn } from "@/lib/utils";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Steward · Team · Trust Tai OS";
const DESCRIPTION =
  "What every person and agent should be focused on right now, read from meeting commitments, project work and Paperclip execution.";

export const Route = createFileRoute("/modules/steward/")({
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
  component: StewardTeamRoute,
});

function StewardTeamRoute() {
  return (
    <WorkspaceGate appId="steward">
      {(identity) => (
        <AppShell identity={identity}>
          <StewardTeam identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

const FILTERS: TeamFilter[] = [
  "all",
  "needs_attention",
  "overdue",
  "blocked",
  "no_owner",
  "agents",
  "team",
];

function StewardTeam({ identity }: { identity: WorkspaceIdentity }) {
  const queryClient = useQueryClient();
  const queryKey = ["steward", "team", identity.organizationId];
  const [filter, setFilter] = useState<TeamFilter>("all");
  const [query, setQuery] = useState("");
  const [openTask, setOpenTask] = useState<StewardTask | null>(null);
  const [reassign, setReassign] = useState<StewardTask | null>(null);
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");

  const actor = { userId: identity.userId, canManage: identity.canManage };
  const read = useQuery({ queryKey, queryFn: () => readStewardTeam(identity.organizationId) });
  const actions = useStewardActions({ identity, queryKey });

  const tasks = read.data?.tasks ?? [];
  const visible = useMemo(
    () => searchTasks(applyTeamFilter(tasks, filter), query).filter((task) => task.state !== "complete"),
    [tasks, filter, query],
  );
  const glance = useMemo(() => glanceOf(tasks), [tasks]);
  const unowned = useMemo(
    () => tasks.filter((task) => task.owner.kind === "unowned" && task.state !== "complete"),
    [tasks],
  );
  const overdue = useMemo(() => tasks.filter((task) => task.overdue), [tasks]);
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

  const person = openPerson ? personRead(tasks, openPerson, read.data?.now ?? new Date().toISOString()) : null;

  const reorder = useMutation({
    mutationFn: async ({ source, target }: { source: StewardTask; target: StewardTask }) => {
      await actions.setRank(source, target.rank - 1, target.title);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  /** One rule for both mouse and keyboard: a row only moves above a peer. */
  function moveAbove(source: StewardTask | undefined, target: StewardTask | undefined) {
    if (!source || !target || source.key === target.key) return;
    if (source.owner.key !== target.owner.key) {
      setAnnounce(`${source.title} belongs to ${source.owner.name}. Choose an owner instead.`);
      setReassign(source);
      return;
    }
    reorder.mutate({ source, target });
    setAnnounce(`${source.title} moved above ${target.title}.`);
  }

  function onDrop(target: StewardTask) {
    return (event: DragEvent<HTMLLIElement>) => {
      event.preventDefault();
      const source = tasks.find((task) => task.key === dragKey);
      setDragKey(null);
      moveAbove(source, target);
    };
  }

  return (
    <div className="space-y-8">
      <StewardHero
        status={fathomStatusLine(read.data)}
        action={
          <div className="flex flex-wrap gap-2">
            <TTButton type="button" onClick={() => setFilter("needs_attention")}>
              Review priorities
            </TTButton>
            <TTButton asChild variant="secondary">
              <Link to="/modules/steward/memory">Search meeting memory</Link>
            </TTButton>
          </div>
        }
      />

      <FathomSyncControl
        organizationId={identity.organizationId}
        lastSyncedAt={fathomLastSync(read.data)}
        refreshKeys={[queryKey, ["steward", "conversations", identity.organizationId]]}
      />

      <StewardTabs active="team" />

      {read.isError ? (
        <StewardUnavailable error={read.error} />
      ) : read.isLoading ? (
        <p className="text-sm text-muted-foreground">Reading who owes what…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
          <div className="space-y-8">
            <section className="tt-surface overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
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
                      {TEAM_FILTER_LABEL[value]}
                    </button>
                  ))}
                </div>
                <div className="relative ml-auto min-w-[180px] flex-1 sm:max-w-[240px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <TTInput
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search tasks"
                    aria-label="Search tasks"
                    className="h-10 pl-9"
                  />
                </div>
              </div>

              {visible.length === 0 ? (
                <div className="px-6 py-10">
                  <p className="font-display text-xl text-foreground">
                    {tasks.length === 0
                      ? "Nothing has been promised or assigned yet."
                      : "Nothing matches that view."}
                  </p>
                  <p className="mt-2 max-w-reading text-sm text-muted-foreground">
                    {tasks.length === 0
                      ? "Read a conversation in Meetings, or start work in Projects, and every promise made will appear here with an owner."
                      : "Clear the filter or search to see the full checklist."}
                  </p>
                </div>
              ) : (
                <ul aria-label="Accountability checklist">
                  {visible.map((task, index) => (
                    <TaskRow
                      key={task.key}
                      task={task}
                      actor={actor}
                      position={index + 1}
                      total={visible.length}
                      {...(index > 0
                        ? { onMoveUp: () => moveAbove(task, visible[index - 1]) }
                        : {})}
                      {...(index < visible.length - 1
                        ? { onMoveDown: () => moveAbove(visible[index + 1], task) }
                        : {})}
                      onOpen={() => setOpenTask(task)}
                      onComplete={() => actions.complete(task, "")}
                      onReassign={() => setReassign(task)}
                      onDragStart={(event) => {
                        setDragKey(task.key);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={onDrop(task)}
                    />
                  ))}
                </ul>
              )}
            </section>

            <p aria-live="polite" className="sr-only">
              {announce}
            </p>

            {unowned.length > 0 ? (
              <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-card/60 px-5 py-4">
                <p className="text-sm text-foreground">
                  {unowned.length} commitment{unowned.length === 1 ? "" : "s"} need an owner
                </p>
                <TTButton
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setFilter("no_owner")}
                >
                  Review unowned
                </TTButton>
              </section>
            ) : null}

            <RecentMeetings
              conversations={read.data?.conversations ?? []}
              commitments={read.data?.commitments ?? []}
            />

            {!read.data?.stateProvisioned ? (
              <p className="text-xs text-muted-foreground">
                Focus and ordering will not persist until{" "}
                <code>docs/steward-accountability-schema.sql</code> is applied to this workspace.
              </p>
            ) : null}
          </div>

          <TeamRail
            stacked
            glance={glance}
            unownedCount={unowned.length}
            overdueTasks={overdue}
            agents={read.data?.agents}
            onReviewUnowned={() => setFilter("no_owner")}
            onReviewOverdue={() => setFilter("overdue")}
          />
        </div>
      )}

      <TaskDetailPanel
        task={openTask}
        actor={actor}
        onClose={() => setOpenTask(null)}
        onComplete={(note) => {
          if (openTask) actions.complete(openTask, note);
          setOpenTask(null);
        }}
        onReassign={() => {
          setReassign(openTask);
          setOpenTask(null);
        }}
        onFocus={(focus) => openTask && actions.setFocus(openTask, focus)}
        onDue={(due) => openTask && actions.setDue(openTask, due)}
      />

      <MemberDetailPanel
        read={person}
        now={read.data?.now ?? new Date().toISOString()}
        onClose={() => setOpenPerson(null)}
        onOpenTask={(task) => {
          setOpenPerson(null);
          setOpenTask(task);
        }}
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
        }}
        onAssignAgent={(agent) => {
          if (reassign) actions.requestAgentAssignment(reassign, agent);
          setReassign(null);
        }}
      />
    </div>
  );
}
