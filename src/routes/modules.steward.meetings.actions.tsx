/**
 * Steward, Meetings & Actions (draft).
 *
 * A person brings meeting deliverables from their own device. They are staged
 * in this browser tab only (sessionStorage) and never written anywhere.
 * Existing Steward tasks are read, not changed, to show what is already
 * tracked. Turning a staged item into a task is a later, separate step.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, CircleDashed, OctagonAlert, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/tt/app-shell";
import { MetaPill, TTButton } from "@/components/tt/primitives";
import { StewardTabs } from "@/components/tt/steward/steward-tabs";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { stewardTasks } from "@/data/supabase/steward-tasks";
import {
  ACTION_STATUS_LABEL,
  completeAction,
  correlationKeyFor,
  filterActions,
  isOverdue,
  parseMeetingActions,
  reopenAction,
  type ActionFilter,
  type StagedAction,
} from "@/domain/meeting-actions";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Steward · Meetings & Actions · Trust Tai OS";
const DESCRIPTION =
  "Stage meeting deliverables for review in this session, with owners, timing and evidence kept honest.";

export const Route = createFileRoute("/modules/steward/meetings/actions")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ActionsRoute,
});

const FILTERS: { id: ActionFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "proposed", label: "Proposed" },
  { id: "confirmed", label: "Confirmed" },
  { id: "blocked", label: "Blocked" },
  { id: "overdue", label: "Overdue" },
  { id: "complete", label: "Done" },
  { id: "unknown_owner", label: "Owner not named" },
];

function ActionsRoute() {
  return (
    <WorkspaceGate appId="steward">
      {(identity) => (
        <AppShell identity={identity}>
          <MeetingActions identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

interface Staged {
  sourceKey: string;
  items: StagedAction[];
}

function MeetingActions({ identity }: { identity: WorkspaceIdentity }) {
  const storageKey = `tt-meeting-actions:${identity.organizationId}:${identity.userId}`;
  const [staged, setStaged] = useState<Staged | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ActionFilter>("all");
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    const raw = window.sessionStorage.getItem(storageKey);
    if (raw) {
      try {
        setStaged(JSON.parse(raw) as Staged);
      } catch {
        window.sessionStorage.removeItem(storageKey);
      }
    }
  }, [storageKey]);

  useEffect(() => {
    if (staged) window.sessionStorage.setItem(storageKey, JSON.stringify(staged));
  }, [staged, storageKey]);

  const tasks = useQuery({
    queryKey: ["steward", "tasks", "meeting-crossref", identity.organizationId],
    queryFn: () => stewardTasks.list(identity.organizationId),
    enabled: Boolean(staged?.items.length),
  });
  const tracked = useMemo(
    () => new Set((tasks.data ?? []).map((t) => t.correlationId).filter(Boolean) as string[]),
    [tasks.data],
  );

  function stage(content: string, label: string) {
    try {
      const items = parseMeetingActions(content);
      if (items.length === 0) {
        setError("Nothing in that looked like an action. Use one bullet per item, or JSON.");
        return;
      }
      setStaged({ sourceKey: `${label}:${Date.now().toString(36)}`, items });
      setError(null);
    } catch {
      setError("That file could not be read. Check the JSON is valid.");
    }
  }

  function update(id: string, fn: (item: StagedAction) => StagedAction) {
    setStaged((s) => (s ? { ...s, items: s.items.map((i) => (i.id === id ? fn(i) : i)) } : s));
  }

  function clear() {
    window.sessionStorage.removeItem(storageKey);
    setStaged(null);
    setDraft("");
  }

  const items = staged?.items ?? [];
  const shown = filterActions(items, filter, today);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 md:px-6">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">Meetings & Actions</h1>
          <MetaPill>Draft · nothing saved</MetaPill>
        </div>
        <p className="text-sm text-muted-foreground">
          Bring what was agreed. It stays in this tab only and disappears when you close it.
        </p>
      </header>
      <StewardTabs active="meetings" />

      <section className="tt-surface space-y-3 p-5">
        <label className="block">
          <span className="tt-eyebrow">Paste deliverables</span>
          <textarea
            className="mt-2 min-h-28 w-full rounded-md border border-input bg-background p-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={"- Send the recap @Name due:2026-10-20\n- Book the follow-up due:next week"}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <TTButton type="button" disabled={!draft.trim()} onClick={() => stage(draft, "paste")}>
            Stage only
          </TTButton>
          <label className="cursor-pointer text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
            Or choose a file (.md, .txt, .json)
            <input
              type="file"
              accept=".md,.txt,.json,text/plain,text/markdown,application/json"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) stage(await file.text(), "file");
                e.target.value = "";
              }}
            />
          </label>
          {staged ? (
            <TTButton type="button" variant="quiet" onClick={clear}>
              Clear session
            </TTButton>
          ) : null}
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </section>

      {staged ? (
        <>
          <nav aria-label="Filter actions" className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={
                  "rounded-full border px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                  (filter === f.id
                    ? "border-foreground text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground")
                }
              >
                {f.label} · {filterActions(items, f.id, today).length}
              </button>
            ))}
          </nav>

          {shown.length === 0 ? (
            <p className="tt-surface p-6 text-sm text-muted-foreground">Nothing matches this filter.</p>
          ) : (
            <ul className="space-y-3">
              {shown.map((item) => (
                <ActionCard
                  key={item.id}
                  item={item}
                  today={today}
                  tracked={tracked.has(correlationKeyFor(staged.sourceKey, item.statement))}
                  onComplete={() => update(item.id, completeAction)}
                  onReopen={() => update(item.id, reopenAction)}
                />
              ))}
            </ul>
          )}
          <p className="text-[13px] text-muted-foreground">
            Turning these into Steward tasks is not switched on yet. Nothing here has been saved
            or shared.
          </p>
        </>
      ) : null}
    </div>
  );
}

function ActionCard({
  item,
  today,
  tracked,
  onComplete,
  onReopen,
}: {
  item: StagedAction;
  today: string;
  tracked: boolean;
  onComplete: () => void;
  onReopen: () => void;
}) {
  const done = item.status === "complete";
  const overdue = isOverdue(item, today);
  return (
    <li className={"tt-surface p-5 " + (done ? "border-l-4 border-l-success" : "")}>
      <div className="flex flex-wrap items-center gap-2">
        <MetaPill className={done ? "text-success" : ""}>
          {done ? (
            <Check aria-hidden className="mr-1 inline h-3 w-3" />
          ) : item.status === "blocked" ? (
            <OctagonAlert aria-hidden className="mr-1 inline h-3 w-3" />
          ) : (
            <CircleDashed aria-hidden className="mr-1 inline h-3 w-3" />
          )}
          {ACTION_STATUS_LABEL[item.status]}
        </MetaPill>
        {overdue ? <MetaPill className="text-destructive">Overdue</MetaPill> : null}
        {tracked ? <MetaPill>Already a Steward task</MetaPill> : null}
      </div>
      <p className={"mt-3 text-[15px] text-foreground " + (done ? "line-through decoration-1" : "")}>
        {item.statement}
      </p>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <Row label="Owner">{item.owner ?? "Owner not named"}</Row>
        <Row label="Due">
          {item.dueCertainty === "exact"
            ? item.dueDate
            : item.dueCertainty === "said"
              ? `Said “${item.dueText}”, not a date yet`
              : "No timing given"}
        </Row>
        <Row label="Next step">{item.nextStep ?? "Not recorded"}</Row>
        <Row label="Depends on">{item.dependsOn.length ? item.dependsOn.join(", ") : "Nothing recorded"}</Row>
        {item.status === "blocked" ? <Row label="Blocked because">{item.blockedBecause}</Row> : null}
        <Row label="Source">
          {[item.sourceTitle, item.sourceAt].filter(Boolean).join(" · ") || "Not recorded"}
        </Row>
      </dl>
      {item.quote ? (
        <blockquote className="mt-3 border-l-2 border-border pl-3 text-sm text-muted-foreground">
          “{item.quote}”
        </blockquote>
      ) : null}
      <div className="mt-4 border-t border-border pt-3">
        {done ? (
          <TTButton type="button" variant="quiet" onClick={onReopen}>
            <RotateCcw aria-hidden className="mr-1 h-4 w-4" /> Reopen
          </TTButton>
        ) : (
          <TTButton type="button" variant="quiet" onClick={onComplete}>
            <Check aria-hidden className="mr-1 h-4 w-4" /> Mark done (this session)
          </TTButton>
        )}
      </div>
    </li>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground pt-1">
        {label}
      </dt>
      <dd className="text-foreground">{children}</dd>
    </div>
  );
}
