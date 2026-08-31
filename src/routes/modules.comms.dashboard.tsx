/**
 * The Comms dashboard.
 *
 * One calm list of people: what they last said, how many of their messages
 * you have not opened, and the thread itself beside it. Closing a
 * conversation is a human decision recorded on the relationship — nothing is
 * archived automatically and nothing is ever sent from here.
 */

import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { AppShell } from "@/components/tt/app-shell";
import { CommsTabs } from "@/components/tt/comms/comms-tabs";
import { ScoutConversationLink } from "@/components/tt/comms/scout-link";
import { PageHeader, TTButton, TTInput } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { commsService } from "@/data/supabase/comms-service";
import {
  listWorkspaceMessages,
  markConversationRead,
  setConversationClosed,
} from "@/data/comms-dashboard";
import {
  conversationRows,
  filterCounts,
  FILTER_LABEL,
  FILTERS,
  inFilter,
  previewOf,
  whenLabel,
  type ConversationRow,
  type DashboardFilter,
} from "@/domain/comms-dashboard";
import type { StoredMailboxMessage } from "@/domain/comms-integrations";
import { cn } from "@/lib/utils";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Conversations · Comms · Trust Tai OS";
const DESCRIPTION =
  "Every person you are in conversation with: their last message, what you have not read, and the thread itself.";

export const Route = createFileRoute("/modules/comms/dashboard")({
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
  component: DashboardRoute,
});

function DashboardRoute() {
  return (
    <WorkspaceGate appId="comms">
      {(identity) => (
        <AppShell identity={identity}>
          <Dashboard identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function Dashboard({ identity }: { identity: WorkspaceIdentity }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<DashboardFilter>("open");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const relationships = useQuery({
    queryKey: ["comms", "dashboard", "relationships", identity.organizationId],
    queryFn: () => commsService.list(identity.organizationId),
  });

  const messages = useQuery({
    queryKey: ["comms", "dashboard", "messages", identity.organizationId],
    queryFn: () => listWorkspaceMessages(identity.organizationId),
  });

  const rows = useMemo(
    () => conversationRows(relationships.data ?? [], messages.data ?? {}),
    [relationships.data, messages.data],
  );
  const counts = useMemo(() => filterCounts(rows), [rows]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (!inFilter(row, filter)) return false;
      if (!needle) return true;
      const haystack = [
        row.relationship.fullName,
        row.relationship.companyName ?? "",
        row.relationship.email ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [rows, filter, query]);

  const selected =
    visible.find((row) => row.relationship.id === selectedId) ?? visible[0] ?? null;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["comms"] });
  };

  const open = useMutation({
    mutationFn: (row: ConversationRow) =>
      markConversationRead({
        relationship: row.relationship,
        organizationId: identity.organizationId,
        userId: identity.userId,
      }),
    onSuccess: invalidate,
  });

  const close = useMutation({
    mutationFn: ({ row, closed }: { row: ConversationRow; closed: boolean }) =>
      setConversationClosed({
        relationship: row.relationship,
        closed,
        organizationId: identity.organizationId,
        userId: identity.userId,
      }),
    onSuccess: (_data, variables) => {
      toast.success(variables.closed ? "Conversation closed" : "Conversation reopened", {
        description: variables.row.relationship.fullName,
      });
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const selectRow = (row: ConversationRow) => {
    setSelectedId(row.relationship.id);
    if (row.unreadCount > 0) open.mutate(row);
  };

  const loading = relationships.isLoading || messages.isLoading;
  const failure = relationships.error ?? messages.error;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Comms"
        title="Conversations"
        supporting="Who wrote last, what you have not read yet, and the thread beside it. Closing a conversation is your decision."
        appId="comms"
      />
      <CommsTabs active="dashboard" />

      {failure ? (
        <p className="text-sm text-destructive">
          {failure instanceof Error ? failure.message : "That read failed."}
        </p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Reading your conversations…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {FILTERS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setFilter(option)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-[12px] transition-colors",
                    option === filter
                      ? "border-[var(--royal)] text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {FILTER_LABEL[option]} · {counts[option]}
                </button>
              ))}
            </div>

            <TTInput
              className="h-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, company or email"
              aria-label="Search conversations"
            />

            <ul className="divide-y divide-border rounded-xl border border-border">
              {visible.length === 0 ? (
                <li className="p-4 text-sm text-muted-foreground">
                  Nothing in this view yet.
                </li>
              ) : (
                visible.map((row) => (
                  <li key={row.relationship.id}>
                    <button
                      type="button"
                      onClick={() => selectRow(row)}
                      className={cn(
                        "flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors",
                        row.relationship.id === selected?.relationship.id
                          ? "bg-secondary/60"
                          : "hover:bg-secondary/30",
                      )}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="truncate text-[14px] text-foreground">
                          {row.relationship.fullName}
                          {row.relationship.companyName ? (
                            <span className="text-muted-foreground">
                              {" "}
                              · {row.relationship.companyName}
                            </span>
                          ) : null}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {row.unreadCount > 0 ? (
                            <span
                              className="rounded-full bg-[var(--royal)] px-2 py-0.5 text-[11px] text-primary-foreground"
                              aria-label={`${row.unreadCount} unread`}
                            >
                              {row.unreadCount}
                            </span>
                          ) : null}
                          <span className="text-[12px] text-muted-foreground">
                            {whenLabel(row.lastMessage?.occurredAt ?? row.relationship.lastTouchAt)}
                          </span>
                        </span>
                      </span>
                      <span className="truncate text-[13px] text-muted-foreground">
                        {previewOf(row)}
                      </span>
                      {row.closedAt ? (
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          Closed
                        </span>
                      ) : null}
                    </button>
                    {row.relationship.prospectId ? (
                      <div className="px-4 pb-3">
                        <ScoutConversationLink relationship={row.relationship} />
                      </div>
                    ) : null}
                  </li>

                ))
              )}
            </ul>
          </section>

          <ThreadView
            row={selected}
            identity={identity}
            messages={selected ? (messages.data?.[selected.relationship.id] ?? []) : []}
            busy={close.isPending}
            onToggleClosed={(closed) => {
              if (selected) close.mutate({ row: selected, closed });
            }}
          />
        </div>
      )}
    </div>
  );
}

function ThreadView({
  row,
  identity,
  messages,
  busy,
  onToggleClosed,
}: {
  row: ConversationRow | null;
  identity: WorkspaceIdentity;
  messages: StoredMailboxMessage[];
  busy: boolean;
  onToggleClosed: (closed: boolean) => void;
}) {
  if (!row) {
    return (
      <section className="rounded-xl border border-border p-6 text-sm text-muted-foreground">
        Choose a person to read their thread.
      </section>
    );
  }

  const ordered = [...messages].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  );

  return (
    <section className="rounded-xl border border-border">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
        <div>
          <h2 className="text-[15px] text-foreground">{row.relationship.fullName}</h2>
          <p className="text-[13px] text-muted-foreground">
            {[row.relationship.companyName, row.relationship.email].filter(Boolean).join(" · ") ||
              "No company or email on record."}
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {row.messageCount} message{row.messageCount === 1 ? "" : "s"} on record
            {row.closedAt ? ` · closed ${whenLabel(row.closedAt)} ago` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <ScoutConversationLink relationship={row.relationship} />
            <TTButton
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => onToggleClosed(!row.closedAt)}
            >
              {busy
                ? "Saving…"
                : row.closedAt
                  ? "Reopen conversation"
                  : "Mark conversation closed"}
            </TTButton>
          </div>
          <MeetingFromMessage
            relationship={row.relationship}
            message={row.lastMessage}
            identity={identity}
          />
        </div>
      </header>

      <div className="max-h-[60vh] space-y-3 overflow-y-auto p-4">
        {ordered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No synced messages for this person yet.
          </p>
        ) : (
          ordered.map((message) => (
            <article
              key={message.id}
              className={cn(
                "rounded-lg border p-3",
                message.direction === "outbound"
                  ? "border-border bg-secondary/40"
                  : "border-[var(--cloud-line)] bg-background",
              )}
            >
              <p className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
                <span>
                  {message.direction === "outbound"
                    ? "You"
                    : (message.fromName ?? message.fromEmail ?? row.relationship.fullName)}
                </span>
                <span>{new Date(message.occurredAt).toLocaleString()}</span>
              </p>
              {message.subject ? (
                <p className="mt-1 text-[14px] text-foreground">{message.subject}</p>
              ) : null}
              <p className="mt-1 whitespace-pre-wrap text-[13px] text-muted-foreground">
                {message.bodyText ?? message.snippet ?? ""}
              </p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
