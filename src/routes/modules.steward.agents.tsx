/**
 * Steward, Agents.
 *
 * The Paperclip workforce, in human language. Steward reads execution state
 * and never claims a completion Paperclip has not reported.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bot, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/tt/app-shell";
import { MetaPill } from "@/components/tt/primitives";
import { StewardHero } from "@/components/tt/steward/steward-hero";
import { StewardTabs } from "@/components/tt/steward/steward-tabs";
import { StewardUnavailable } from "@/components/tt/steward/unavailable";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { fathomStatusLine, readStewardTeam } from "@/data/steward/team-read";
import {
  AGENT_LIFECYCLE_LABEL,
  type StewardAgent,
} from "@/domain/steward-accountability";
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
    <WorkspaceGate>
      {(identity) => (
        <AppShell identity={identity}>
          <Agents identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function AgentDetail({ agent, onClose }: { agent: StewardAgent; onClose: () => void }) {
  return (
    <Sheet open onOpenChange={(open) => (open ? null : onClose())}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="space-y-3 text-left">
          <p className="tt-eyebrow">AI agent</p>
          <SheetTitle className="font-display text-2xl text-foreground">{agent.name}</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <div className="flex flex-wrap gap-2">
            <MetaPill>{AGENT_LIFECYCLE_LABEL[agent.lifecycle]}</MetaPill>
            <MetaPill>{agent.owningApp}</MetaPill>
            {agent.lastHeartbeatAt ? (
              <MetaPill>Heartbeat {agent.lastHeartbeatAt.slice(0, 16).replace("T", " ")}</MetaPill>
            ) : null}
          </div>

          <section className="space-y-2 border-t border-border pt-5">
            <p className="tt-eyebrow">Responsibility</p>
            <p className="max-w-reading text-sm text-foreground">{agent.responsibility}</p>
          </section>

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

          <section className="space-y-2 border-t border-border pt-5">
            <p className="tt-eyebrow">Current work</p>
            <p className="text-sm text-foreground">
              {agent.currentWork ?? "Nothing in progress right now."}
            </p>
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

          <section className="space-y-2 border-t border-border pt-5">
            <p className="tt-eyebrow">Waiting for approval</p>
            {agent.awaitingApproval.length > 0 ? (
              <ul className="space-y-1 text-sm text-foreground">
                {agent.awaitingApproval.map((task) => (
                  <li key={task.id}>{task.title}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing is waiting on a human.</p>
            )}
          </section>

          <section className="space-y-2 border-t border-border pt-5">
            <p className="tt-eyebrow">Recent outcomes</p>
            <p className="text-sm text-foreground">
              {agent.completedThisWeek} completed this week
              {agent.recentOutcome ? `. Most recent: ${agent.recentOutcome}.` : "."}
            </p>
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

function Agents({ identity }: { identity: WorkspaceIdentity }) {
  const [open, setOpen] = useState<StewardAgent | null>(null);
  const read = useQuery({
    queryKey: ["steward", "team", identity.organizationId],
    queryFn: () => readStewardTeam(identity.organizationId),
  });

  const agents = read.data?.agents;

  return (
    <div className="space-y-8">
      <StewardHero status={fathomStatusLine(read.data)} />
      <StewardTabs active="agents" />

      <div>
        <h2 className="font-display text-2xl text-foreground">The agent workforce.</h2>
        <p className="mt-2 max-w-reading text-sm text-muted-foreground">
          Agents sit in the same accountability model as people, but they are not people. Paperclip
          owns their execution state.
        </p>
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
                  <span className="flex h-10 w-10 items-center justify-center rounded-full border border-royal/30 bg-royal/10 text-royal">
                    <Bot className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-lg text-foreground">{agent.name}</h3>
                      <MetaPill>AI agent</MetaPill>
                      <MetaPill>{AGENT_LIFECYCLE_LABEL[agent.lifecycle]}</MetaPill>
                    </div>
                    <p className="mt-1 max-w-reading text-sm text-muted-foreground">
                      {agent.responsibility}
                    </p>
                    <p className="mt-2 text-sm text-foreground">
                      {agent.currentWork ?? "Nothing in progress right now."}
                    </p>
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {agent.activeTasks.length} active · {agent.awaitingApproval.length} awaiting
                      approval · {agent.completedThisWeek} completed this week
                    </p>
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

      {open ? <AgentDetail agent={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
