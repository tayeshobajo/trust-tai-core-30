/**
 * Steward, Agents.
 *
 * The Paperclip workforce, in human language. Steward reads execution state
 * and never claims a completion Paperclip has not reported.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, CalendarClock, CheckCircle2, Pause, Play, RefreshCw, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/tt/app-shell";
import { MetaPill, TTButton } from "@/components/tt/primitives";
import { StewardHero } from "@/components/tt/steward/steward-hero";
import { StewardTabs } from "@/components/tt/steward/steward-tabs";
import { StewardUnavailable } from "@/components/tt/steward/unavailable";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { fathomStatusLine, readStewardTeam } from "@/data/steward/team-read";
import { setPaperclipAgentPausedFn, postTaiNoteToIssueFn } from "@/data/steward-agents.functions";
import {
  AGENT_LIFECYCLE_LABEL,
  type StewardAgent,
  type StewardAgentActivityItem,
  type StewardAgentRoutine,
} from "@/domain/steward-accountability";
import { cn } from "@/lib/utils";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Steward · Agents · Trust Tai OS";
const DESCRIPTION =
  "Every Paperclip agent in the Trust Tai workforce: what it is responsible for, what it is working on, and what it cannot do.";

export const Route = createFileRoute("/modules/steward/agents")({
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
  component: AgentsRoute,
});

function AgentsRoute() {
  return (
    <WorkspaceGate appId="steward">
      {(identity) => (
        <AppShell identity={identity}>
          <Agents identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function RoutineRow({ routine }: { routine: StewardAgentRoutine }) {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-border bg-secondary/40 px-3 py-2.5">
      <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="truncate text-sm text-foreground">{routine.title}</p>
        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {routine.status}
          {routine.lastRunAt ? ` · Last ran ${routine.lastRunAt.slice(0, 10)}` : ""}
          {routine.lastRunStatus ? ` · ${routine.lastRunStatus}` : ""}
        </p>
      </div>
    </li>
  );
}

function ActivityFeed({ items }: { items: StewardAgentActivityItem[] }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No recent activity.</p>;
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.id} className="flex gap-2.5">
          <span
            className={cn(
              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]",
              item.authorKind === "agent"
                ? "border-royal/30 bg-royal/10 text-royal"
                : "border-border bg-secondary text-muted-foreground",
            )}
          >
            {item.authorKind === "agent" ? <Bot className="size-3" /> : "T"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="whitespace-pre-wrap text-sm text-foreground">{item.body}</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {item.createdAt.slice(0, 16).replace("T", " ")}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function AgentDetail({
  agent,
  identity,
  onClose,
  onPauseToggle,
}: {
  agent: StewardAgent;
  identity: WorkspaceIdentity;
  onClose: () => void;
  onPauseToggle: () => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");

  // Get the most recent active issue ID for posting notes
  const activeIssueId = agent.activeTasks[0]?.id ?? null;

  const postNote = useMutation({
    mutationFn: async () => {
      if (!activeIssueId) throw new Error("No active issue to respond to.");
      return postTaiNoteToIssueFn({
        data: { organizationId: identity.organizationId, issueId: activeIssueId, note },
      });
    },
    onSuccess: () => {
      toast.success("Note sent to agent.");
      setNote("");
      setNoteOpen(false);
    },
    onError: (error: unknown) =>
      toast.error("Note not sent", {
        description: error instanceof Error ? error.message : "Paperclip did not accept that.",
      }),
  });

  return (
    <Sheet open onOpenChange={(open) => (open ? null : onClose())}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="space-y-3 text-left">
          <p className="tt-eyebrow">AI agent</p>
          <SheetTitle className="font-display text-2xl text-foreground">{agent.name}</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <MetaPill>{AGENT_LIFECYCLE_LABEL[agent.lifecycle]}</MetaPill>
            <MetaPill>{agent.owningApp}</MetaPill>
            {agent.isPaused ? <MetaPill>Paused</MetaPill> : null}
            {agent.pendingApprovals > 0 ? (
              <MetaPill>{agent.pendingApprovals} awaiting approval</MetaPill>
            ) : null}
            {agent.lastHeartbeatAt ? (
              <MetaPill>Heartbeat {agent.lastHeartbeatAt.slice(0, 16).replace("T", " ")}</MetaPill>
            ) : null}
            <TTButton
              type="button"
              size="sm"
              variant="secondary"
              onClick={onPauseToggle}
              className="ml-auto gap-1.5"
            >
              {agent.isPaused ? (
                <><Play className="size-3.5" /> Resume</>  
              ) : (
                <><Pause className="size-3.5" /> Pause</>
              )}
            </TTButton>
          </div>

          <section className="space-y-2 border-t border-border pt-5">
            <p className="tt-eyebrow">Responsibility</p>
            <p className="max-w-reading text-sm text-foreground">{agent.responsibility}</p>
          </section>

          <section className="space-y-2 border-t border-border pt-5">
            <p className="tt-eyebrow">Current work</p>
            <p className="text-sm text-foreground">
              {agent.currentWork ?? "Nothing in progress right now."}
            </p>
            {activeIssueId && !noteOpen ? (
              <button
                type="button"
                onClick={() => setNoteOpen(true)}
                className="mt-2 text-sm text-royal hover:underline"
              >
                Reply to agent
              </button>
            ) : null}
            {noteOpen ? (
              <div className="mt-3 space-y-2">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Your note or answer to the agent..."
                  rows={3}
                  className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <div className="flex gap-2">
                  <TTButton
                    type="button"
                    size="sm"
                    onClick={() => postNote.mutate()}
                    disabled={!note.trim() || postNote.isPending}
                  >
                    Send
                  </TTButton>
                  <TTButton
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => { setNote(""); setNoteOpen(false); }}
                  >
                    Cancel
                  </TTButton>
                </div>
              </div>
            ) : null}
          </section>

          <section className="space-y-2 border-t border-border pt-5">
            <p className="tt-eyebrow">Queued</p>
            {agent.activeTasks.length > 0 ? (
              <ul className="space-y-1 text-sm text-foreground">
                {agent.activeTasks.map((task) => (
                  <li key={task.id}>
                    {task.title}
                    <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {task.status}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing queued.</p>
            )}
          </section>

          {agent.awaitingApproval.length > 0 ? (
            <section className="space-y-2 border-t border-border pt-5">
              <p className="tt-eyebrow">Waiting for approval</p>
              <ul className="space-y-1 text-sm text-foreground">
                {agent.awaitingApproval.map((task) => (
                  <li key={task.id}>{task.title}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="space-y-2 border-t border-border pt-5">
            <p className="tt-eyebrow">Recent outcomes</p>
            <p className="text-sm text-foreground">
              {agent.completedThisWeek} completed this week
              {agent.recentOutcome ? `. Most recent: ${agent.recentOutcome}.` : "."}
            </p>
          </section>

          {agent.routines.length > 0 ? (
            <section className="space-y-2 border-t border-border pt-5">
              <p className="tt-eyebrow">Recurring responsibilities</p>
              <ul className="space-y-2">
                {agent.routines.map((r) => <RoutineRow key={r.id} routine={r} />)}
              </ul>
            </section>
          ) : null}

          {agent.activityTimeline.length > 0 ? (
            <section className="space-y-3 border-t border-border pt-5">
              <p className="tt-eyebrow">Activity</p>
              <ActivityFeed items={agent.activityTimeline} />
            </section>
          ) : null}

          <section className="space-y-2 border-t border-border pt-5">
            <p className="tt-eyebrow">Capabilities</p>
            {agent.capabilities.length > 0 ? (
              <ul className="space-y-1 text-sm text-foreground">
                {agent.capabilities.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No capability is published, so this agent cannot be given work from Steward.
              </p>
            )}
          </section>

          <section className="space-y-2 rounded-lg border border-warning/30 bg-warning/5 p-4">
            <p className="tt-eyebrow flex items-center gap-1.5">
              <ShieldAlert className="size-3.5" /> What this agent cannot do
            </p>
            <ul className="space-y-1 text-sm text-foreground">
              {agent.cannotDo.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SyncHealthPill({ syncHealth }: { syncHealth: { lastSuccessAt: string | null; consecutiveFailures: number } | null }) {
  if (!syncHealth) return null;
  const { lastSuccessAt, consecutiveFailures } = syncHealth;
  const sinceMs = lastSuccessAt ? Date.now() - new Date(lastSuccessAt).getTime() : null;
  const sinceSec = sinceMs !== null ? Math.round(sinceMs / 1000) : null;
  const sinceStr = sinceSec !== null
    ? sinceSec < 60 ? `${sinceSec}s ago`
    : sinceSec < 3600 ? `${Math.round(sinceSec / 60)}m ago`
    : `${Math.round(sinceSec / 3600)}h ago`
    : "never";

  if (consecutiveFailures >= 3) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-warning">
        <span className="size-1.5 rounded-full bg-warning" />
        Sync interrupted · Last success {sinceStr}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-success">
      <span className="size-1.5 rounded-full bg-success" />
      Synced {sinceStr}
    </span>
  );
}

function Agents({ identity }: { identity: WorkspaceIdentity }) {
  const [open, setOpen] = useState<StewardAgent | null>(null);
  const queryClient = useQueryClient();
  const queryKey = ["steward", "team", identity.organizationId];
  const read = useQuery({
    queryKey,
    queryFn: () => readStewardTeam(identity.organizationId),
  });

  const pauseAgent = useMutation({
    mutationFn: async ({ agentId, paused }: { agentId: string; paused: boolean }) =>
      setPaperclipAgentPausedFn({
        data: { organizationId: identity.organizationId, agentId, paused },
      }),
    onSuccess: (_, { paused }) => {
      toast.success(paused ? "Agent paused." : "Agent resumed.");
      queryClient.invalidateQueries({ queryKey });
      setOpen(null);
    },
    onError: (error: unknown) =>
      toast.error("Could not change agent state", {
        description: error instanceof Error ? error.message : "Paperclip did not respond.",
      }),
  });

  const agents = read.data?.agents;

  return (
    <div className="space-y-8">
      <StewardHero status={fathomStatusLine(read.data)} />
      <StewardTabs active="agents" />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl text-foreground">The agent workforce.</h2>
          <p className="mt-2 max-w-reading text-sm text-muted-foreground">
            Agents sit in the same accountability model as people, but they are not people. Paperclip
            owns their execution state.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SyncHealthPill syncHealth={agents?.syncHealth ?? null} />
          <button
            type="button"
            aria-label="Refresh agents"
            onClick={() => queryClient.invalidateQueries({ queryKey })}
            className="text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="size-4" />
          </button>
        </div>
      </div>

      {read.isError ? (
        <StewardUnavailable error={read.error} />
      ) : read.isLoading ? (
        <p className="text-sm text-muted-foreground">Reading the workforce…</p>
      ) : !agents || agents.agents.length === 0 ? (
        <div className="tt-surface p-8">
          <p className="font-display text-xl text-foreground">No agents to show.</p>
          <p className="mt-2 max-w-reading text-sm text-muted-foreground">
            {agents?.because ?? "Paperclip is not reachable from this workspace."}
          </p>
        </div>
      ) : (
        <>
          {!agents.connected ? (
            <p className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-foreground">
              {agents.because} What you see below is the registry, not live execution state.
            </p>
          ) : null}
          <ul className="space-y-3">
            {agents.agents.map((agent) => (
              <li key={agent.id} className="tt-surface p-5">
                <div className="flex flex-wrap items-start gap-4">
                  <span
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-full border text-royal",
                      agent.isPaused
                        ? "border-border bg-secondary"
                        : "border-royal/30 bg-royal/10",
                    )}
                  >
                    <Bot className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-lg text-foreground">{agent.name}</h3>
                      <MetaPill>AI agent</MetaPill>
                      <MetaPill>{AGENT_LIFECYCLE_LABEL[agent.lifecycle]}</MetaPill>
                      {agent.isPaused ? <MetaPill>Paused</MetaPill> : null}
                      {agent.pendingApprovals > 0 ? (
                        <MetaPill>{agent.pendingApprovals} pending approval</MetaPill>
                      ) : null}
                    </div>
                    <p className="mt-1 max-w-reading text-sm text-muted-foreground">
                      {agent.responsibility}
                    </p>
                    <p className="mt-2 text-sm text-foreground">
                      {agent.currentWork ?? "Nothing in progress right now."}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        {agent.activeTasks.length} active · {agent.awaitingApproval.length} awaiting
                        approval · {agent.completedThisWeek} completed this week
                      </p>
                      {agent.routines.length > 0 ? (
                        <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          <CheckCircle2 className="size-3" />
                          {agent.routines.length} routine{agent.routines.length !== 1 ? "s" : ""}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(agent)}
                    className="text-sm text-royal hover:underline"
                  >
                    Open agent
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {open ? (
        <AgentDetail
          agent={open}
          identity={identity}
          onClose={() => setOpen(null)}
          onPauseToggle={() =>
            pauseAgent.mutate({ agentId: open.paperclipAgentId, paused: !open.isPaused })
          }
        />
      ) : null}
    </div>
  );
}
