/**
 * Manual LinkedIn send: the member sends, Comms records.
 *
 * There is no LinkedIn integration. When a relationship's route is a
 * LinkedIn profile and a draft is in hand, this strip shows the profile, the
 * exact wording, and a copy button; the member opens LinkedIn themselves,
 * pastes, and sends from their own logged-in account. "Mark as sent" then
 * RECORDS that it happened, through the same idempotent claim machinery as a
 * Gmail send, so the timeline shows the outreach and the draft ends `sent`.
 *
 * The confirm step is explicit on purpose: recording a send that did not
 * happen would put a lie on the relationship's record.
 */

import { useState } from "react";

import { TTButton } from "@/components/tt/primitives";
import { markLinkedinSent } from "@/data/supabase/comms-linkedin";
import type { CommsDraft, Relationship } from "@/domain/comms";
import { readLinkedinRoute } from "@/domain/comms-routes";

export function LinkedinSendPanel({
  relationship,
  draft,
  organizationId,
  onRecorded,
}: {
  relationship: Relationship;
  draft: CommsDraft;
  organizationId: string;
  onRecorded: () => void | Promise<void>;
}) {
  const route = readLinkedinRoute(relationship.metadata);
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!route) return null;

  async function copyBody() {
    try {
      await navigator.clipboard.writeText(draft.body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy failed. Select the text and copy it yourself.");
    }
  }

  async function record() {
    setBusy(true);
    setError(null);
    try {
      await markLinkedinSent(organizationId, draft.id);
      setConfirming(false);
      await onRecorded();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That record failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-border bg-cloud/40 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-[12px] text-muted-foreground">
          <span className="font-medium text-foreground">Send by hand on LinkedIn</span>
          {" · "}
          <a
            href={route.url}
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
          >
            open {relationship.fullName}&rsquo;s profile
          </a>
          {route.confirmed ? "" : " · route unverified"}
        </p>
        <TTButton
          variant="quiet"
          size="sm"
          type="button"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Hide" : "Show message"}
        </TTButton>
      </div>

      {expanded ? (
        <div className="mt-3 space-y-3">
          <p className="text-[12px] text-muted-foreground">
            Copy the message below, send it yourself from your own LinkedIn account, then record it
            here. Nothing is sent from Comms.
          </p>
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-card px-3.5 py-3 font-sans text-[13px] text-foreground">
            {draft.body}
          </pre>
          <div className="flex flex-wrap items-center gap-2">
            <TTButton variant="quiet" size="sm" type="button" onClick={() => void copyBody()}>
              {copied ? "Copied" : "Copy message"}
            </TTButton>
            {confirming ? (
              <>
                <span className="text-[12px] text-muted-foreground">
                  Only confirm after you have actually sent it on LinkedIn. This records the send;
                  it sends nothing.
                </span>
                <TTButton size="sm" type="button" disabled={busy} onClick={() => void record()}>
                  {busy ? "Recording…" : "Yes, I sent it"}
                </TTButton>
                <TTButton
                  variant="quiet"
                  size="sm"
                  type="button"
                  onClick={() => setConfirming(false)}
                >
                  Not yet
                </TTButton>
              </>
            ) : (
              <TTButton size="sm" type="button" onClick={() => setConfirming(true)}>
                Mark as sent on LinkedIn
              </TTButton>
            )}
          </div>
          {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
