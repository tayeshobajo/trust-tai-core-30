/**
 * The mailbox track: every connected Gmail account, one compact row each.
 *
 * Mailboxes own transport identity; relationships own memory. Several
 * mailboxes can be connected at once — each reads only the threads labeled
 * Trust Tai/Comms in its own account, and each sends only when a person
 * clicks Send on a draft they approved. Connecting another account never
 * replaces an existing one; disconnecting one leaves the others live.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { MetaPill, TTButton, TTCard } from "@/components/tt/primitives";
import { AmbientRule } from "@/components/tt/ambient";
import {
  gmailAuthorizeUrl,
  gmailDisconnect,
  gmailExchange,
  gmailStatus,
  gmailSync,
  type GmailSyncResult,
} from "@/data/supabase/comms-gmail";
import {
  GMAIL_SEND_SCOPE,
  INTEGRATION_STATUS_LABEL,
  readGmailRunSummary,
  type IntegrationConnection,
} from "@/domain/comms-integrations";

export function GmailConnection({
  organizationId,
  connections,
  provisioned,
}: {
  organizationId: string;
  /** Every Gmail connection row for this workspace (one per mailbox). */
  connections: IntegrationConnection[];
  provisioned: boolean;
}) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [sync, setSync] = useState<GmailSyncResult | null>(null);

  const status = useQuery({
    queryKey: ["comms", "gmail", "status"],
    queryFn: gmailStatus,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["comms", "integrations", organizationId] });

  const exchange = useMutation({
    mutationFn: (input: { code: string; state: string }) =>
      gmailExchange({ organizationId, ...input }),
    onSuccess: (result) => {
      setNotice(
        result.canSend
          ? `Connected ${result.accountEmail}. Comms reads its labeled mail and can send a draft when you click Send.`
          : `Connected ${result.accountEmail}. Reading labeled mail only — Google did not grant send access; reconnect to approve it.`,
      );
      void invalidate();
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "That connection failed."),
  });

  // Google sends the browser back here with a code. Complete the exchange
  // while signed in, then clear it out of the address bar.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const error = params.get("gmail_error");
    const code = params.get("gmail_code");
    const state = params.get("gmail_state");
    if (!error && !code) return;

    if (error) setFailure(error);
    if (code && state) exchange.mutate({ code, state });

    params.delete("gmail_error");
    params.delete("gmail_code");
    params.delete("gmail_state");
    const query = params.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
    // Runs once per callback landing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = useMutation({
    mutationFn: () => gmailAuthorizeUrl(organizationId),
    onSuccess: (url) => {
      window.location.href = url;
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "That connection could not start."),
  });

  const disconnectAction = useMutation({
    mutationFn: (integrationId: string) => gmailDisconnect(organizationId, integrationId),
    onSuccess: () => {
      setNotice("Mailbox disconnected. Nothing further is read from it.");
      setSync(null);
      void invalidate();
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "That disconnect failed."),
  });

  const readNow = useMutation({
    mutationFn: (integrationId: string) => gmailSync(organizationId, undefined, integrationId),
    onSuccess: (result) => {
      setSync(result);
      setFailure(null);
      void invalidate();
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "That read failed."),
  });

  const configured = status.data?.configured ?? false;
  const busy =
    connect.isPending || exchange.isPending || readNow.isPending || disconnectAction.isPending;

  return (
    <TTCard className="space-y-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-medium text-foreground">Mailbox</h3>
        <MetaPill>
          {connections.length > 0
            ? `${connections.length} connected`
            : INTEGRATION_STATUS_LABEL.disconnected}
        </MetaPill>
      </div>
      <AmbientRule appId="comms" contextAccent={null} />
      <p className="text-sm leading-relaxed text-muted-foreground">
        Label someone <span className="text-foreground">Trust Tai/Comms</span> in Gmail. Comms
        picks them up automatically — the label is your approval to bring that person in, and
        their labeled history comes with them. Unlabeled mail stays invisible to Comms. Nothing is
        ever sent on its own, and Comms cannot change your Gmail labels.
      </p>

      {connections.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {configured
            ? "Ready to connect. Google will ask you to allow reading labeled mail and sending the drafts you approve."
            : "Needs a Google OAuth client on the server."}
        </p>
      ) : (
        <ul className="space-y-3">
          {connections.map((connection) => (
            <MailboxRow
              key={connection.id}
              connection={connection}
              busy={busy}
              reading={readNow.isPending && readNow.variables === connection.id}
              connecting={connect.isPending || exchange.isPending}
              onReadNow={() => readNow.mutate(connection.id)}
              onReconnect={() => connect.mutate()}
              onDisconnect={() => disconnectAction.mutate(connection.id)}
            />
          ))}
        </ul>
      )}

      {!provisioned ? (
        <p className="text-xs text-muted-foreground">
          The integration tables are not in the workspace yet, so connecting is held until the
          schema is applied.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        <TTButton
          variant={connections.length > 0 ? "quiet" : "primary"}
          onClick={() => connect.mutate()}
          disabled={!configured || !provisioned || busy}
        >
          {connect.isPending || exchange.isPending
            ? "Connecting…"
            : connections.length > 0
              ? "+ Connect another Gmail account"
              : "Connect Gmail"}
        </TTButton>
      </div>

      {sync ? (
        <p className="text-xs text-muted-foreground">
          {sync.accountEmail ? `${sync.accountEmail}: ` : ""}read {sync.messagesRead} labeled
          messages, stored {sync.messagesStored} across {sync.relationshipsTouched} relationships
          {(sync.peopleAdded ?? 0) > 0
            ? `, added ${sync.peopleAdded} newly labeled ${
                sync.peopleAdded === 1 ? "person" : "people"
              } to Comms`
            : ""}
          .
          {(sync.pendingPeople ?? 0) > 0
            ? ` ${sync.pendingPeople} labeled ${
                (sync.pendingPeople ?? 0) === 1 ? "message needs" : "messages need"
              } your decision below.`
            : ""}
        </p>
      ) : null}

      {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
      {failure ? <p className="text-xs text-destructive">{failure}</p> : null}
    </TTCard>
  );
}

/** One connected Gmail account: who it is, what it may do, its controls. */
function MailboxRow({
  connection,
  busy,
  reading,
  connecting,
  onReadNow,
  onReconnect,
  onDisconnect,
}: {
  connection: IntegrationConnection;
  busy: boolean;
  reading: boolean;
  connecting: boolean;
  onReadNow: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
}) {
  const connected = connection.status === "connected";
  // Whether the persisted grant includes send. An older read-only connection
  // stays fully functional for reading; reconnecting upgrades the grant.
  const canSend = connection.scopes.includes(GMAIL_SEND_SCOPE);
  // The persisted summary of the last pass on this mailbox — visible even
  // when nobody has pressed "Read now" this session.
  const lastRun = readGmailRunSummary(connection.cursor);

  const exceptions = readIntakeExceptions(connection.cursor);

  return (
    <li className="space-y-2 border-t border-border pt-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {connection.accountEmail ?? "Gmail account"}
          </p>
          <p className="text-xs text-muted-foreground">
            {connected ? "Watching Trust Tai/Comms" : INTEGRATION_STATUS_LABEL[connection.status]}
            {connected ? (canSend ? " · can send" : " · read-only grant") : ""}
            {connection.lastSyncAt
              ? ` · last checked ${new Date(connection.lastSyncAt).toLocaleString()}`
              : " · not checked yet"}
          </p>
        </div>
      </div>

      {connected ? (
        <p className="text-xs text-muted-foreground">
          New labeled people are added to Comms automatically, every few hours.
        </p>
      ) : null}

      {lastRun ? (
        <p className="text-xs text-muted-foreground">
          Last pass {new Date(lastRun.at).toLocaleString()}: read {lastRun.messagesRead} labeled,
          stored {lastRun.messagesStored}
          {lastRun.peopleAdded > 0
            ? `, added ${lastRun.peopleAdded} ${lastRun.peopleAdded === 1 ? "person" : "people"}`
            : ""}
          , emitted {lastRun.eventsEmitted} events, verified {lastRun.draftsVerified} sent.
        </p>
      ) : null}

      {exceptions.length > 0 ? (
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
          <p className="text-xs font-medium text-foreground">
            Needs your decision ({exceptions.length})
          </p>
          <ul className="space-y-2">
            {exceptions.slice(0, 5).map((exception) => (
              <li key={exception.providerMessageId} className="text-xs text-muted-foreground">
                <span className="text-foreground">
                  {exception.subject?.trim() || "A labeled thread"}
                </span>{" "}
                — {exception.emails.join(", ")}.{" "}
                {exception.reason === "ambiguous_thread"
                  ? "More than one person is on this labeled thread, so Comms did not guess who it belongs to. Label the individual thread with that person, or add them by hand."
                  : `${exception.detail ?? "That relationship could not be created."} Sync now to try again.`}
              </li>
            ))}
          </ul>
          {exceptions.length > 5 ? (
            <p className="text-xs text-muted-foreground">
              …and {exceptions.length - 5} more.
            </p>
          ) : null}
        </div>
      ) : null}

      {connected && !canSend ? (
        <p className="text-xs text-muted-foreground">
          This mailbox was granted read-only access, so Send stays off for it. Reconnect to approve
          sending — Google keeps the existing reading access.
        </p>
      ) : null}

      {connection.lastError ? (
        <p className="text-xs text-destructive">{connection.lastError}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {connected ? (
          <TTButton variant="quiet" onClick={onReadNow} disabled={busy}>
            {reading ? "Checking…" : "Sync now (optional)"}
          </TTButton>
        ) : null}
        {!canSend ? (
          <TTButton variant="quiet" onClick={onReconnect} disabled={busy}>
            {connecting ? "Reconnecting…" : "Reconnect with send access"}
          </TTButton>
        ) : null}
        <TTButton variant="quiet" onClick={onDisconnect} disabled={busy}>
          Disconnect
        </TTButton>
      </div>
    </li>
  );
}

