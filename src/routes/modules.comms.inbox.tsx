/**
 * The labeled inbox.
 *
 * Only the Gmail conversations a person labeled `Trust Tai/Comms` are on
 * record in Comms, and this is the room that reads them the way a mailbox
 * does: one row per conversation, the thread beside it, and a reply box under
 * each message so an answer never needs another screen.
 *
 * Replying is one human act. What is typed is what leaves, into the same
 * thread it answers.
 */

import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { AppShell } from "@/components/tt/app-shell";
import { CommsTabs } from "@/components/tt/comms/comms-tabs";
import { MeetingFromMessage } from "@/components/tt/comms/meeting-from-message";
import { ScoutConversationLink } from "@/components/tt/comms/scout-link";
import { PageHeader, TTButton, TTInput } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { listWorkspaceMessages, markConversationRead } from "@/data/comms-dashboard";
import { sendQuickReply } from "@/data/comms-quick-reply";
import { commsService } from "@/data/supabase/comms-service";
import { whenLabel } from "@/domain/comms-dashboard";
import {
  inboxScopeCounts,
  inInboxScope,
  INBOX_SCOPE_LABEL,
  INBOX_SCOPES,
  labeledThreads,
  matchesInboxSearch,
  replySubject,
  waitingOnYou,
  type InboxScope,
  type LabeledThread,
} from "@/domain/comms-labeled-inbox";
import type { StoredMailboxMessage } from "@/domain/comms-integrations";
import { cn } from "@/lib/utils";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Inbox · Comms · Trust Tai OS";
const DESCRIPTION =
  "Every Gmail thread you labeled Trust Tai/Comms, with a quick reply under each message.";

export const Route = createFileRoute("/modules/comms/inbox")({
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
  component: InboxRoute,
});

function InboxRoute() {
  return (
    <WorkspaceGate appId="comms">
      {(identity) => (
        <AppShell identity={identity}>
          <Inbox identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function Inbox({ identity }: { identity: WorkspaceIdentity }) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<InboxScope>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const relationships = useQuery({
    queryKey: ["comms", "inbox", "relationships", identity.organizationId],
    queryFn: () => commsService.list(identity.organizationId),
  });

  const messages = useQuery({
    queryKey: ["comms", "inbox", "messages", identity.organizationId],
    queryFn: () => listWorkspaceMessages(identity.organizationId),
  });

  const threads = useMemo(
    () => labeledThreads(relationships.data ?? [], messages.data ?? {}),
    [relationships.data, messages.data],
  );
  const counts = useMemo(() => inboxScopeCounts(threads), [threads]);

  const visible = useMemo(
    () =>
      threads.filter(
        (thread) => inInboxScope(thread, scope) && matchesInboxSearch(thread, query),
      ),
    [threads, scope, query],
  );

  const selected = visible.find((thread) => thread.threadId === selectedId) ?? visible[0] ?? null;

  const open = useMutation({
    mutationFn: (thread: LabeledThread) =>
      markConversationRead({
        relationship: thread.relationship,
        organizationId: identity.organizationId,
        userId: identity.userId,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["comms"] }),
  });

  const loading = relationships.isLoading || messages.isLoading;
  const failure = relationships.error ?? messages.error;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Comms"
        title="Inbox"
        supporting="Only the threads you labeled Trust Tai/Comms in Gmail. Read them here, reply here, and plan the meeting from the message itself."
        appId="comms"
      />
      <CommsTabs active="inbox" />

      {failure ? (
        <p className="text-sm text-destructive">
          {failure instanceof Error ? failure.message : "That read failed."}
        </p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Reading your labeled threads…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {INBOX_SCOPES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setScope(option)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-[12px] transition-colors",
                    option === scope
                      ? "border-[var(--royal)] text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {INBOX_SCOPE_LABEL[option]} · {counts[option]}
                </button>
              ))}
            </div>

            <TTInput
              className="h-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by person, company or subject"
              aria-label="Search labeled threads"
            />

            <ul className="divide-y divide-border rounded-xl border border-border">
              {visible.length === 0 ? (
                <li className="p-4 text-sm text-muted-foreground">
                  No labeled threads in this view yet. Apply the Gmail label{" "}
                  <span className="text-foreground">Trust Tai/Comms</span> to a conversation and it
                  arrives here on the next sync.
                </li>
              ) : (
                visible.map((thread) => (
                  <li key={thread.threadId}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(thread.threadId);
                        if (thread.unreadCount > 0) open.mutate(thread);
                      }}
                      className={cn(
                        "flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors",
                        thread.threadId === selected?.threadId
                          ? "bg-secondary/60"
                          : "hover:bg-secondary/30",
                      )}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="truncate text-[14px] text-foreground">
                          {thread.relationship.fullName}
                          {thread.relationship.companyName ? (
                            <span className="text-muted-foreground">
                              {" "}
                              · {thread.relationship.companyName}
                            </span>
                          ) : null}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {thread.unreadCount > 0 ? (
                            <span
                              className="rounded-full bg-[var(--royal)] px-2 py-0.5 text-[11px] text-primary-foreground"
                              aria-label={`${thread.unreadCount} unread`}
                            >
                              {thread.unreadCount}
                            </span>
                          ) : null}
                          <span className="text-[12px] text-muted-foreground">
                            {whenLabel(thread.lastActivityAt)}
                          </span>
                        </span>
                      </span>
                      <span className="truncate text-[13px] text-foreground/80">
                        {thread.subject}
                      </span>
                      <span className="truncate text-[12px] text-muted-foreground">
                        {waitingOnYou(thread) ? "They wrote last." : "You wrote last."}{" "}
                        {thread.messages.length} message
                        {thread.messages.length === 1 ? "" : "s"}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </section>

          <ThreadPanel thread={selected} identity={identity} />
        </div>
      )}
    </div>
  );
}

function ThreadPanel({
  thread,
  identity,
}: {
  thread: LabeledThread | null;
  identity: WorkspaceIdentity;
}) {
  if (!thread) {
    return (
      <section className="rounded-xl border border-border p-6 text-sm text-muted-foreground">
        Choose a labeled thread to read it.
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
        <div>
          <h2 className="text-[15px] text-foreground">{thread.subject}</h2>
          <p className="text-[13px] text-muted-foreground">
            {[
              thread.relationship.fullName,
              thread.relationship.companyName,
              thread.relationship.email,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {thread.mailbox ? (
            <p className="mt-1 text-[12px] text-muted-foreground">
              Labeled in {thread.mailbox}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          <ScoutConversationLink relationship={thread.relationship} />
          <MeetingFromMessage
            relationship={thread.relationship}
            message={thread.lastMessage}
            identity={identity}
          />
        </div>
      </header>

      <div className="max-h-[65vh] space-y-3 overflow-y-auto p-4">
        {thread.messages.map((message) => (
          <MessageCard
            key={message.id}
            thread={thread}
            message={message}
            identity={identity}
          />
        ))}
      </div>
    </section>
  );
}

function MessageCard({
  thread,
  message,
  identity,
}: {
  thread: LabeledThread;
  message: StoredMailboxMessage;
  identity: WorkspaceIdentity;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");

  const reply = useMutation({
    mutationFn: () =>
      sendQuickReply({
        relationship: thread.relationship,
        providerThreadId: thread.threadId,
        subject: replySubject(thread),
        body,
        context: { organizationId: identity.organizationId, userId: identity.userId },
      }),
    onSuccess: (outcome) => {
      if (outcome.state === "sent") {
        toast.success("Reply sent", { description: thread.relationship.fullName });
        setOpen(false);
        setBody("");
        void queryClient.invalidateQueries({ queryKey: ["comms"] });
        return;
      }
      if (outcome.state === "blocked") {
        toast.error("Gmail has not granted Comms permission to send yet.", {
          description: "Connect the mailbox with send permission in Connections.",
        });
        return;
      }
      toast.error(outcome.error ?? "That reply did not leave.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <article
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
            : (message.fromName ?? message.fromEmail ?? thread.relationship.fullName)}
        </span>
        <span>{new Date(message.occurredAt).toLocaleString()}</span>
      </p>
      {message.subject ? (
        <p className="mt-1 text-[14px] text-foreground">{message.subject}</p>
      ) : null}
      <p className="mt-1 whitespace-pre-wrap text-[13px] text-muted-foreground">
        {message.bodyText ?? message.snippet ?? ""}
      </p>

      {open ? (
        <div className="mt-3 space-y-2">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={5}
            aria-label={`Reply to ${thread.relationship.fullName}`}
            placeholder={`Reply to ${thread.relationship.fullName}…`}
            className="w-full rounded-lg border border-input bg-card px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-[12px] text-muted-foreground">
            Sends into this thread as {replySubject(thread) || "no subject"}. What you see is
            exactly what leaves.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <TTButton
              size="sm"
              disabled={reply.isPending || !body.trim()}
              onClick={() => reply.mutate()}
            >
              {reply.isPending ? "Sending…" : "Send reply"}
            </TTButton>
            <TTButton variant="quiet" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </TTButton>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          <TTButton variant="secondary" size="sm" onClick={() => setOpen(true)}>
            Reply
          </TTButton>
        </div>
      )}
    </article>
  );
}
