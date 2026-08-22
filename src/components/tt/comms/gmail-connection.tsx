/**
 * The mailbox track, with its one honest control.
 *
 * Connect opens Google's own consent screen for read-only access. Read now
 * runs one bounded pass and reports exactly what it read, what it stored, and
 * what it left alone because the person is not in Comms yet. Nothing here can
 * send.
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
  INTEGRATION_STATUS_LABEL,
  readGmailRunSummary,
  type IntegrationConnection,
} from "@/domain/comms-integrations";

export function GmailConnection({
  organizationId,
  connection,
  provisioned,
}: {
  organizationId: string;
  connection: IntegrationConnection | null;
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
      setNotice(`Connected ${result.accountEmail}. Read-only.`);
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
    mutationFn: () => gmailDisconnect(organizationId),
    onSuccess: () => {
      setNotice("Mailbox disconnected. Nothing further is read.");
      setSync(null);
      void invalidate();
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "That disconnect failed."),
  });

  const readNow = useMutation({
    mutationFn: () => gmailSync(organizationId),
    onSuccess: (result) => {
      setSync(result);
      setFailure(null);
      void invalidate();
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "That read failed."),
  });

  const configured = status.data?.configured ?? false;
  const connected = connection?.status === "connected";
  // The persisted summary of the last pass — visible even when nobody has
  // pressed "Read now" this session.
  const lastRun = connection ? readGmailRunSummary(connection.cursor) : null;
  const busy =
    connect.isPending || exchange.isPending || readNow.isPending || disconnectAction.isPending;

  return (
    <TTCard className="space-y-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-medium text-foreground">Mailbox</h3>
        <MetaPill>
          {connection ? INTEGRATION_STATUS_LABEL[connection.status] : INTEGRATION_STATUS_LABEL.disconnected}
        </MetaPill>
      </div>
      <AmbientRule appId="comms" contextAccent={null} />
      <p className="text-sm leading-relaxed text-muted-foreground">
        Reads the threads you label Trust Tai/Comms in Gmail, so the queue knows who is actually
        waiting on a reply. Read-only: no send scope is requested, so Comms cannot send even by
        mistake, and your labels are never changed. Only messages with people already in Comms
        are stored.
      </p>

      {connection?.accountEmail ? (
        <p className="text-xs text-muted-foreground">
          Gmail · {connection.accountEmail}
          {connection.lastSyncAt
            ? ` · last read ${new Date(connection.lastSyncAt).toLocaleString()}`
            : " · not read yet"}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {configured
            ? "Ready to connect. Google will ask you for read-only access."
            : "Needs a Google OAuth client on the server."}
        </p>
      )}

      {lastRun ? (
        <div className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          <p>
            Last pass {new Date(lastRun.at).toLocaleString()}: read {lastRun.messagesRead} labeled,
            stored {lastRun.messagesStored} for {lastRun.relationshipsTouched}{" "}
            {lastRun.relationshipsTouched === 1 ? "relationship" : "relationships"}, emitted{" "}
            {lastRun.eventsEmitted} events, verified {lastRun.draftsVerified} sent{" "}
            {lastRun.draftsVerified === 1 ? "draft" : "drafts"}.
          </p>
          {lastRun.pendingPeople > 0 ? (
            <p>
              {lastRun.pendingPeople} labeled{" "}
              {lastRun.pendingPeople === 1 ? "person is" : "people are"} not in Comms yet (
              {lastRun.skippedUnknownPeople} messages held back). Review them under Add
              relationship → Show people.
            </p>
          ) : null}
        </div>
      ) : null}

      {!provisioned ? (
        <p className="text-xs text-muted-foreground">
          The integration tables are not in the workspace yet, so connecting is held until the
          schema is applied.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        {connected ? (
          <>
            <TTButton
              onClick={() => readNow.mutate()}
              disabled={busy}
            >
              {readNow.isPending ? "Reading…" : "Read now"}
            </TTButton>
            <TTButton
              variant="quiet"
              onClick={() => disconnectAction.mutate()}
              disabled={busy}
            >
              Disconnect
            </TTButton>
          </>
        ) : (
          <TTButton
            onClick={() => connect.mutate()}
            disabled={!configured || !provisioned || busy}
          >
            {connect.isPending || exchange.isPending ? "Connecting…" : "Connect Gmail"}
          </TTButton>
        )}
      </div>

      {sync ? (
        <p className="text-xs text-muted-foreground">
          Read {sync.messagesRead} labeled messages, stored {sync.messagesStored} across{" "}
          {sync.relationshipsTouched} relationships. Held back {sync.skippedUnknownPeople} messages
          from {sync.pendingPeople ?? 0}{" "}
          {(sync.pendingPeople ?? 0) === 1 ? "person" : "people"} not in Comms yet — they stay
          reviewable from the mailbox import below.
        </p>
      ) : null}
      {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
      {connection?.lastError ? (
        <p className="text-xs text-destructive">{connection.lastError}</p>
      ) : null}
      {failure ? <p className="text-xs text-destructive">{failure}</p> : null}
    </TTCard>
  );
}
