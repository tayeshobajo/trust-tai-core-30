import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { TTButton } from "@/components/tt/primitives";
import { listRecentEmail } from "@/data/comms-recent-email";
import { listIntegrations } from "@/data/supabase/comms-integrations";
import { gmailSync } from "@/data/supabase/comms-gmail";
import { readFailureMessage } from "@/domain/comms-section-state";
import {
  mailboxSyncLines,
  recentEmailRows,
  REPLY_STATE_LABEL,
  REPLY_STATE_NOTE,
  RECENT_EMAIL_PAGE,
  RECENT_EMAIL_WINDOW_DAYS,
  windowNote,
  type RecentEmailRow,
} from "@/domain/comms-recent-email";
import type { Relationship } from "@/domain/comms";
import type { WorkspaceIdentity } from "@/lib/workspace";

export function RecentEmail({
  identity,
  relationships,
}: {
  identity: WorkspaceIdentity;
  relationships: Relationship[];
}) {
  const [limit, setLimit] = useState(RECENT_EMAIL_PAGE * 4);

  const mail = useQuery({
    queryKey: ["comms", "recent-email", identity.organizationId, limit],
    queryFn: () => listRecentEmail(identity.organizationId, { limit }),
    // Coming back to the tab re-reads the store. It does not sync a mailbox.
    refetchOnWindowFocus: true,
  });

  const mailboxes = useQuery({
    queryKey: ["comms", "integrations", identity.organizationId],
    queryFn: () => listIntegrations(identity.organizationId),
  });

  const [shown, setShown] = useState(RECENT_EMAIL_PAGE);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const rows: RecentEmailRow[] = useMemo(
    () => recentEmailRows(mail.data?.messages ?? [], relationships),
    [mail.data?.messages, relationships],
  );
  const visible = rows.slice(0, shown);

  const connections = (mailboxes.data?.connections ?? []).filter(
    (connection) => connection.status === "connected" || connection.status === "error",
  );
  const lines = mailboxSyncLines(mailboxes.data?.connections ?? []);

  /* The same authorized pass Connections runs, nothing wider. Only after it
     finishes does the feed re-read, so "checked" never means "synced". */
  const sync = useMutation({
    mutationFn: async () => {
      const results = [] as { mailbox: string; ok: boolean; note: string }[];
      for (const connection of connections) {
        try {
          const result = await gmailSync(identity.organizationId, undefined, connection.id);
          results.push({
            mailbox: result.accountEmail ?? connection.accountEmail ?? "mailbox",
            ok: !result.partial,
            note: `${result.partial ? "Partial pass: " : ""}read ${result.messagesRead} messages in approved scope, stored ${result.messagesStored}`,
          });
        } catch (error) {
          results.push({
            mailbox: connection.accountEmail ?? "mailbox",
            ok: false,
            note: error instanceof Error ? error.message : "the read did not finish",
          });
        }
      }
      return results;
    },
    onSuccess: async (results) => {
      setSyncNote(
        results.length === 0
          ? "No mailbox is connected, so there was nothing to read."
          : results
              .map((result) => `${result.mailbox}: ${result.ok ? result.note : result.note}`)
              .join(" · "),
      );
      await Promise.all([mail.refetch(), mailboxes.refetch()]);
    },
  });

  const unavailable = mail.isError;
  const total = mail.data?.total ?? null;

  return (
    <section className="comms-card p-4 sm:p-5">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <h2 className="tt-title-card text-lg">Recent email</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            Labelled mail already read into Comms, newest first. Opening this page reads records
            only. It marks nothing as read. Gmail coverage is label-gated and sync passes are
            bounded. LinkedIn inbox coverage is not verified; manual LinkedIn records do not
            establish complete coverage.
          </p>
        </div>
        {unavailable || total === null ? null : (
          <span className="min-w-8 rounded-full bg-secondary px-2.5 py-1 text-center font-mono text-xs text-foreground">
            {total}
          </span>
        )}
      </header>

      <div className="mt-4">
        {unavailable ? (
          <div className="space-y-2">
            <p className="text-[13px] text-destructive">
              {readFailureMessage(mail.error)} Recent email is unavailable, so this is not an empty
              inbox.
            </p>
            <TTButton size="sm" variant="quiet" onClick={() => void mail.refetch()}>
              Try again
            </TTButton>
          </div>
        ) : mail.isPending ? (
          <p className="text-[13px] text-muted-foreground">Reading…</p>
        ) : rows.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No labelled mail in the last {RECENT_EMAIL_WINDOW_DAYS} days. Comms only sees Gmail
            threads someone labelled Trust Tai/Comms, so anything unlabelled is not missing, it was
            never in scope.
          </p>
        ) : (
          <>
            <ul>
              {visible.map((row) => (
                <li key={row.key}>
                  <Link
                    to="/modules/comms/relationships"
                    search={{
                      relationship: row.relationshipId,
                      ...(row.threadId ? { thread: row.threadId } : {}),
                      message: row.lastMessage.id,
                    }}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-t border-border px-1 py-3 first:border-t-0 hover:text-royal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="min-w-0 text-[13px] text-foreground">
                      <span className="font-medium">{row.personName}</span>
                      {row.companyName ? (
                        <span className="text-muted-foreground"> · {row.companyName}</span>
                      ) : null}
                      <span className="block truncate text-[13px] text-muted-foreground">
                        {row.subject}
                      </span>
                      <span className="block text-[12px] text-muted-foreground">
                        {REPLY_STATE_LABEL[row.replyState]}. {REPLY_STATE_NOTE[row.replyState]}
                        {row.mailbox ? ` Mailbox ${row.mailbox}.` : " Mailbox not recorded."}
                      </span>
                    </span>
                    <span className="whitespace-nowrap text-[12px] text-muted-foreground">
                      {new Date(row.lastActivityAt).toLocaleString()}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-muted-foreground">
              Showing {visible.length} of {rows.length} conversations read.{" "}
              {windowNote(mail.data?.windowDays ?? RECENT_EMAIL_WINDOW_DAYS, total ?? 0)}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {shown < rows.length ? (
                <TTButton
                  size="sm"
                  variant="quiet"
                  onClick={() => setShown((count) => count + RECENT_EMAIL_PAGE)}
                >
                  Show more
                </TTButton>
              ) : (mail.data?.messages.length ?? 0) >= (mail.data?.requested ?? 0) &&
                (total ?? 0) > (mail.data?.messages.length ?? 0) ? (
                <TTButton
                  size="sm"
                  variant="quiet"
                  onClick={() => setLimit((value) => value + RECENT_EMAIL_PAGE * 4)}
                  disabled={mail.isFetching}
                >
                  Read further back
                </TTButton>
              ) : null}
              <Link to="/modules/comms/relationships" className="text-[12px] underline">
                See all conversations
              </Link>
            </div>
          </>
        )}
      </div>

      <div className="mt-4 border-t border-border pt-3">
        <h3 className="text-[13px] font-medium text-foreground">Mailbox sync</h3>
        {mailboxes.isError ? (
          <p className="mt-1 text-[12px] text-destructive">
            The mailbox connections could not be read, so sync freshness is unknown.
          </p>
        ) : mailboxes.isPending ? (
          <p className="mt-1 text-[12px] text-muted-foreground">Reading…</p>
        ) : lines.length === 0 ? (
          <p className="mt-1 text-[12px] text-muted-foreground">
            No mailbox is connected, so nothing new can arrive.
          </p>
        ) : (
          <ul className="mt-1 space-y-1">
            {lines.map((line) => (
              <li key={line.integrationId} className="text-[12px] text-muted-foreground">
                <span className="text-foreground">{line.mailbox}</span> · {line.note}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <TTButton
            size="sm"
            variant="quiet"
            onClick={() => sync.mutate()}
            disabled={sync.isPending || connections.length === 0}
          >
            {sync.isPending ? "Reading mailboxes…" : "Sync mailboxes"}
          </TTButton>
          <Link to="/modules/comms/integrations" className="text-[12px] underline">
            Connections
          </Link>
        </div>
        {syncNote ? <p className="mt-2 text-[12px] text-muted-foreground">{syncNote}</p> : null}
      </div>
    </section>
  );
}
