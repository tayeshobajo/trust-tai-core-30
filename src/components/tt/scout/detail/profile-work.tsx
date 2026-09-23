import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Check } from "lucide-react";
import { useState } from "react";

import { readAgentRuns } from "@/data/steward/agent-runs-read";
import { stewardTasks } from "@/data/supabase/steward-tasks";
import { linkedProspectId } from "@/domain/steward-agent-people";
import type { ManualTaskRecord, StewardAgentRun } from "@/domain/steward-accountability";

const RUN_LABEL: Record<string, string> = {
  queued: "Queued",
  working: "Running",
  needs_approval: "Needs approval",
  blocked: "Blocked",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function tasksForProspect(tasks: ManualTaskRecord[], prospectId: string) {
  return tasks.filter((t) => linkedProspectId(t) === prospectId);
}

/**
 * The company's own work: every task exactly linked to this Scout profile,
 * the AI teammate's runs on them, and a small box to ask the AI about this
 * company. The AI answers only from this company's saved records.
 */
export function ProfileWork(props: { organizationId: string; userId: string; prospectId: string; companyName: string }) {
  const qc = useQueryClient();
  const [question, setQuestion] = useState("");
  const key = ["scout", "profile-work", props.organizationId, props.prospectId];
  const read = useQuery({
    queryKey: key,
    queryFn: async () => {
      const [tasks, runs] = await Promise.all([
        stewardTasks.list(props.organizationId),
        readAgentRuns(props.organizationId).catch(() => ({ available: false, runs: [] as StewardAgentRun[] })),
      ]);
      return { tasks: tasksForProspect(tasks, props.prospectId), ...runs };
    },
  });

  const ask = useMutation({
    mutationFn: async (q: string) => {
      const task = await stewardTasks.create({
        organizationId: props.organizationId,
        title: `About ${props.companyName}: ${q.trim().slice(0, 160)}`,
        notes: q.trim(),
        assigneeKind: "agent",
        ownerLabel: "Trust Tai AI",
        priority: "normal",
        status: "open",
        createdBy: props.userId,
        sourceApp: "scout",
        sourceEntityType: "prospect",
        sourceEntityId: props.prospectId,
        correlationId: `scout:prospect:${props.prospectId}:question:${Date.now()}`,
      });
      try {
        const { runStewardAgentTask } = await import("@/data/steward-agent-runs.functions");
        await runStewardAgentTask({ data: { organizationId: props.organizationId, taskId: task.id, agentId: "trust-tai-internal" } });
        return { started: true as const };
      } catch (error) {
        return { started: false as const, because: error instanceof Error ? error.message : "AI work did not start." };
      }
    },
    onSettled: () => {
      setQuestion("");
      void qc.invalidateQueries({ queryKey: key });
    },
  });

  const runsByTask = new Map<string, StewardAgentRun>();
  for (const r of read.data?.runs ?? []) if (!runsByTask.has(r.taskId)) runsByTask.set(r.taskId, r);

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-5" aria-labelledby="profile-work-title">
      <div>
        <h2 id="profile-work-title" className="text-base font-semibold text-foreground">Work on {props.companyName}</h2>
        <p className="text-sm text-muted-foreground">Tasks linked to this company, and what the AI teammate did on them.</p>
      </div>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim()) ask.mutate(question);
        }}
      >
        <label className="sr-only" htmlFor="ask-company">Ask about this company</label>
        <input
          id="ask-company"
          className="min-w-0 flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm"
          placeholder="Ask about this company, e.g. who should we contact first?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" disabled={ask.isPending || !question.trim()} className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {ask.isPending ? "Asking…" : "Ask AI"}
        </button>
      </form>
      {ask.data && !ask.data.started && (
        <p role="status" className="text-xs text-muted-foreground">Question saved as a task, but AI work did not start: {ask.data.because}</p>
      )}
      {ask.isError && <p role="alert" className="text-xs text-destructive">The question could not be saved.</p>}

      {read.isPending && <p className="text-sm text-muted-foreground">Loading work…</p>}
      {read.isError && <p className="text-sm text-muted-foreground">Tasks can't be read right now.</p>}
      {read.data && !read.data.available && (
        <p className="text-xs text-muted-foreground">AI run history isn't stored in this workspace yet.</p>
      )}
      {read.data && read.data.tasks.length === 0 && <p className="text-sm text-muted-foreground">No tasks linked to this company yet.</p>}
      <ul className="space-y-3">
        {read.data?.tasks.map((t) => {
          const run = runsByTask.get(t.id);
          const done = t.status === "complete";
          return (
            <li key={t.id} className="rounded-lg border border-border p-3">
              <p className={done ? "flex items-center gap-2 text-sm text-muted-foreground line-through" : "text-sm text-foreground"}>
                {done && <Check aria-label="Completed" className="size-4 text-foreground no-underline" />}
                {t.title}
              </p>
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                {t.assigneeKind === "agent" && <Bot aria-hidden className="size-3" />}
                {t.assigneeKind === "agent" ? "Trust Tai AI" : t.ownerLabel ?? "Owner not recorded"}
                {" · "}
                {run ? RUN_LABEL[run.status] ?? run.status : done ? "Completed" : t.status === "needs_approval" ? "Needs approval" : "Open"}
              </p>
              {run?.artifact && <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{run.artifact}</p>}
              {run?.safeError && <p className="mt-2 text-xs text-muted-foreground">{run.safeError}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
