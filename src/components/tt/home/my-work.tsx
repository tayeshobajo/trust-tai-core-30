/**
 * The first thing a person sees at Home: their own work, in three plain lists.
 *
 * Every row states what it is, why it is here, who owns it and one action that
 * actually opens the owning room. Nothing is counted that was not read: a
 * source that could not be read is named as unreadable rather than shown as an
 * empty list, because "nothing to do" and "we could not look" are different
 * facts.
 *
 * Work with no current owner is not hidden. A lead sees it in a separate
 * exceptions card so it can be assigned instead of quietly forgotten.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ChevronDown } from "lucide-react";

import { loadDailyWorkspace, type WorkspaceSourceRead } from "@/data/daily-workspace";
import {
  buildWorkspace,
  mayResolveOwnership,
  OWNERSHIP_EXCEPTION_LABEL,
  peopleFromMemberships,
  type WorkItem,
  type WorkspaceRole,
} from "@/domain/daily-workspace";
import type { WorkspaceIdentity } from "@/lib/workspace";
import { cn } from "@/lib/utils";

const CARD = "rounded-2xl border border-border bg-card p-5 md:p-6";

function role(identity: WorkspaceIdentity): WorkspaceRole {
  const value = identity.role;
  return value === "owner" || value === "admin" ? value : "member";
}

function whenItMatters(item: WorkItem): string {
  if (!item.dueAt) return "No date recorded";
  return `Due ${new Date(item.dueAt).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  })}`;
}

function Row({ item, showOwner }: { item: WorkItem; showOwner: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="border-t border-border/70 py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-foreground">{item.title}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">{item.because}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {showOwner ? `${item.ownerName} · ` : ""}
            {whenItMatters(item)}
          </p>
          {item.ownership !== "assigned" ? (
            <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[12px] font-medium text-warning-foreground">
              <AlertTriangle className="size-3" aria-hidden />
              {item.ownership === "unassigned"
                ? OWNERSHIP_EXCEPTION_LABEL
                : "The owner has left this workspace"}
            </p>
          ) : null}
        </div>

        <Link
          to={item.verb.href}
          className="rounded-full bg-primary px-4 py-1.5 text-[13px] font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {item.verb.verb}
        </Link>
      </div>

      {item.preparedDetail ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 text-[13px] text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ChevronDown className={cn("size-3.5", open && "rotate-180")} aria-hidden />
            {open ? "Hide what was prepared" : "See what was prepared"}
          </button>
          {open ? (
            <p className="mt-2 rounded-xl bg-muted/50 p-3 text-[13px] text-foreground">
              {item.preparedDetail}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Unreadable({ sources }: { sources: WorkspaceSourceRead[] }) {
  const failed = sources.filter((source) => source.result.state === "unreadable");
  if (failed.length === 0) return null;

  return (
    <div className={cn(CARD, "border-warning/40")}>
      <p className="text-[15px] font-medium text-foreground">Some work could not be read</p>
      <ul className="mt-2 space-y-1">
        {failed.map((source) => (
          <li key={source.id} className="text-[13px] text-muted-foreground">
            {source.result.state === "unreadable" ? source.result.because : null}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12px] text-muted-foreground">
        The lists below are therefore incomplete. They are not a full picture of your work.
      </p>
    </div>
  );
}

export function MyWork({ identity }: { identity: WorkspaceIdentity }) {
  const viewerRole = role(identity);
  const mayLead = mayResolveOwnership(viewerRole);
  const [view, setView] = useState<"personal" | "team">("personal");

  const read = useQuery({
    queryKey: ["daily-workspace", identity.organizationId],
    queryFn: () => loadDailyWorkspace(identity.organizationId),
  });

  const workspace = useMemo(() => {
    if (!read.data) return null;
    return buildWorkspace({
      items: read.data.items,
      people: peopleFromMemberships(read.data.people, identity.organizationId),
      viewerId: identity.userId,
      viewerRole,
      view,
    });
  }, [read.data, identity.organizationId, identity.userId, viewerRole, view]);

  return (
    <section aria-labelledby="my-work" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="my-work" className="text-lg font-semibold text-foreground">
          Your work
        </h2>
        {mayLead ? (
          <div className="inline-flex rounded-full border border-border p-0.5" role="group">
            {(["personal", "team"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={view === option}
                onClick={() => setView(option)}
                className={cn(
                  "rounded-full px-3 py-1 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  view === option
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground",
                )}
              >
                {option === "personal" ? "Mine" : "Everyone"}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {read.isPending ? (
        <div className={CARD}>
          <p className="text-[13px] text-muted-foreground">Reading your work.</p>
        </div>
      ) : null}

      {read.isError ? (
        <div className={cn(CARD, "border-warning/40")}>
          <p className="text-[15px] font-medium text-foreground">Your work could not be read</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {(read.error as Error).message}
          </p>
        </div>
      ) : null}

      {read.data ? <Unreadable sources={read.data.sources} /> : null}

      {workspace ? (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            {workspace.lists.map((list) => (
              <div key={list.group} className={CARD}>
                <p className="text-[15px] font-semibold text-foreground">{list.label}</p>
                {list.items.length === 0 ? (
                  <p className="mt-2 text-[13px] text-muted-foreground">{list.emptyState}</p>
                ) : (
                  <ul className="mt-3">
                    {list.items.map((item) => (
                      <Row key={item.id} item={item} showOwner={view === "team"} />
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          {workspace.exceptions.length > 0 ? (
            <div className={cn(CARD, "border-warning/40")}>
              <p className="text-[15px] font-semibold text-foreground">
                Work waiting for an owner
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                This is real work that nobody currently holds. Assign it so it does not stall.
              </p>
              <ul className="mt-3">
                {workspace.exceptions.map((item) => (
                  <Row key={item.id} item={item} showOwner />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
