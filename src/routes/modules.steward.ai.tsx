import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/tt/app-shell";
import { TTButton } from "@/components/tt/primitives";
import { StewardTabs } from "@/components/tt/steward/steward-tabs";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { readAgentQueue } from "@/data/steward/agent-runs-read";
import { stewardTasks } from "@/data/supabase/steward-tasks";
import type { ManualTaskRecord, StewardAgentRun } from "@/domain/steward-accountability";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Steward · Trust Tai AI · Trust Tai OS";
const DESCRIPTION =
  "Queue internal preparation work for Trust Tai AI and see its progress, responses and evidence.";
const AGENT_ID = "trust-tai-internal";

export const Route = createFileRoute("/modules/steward/ai")({
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
  component: () => (
    <WorkspaceGate appId="steward">
      {(identity) => (
        <AppShell identity={identity}>
          <AgentPage identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  ),
});

const RUN_LABEL: Record<string, string> = {
  queued: "Queued",
  working: "Running",
  needs_approval: "Needs approval",
  blocked: "Blocked",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

function statusFor(task: ManualTaskRecord, run: StewardAgentRun | undefined): string {
  if (run) return RUN_LABEL[run.status] ?? run.status;
  if (task.status === "complete") return "Completed";
  if (task.status === "needs_approval") return "Needs approval";
  return "Queued";
}

function when(at: string | null | undefined) {
  return at ? new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not recorded";
}

async function startRun(organizationId: string, taskId: string) {
  const { runStewardAgentTask } = await import("@/data/steward-agent-runs.functions");
  return runStewardAgentTask({ data: { organizationId, taskId, agentId: AGENT_ID } });
}

function AgentPage({ identity }: { identity: WorkspaceIdentity }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const key = ["steward", "ai-queue", identity.organizationId];
  const read = useQuery({
    queryKey: key,
    queryFn: () => readAgentQueue(identity.organizationId),
    refetchInterval: (q) =>
      q.state.data?.runs.some((r) => r.status === "working" || r.status === "queued") ? 4000 : false,
  });

  const queue = useMutation({
    mutationFn: async (text: string) => {
      const task = await stewardTasks.create({
        organizationId: identity.organizationId,
        title: text,
        ...(context.trim() ? { notes: context.trim() } : {}),
        assigneeKind: "agent",
        status: "open",
        ...(identity.userId ? { createdBy: identity.userId } : {}),
      });
      try {
        await startRun(identity.organizationId, task.id);
        return { saved: true, started: true };
      } catch (e) {
        return { saved: true, started: false, because: e instanceof Error ? e.message : "" };
      }
    },
    onSuccess: (r) => {
      setTitle("");
      setContext("");
      if (r.started) toast.success("Queued for Trust Tai AI.");
      else toast.warning(`Task saved, but AI work did not start. ${r.because ?? ""}`.trim());
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "The task could not be saved."),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  const retry = useMutation({
    mutationFn: (taskId: string) => startRun(identity.organizationId, taskId),
    onSuccess: () => toast.success("AI work started."),
    onError: (e) => toast.error(e instanceof Error ? e.message : "AI work did not start."),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  const runByTask = new Map<string, StewardAgentRun>();
  for (const r of read.data?.runs ?? []) if (!runByTask.has(r.taskId)) runByTask.set(r.taskId, r);
  const canQueue = identity.canManage;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 md:px-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
          <Bot aria-hidden className="size-5" /> Trust Tai AI
        </h1>
        <p className="text-sm text-muted-foreground">
          {DESCRIPTION} It prepares internal work only; it never sends, publishes, prices or commits.
        </p>
      </header>
      <StewardTabs active="ai" />

      <form
        className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-5 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) queue.mutate(title.trim());
        }}
      >
        <label htmlFor="ai-task" className="sr-only">Task for Trust Tai AI</label>
        <input
          id="ai-task"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={!canQueue || queue.isPending}
          placeholder={canQueue ? "e.g. Summarise who to contact at Acumen and why" : "Only owners and admins can queue work"}
          className="flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          maxLength={300}
        />
        <label htmlFor="ai-context" className="sr-only">Context for the AI</label>
        <input
          id="ai-context"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          disabled={!canQueue || queue.isPending}
          placeholder="Context the AI may use (optional)"
          className="flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          maxLength={2000}
        />
        <TTButton type="submit" disabled={!canQueue || !title.trim()} pending={queue.isPending} pendingLabel="Queuing…">
          Queue
        </TTButton>
      </form>

      {read.data && !read.data.available && (
        <p className="rounded-lg bg-secondary px-3 py-2 text-sm text-muted-foreground">
          AI run history is not stored in this workspace yet. Tasks can be queued, but progress and
          responses cannot be saved until that storage is added.
        </p>
      )}
      {read.isPending && <p className="text-sm text-muted-foreground">Loading the queue…</p>}
      {read.isError && (
        <p role="alert" className="text-sm text-destructive">The queue could not be read right now.</p>
      )}
      {read.isSuccess && read.data.tasks.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing queued yet.</p>
      )}

      <ul className="space-y-3">
        {(read.data?.tasks ?? []).map((task) => {
          const run = runByTask.get(task.id);
          const status = statusFor(task, run);
          const expanded = open === task.id;
          return (
            <li key={task.id} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  className="text-left text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setOpen(expanded ? null : task.id)}
                  aria-expanded={expanded}
                >
                  {task.title}
                </button>
                <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-foreground">
                  {status}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Queued {when(task.createdAt)}
                {run?.settledAt ? ` · Finished ${when(run.settledAt)}` : ""}
              </p>
              {expanded && (
                <div className="mt-4 space-y-3 rounded-xl bg-secondary/50 p-4 text-sm">
                  {run?.artifact ? (
                    <p className="whitespace-pre-wrap text-foreground">{run.artifact}</p>
                  ) : (
                    <p className="text-muted-foreground">{run?.safeError ?? "No response recorded yet."}</p>
                  )}
                  {run && run.evidenceRefs.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Evidence: {run.evidenceRefs.join(", ")}
                    </p>
                  )}
                  {(!run || run.status === "failed") && canQueue && task.status !== "complete" && (
                    <TTButton size="sm" variant="secondary" pending={retry.isPending} onClick={() => retry.mutate(task.id)}>
                      {run ? "Try again" : "Start"}
                    </TTButton>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
