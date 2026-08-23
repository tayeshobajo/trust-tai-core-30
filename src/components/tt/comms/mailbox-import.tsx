/**
 * Mailbox import.
 *
 * One quiet list of people you already correspond with, so a real relationship
 * can exist in Comms without typing it out. Reading is explicit, nothing is
 * imported until you choose a person, and every import is confirmed in a
 * preview first: name, email, company, and the Scout prospect it belongs to.
 * The match is a suggestion, never a silent link.
 *
 * Candidate discovery is per mailbox: each connected Gmail account reads only
 * its own Trust Tai/Comms labeled threads, and with several connected the
 * reader chooses which mailbox to look in.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { TTButton, TTField, TTInput } from "@/components/tt/primitives";
import {
  gmailCandidates,
  gmailSendStatus,
  type MailboxCandidate,
  type MailboxCoverage,
} from "@/data/supabase/comms-gmail";
import type { RelationshipInput } from "@/data/supabase/comms-service";
import { listProspects } from "@/data/supabase/prospects";
import type { Prospect } from "@/domain/entities";

function hostOf(email: string): string {
  return (email.split("@")[1] ?? "").toLowerCase().replace(/^www\./, "");
}

function companyGuess(email: string): string {
  const base = hostOf(email).split(".")[0] ?? "";
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "";
}

interface Draft {
  fullName: string;
  email: string;
  companyName: string;
  note: string;
  prospectId: string;
  suggestedProspectId: string;
}

function buildDraft(candidate: MailboxCandidate, prospects: Prospect[]): Draft {
  const host = hostOf(candidate.email);
  const match = host
    ? prospects.find((prospect) => {
        const domain = prospect.domain.toLowerCase();
        return domain === host || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`);
      })
    : undefined;
  return {
    fullName: candidate.name || candidate.email,
    email: candidate.email,
    companyName: match?.name ?? companyGuess(candidate.email),
    note: candidate.lastSubject ? `Last thread: ${candidate.lastSubject}` : "",
    prospectId: match?.id ?? "",
    suggestedProspectId: match?.id ?? "",
  };
}

export function MailboxImport({
  organizationId,
  onImport,
  busy,
  busyLabel,
}: {
  organizationId: string;
  /**
   * The Add to Comms action. Resolves once the relationship exists and its
   * bounded labeled backfill has been attempted; rejects only when the
   * relationship itself could not be created. The second argument names the
   * mailbox the candidate came from, so the backfill reads that account.
   */
  onImport: (input: RelationshipInput, integrationId?: string) => void | Promise<void>;
  busy?: boolean;
  /** Progress wording while an import runs, e.g. "Bringing in labeled history…". */
  busyLabel?: string;
}) {
  const [candidates, setCandidates] = useState<MailboxCandidate[] | null>(null);
  const [coverage, setCoverage] = useState<MailboxCoverage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  // Which mailboxes are connected — discovery runs against one at a time.
  const mailboxesQuery = useQuery({
    queryKey: ["comms", "gmail-send-status", organizationId],
    queryFn: () => gmailSendStatus(organizationId),
    staleTime: 60_000,
    retry: false,
  });
  const mailboxes = useMemo(
    () => (mailboxesQuery.data?.mailboxes ?? []).filter((mailbox) => mailbox.connected),
    [mailboxesQuery.data],
  );
  const [mailboxId, setMailboxId] = useState<string | null>(null);
  // The mailbox the current candidate list was read from. Defaults to the
  // only mailbox when there is one, so the control stays invisible.
  const activeMailboxId = mailboxId ?? mailboxes[0]?.integrationId ?? null;

  const prospectsQuery = useQuery({
    queryKey: ["scout", "prospects", organizationId],
    queryFn: () => listProspects(organizationId),
  });
  const prospects = useMemo(() => prospectsQuery.data ?? [], [prospectsQuery.data]);

  const read = useMutation({
    mutationFn: () => gmailCandidates(organizationId, activeMailboxId ?? undefined),
    onSuccess: (result) => {
      setError(null);
      setMailboxId(result.integrationId);
      setCandidates(result.candidates);
      setCoverage(result.coverage ?? null);
    },
    onError: (failure: unknown) =>
      setError(failure instanceof Error ? failure.message : "That read failed."),
  });

  async function save() {
    if (!draft || !draft.fullName.trim() || saving) return;
    const email = draft.email.trim().toLowerCase();
    setSaving(true);
    try {
      await onImport(
        {
          fullName: draft.fullName.trim(),
          ...(email ? { email } : {}),
          ...(draft.companyName.trim() ? { companyName: draft.companyName.trim() } : {}),
          ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
          ...(draft.prospectId ? { prospectId: draft.prospectId } : {}),
          source: "inbound",
          stage: "new",
        },
        activeMailboxId ?? undefined,
      );
      setDraft(null);
      // The person is tracked now, even if their history is still coming in.
      if (email) {
        setCandidates((previous) =>
          previous
            ? previous.map((candidate) =>
                candidate.email.toLowerCase() === email
                  ? { ...candidate, alreadyTracked: true }
                  : candidate,
              )
            : previous,
        );
      }
    } catch {
      // The parent surfaces the failure; the preview stays open so nothing typed is lost.
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-t border-border pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="tt-eyebrow">Labeled in Gmail, not yet in Comms</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            People on threads you have labeled Trust Tai/Comms in Gmail. Reads message metadata
            only; nothing is saved until you confirm the preview. Adding a person brings in their
            last 30 days of labeled mail right away — unlabeled mail is never read.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {mailboxes.length > 1 ? (
            <select
              value={activeMailboxId ?? ""}
              onChange={(event) => {
                // Another mailbox, another labeled world — drop the list read
                // from the previous account so the two are never merged.
                setMailboxId(event.target.value || null);
                setCandidates(null);
                setCoverage(null);
              }}
              aria-label="Mailbox to read"
              className="rounded-full border border-border bg-card px-3 py-1 text-[12px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {mailboxes.map((mailbox) => (
                <option key={mailbox.integrationId} value={mailbox.integrationId}>
                  {mailbox.accountEmail ?? "Gmail account"}
                </option>
              ))}
            </select>
          ) : null}
          <TTButton
            type="button"
            variant="quiet"
            onClick={() => read.mutate()}
            disabled={read.isPending}
          >
            {read.isPending ? "Reading" : candidates ? "Read again" : "Show people"}
          </TTButton>
        </div>
      </div>

      {error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}

      {coverage ? (
        <p className="mt-3 text-[13px] text-muted-foreground">
          Coverage, last {coverage.windowDays} days: {coverage.tracked} of{" "}
          {coverage.correspondents} labeled correspondents are already in Comms
          {coverage.pending > 0
            ? ` — ${coverage.pending} waiting for your decision.`
            : "."}
        </p>
      ) : null}

      {draft ? (
        <div className="mt-4 border border-border bg-muted/30 p-5">
          <p className="tt-eyebrow">Confirm before saving</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <TTField label="Name">
              <TTInput
                value={draft.fullName}
                onChange={(event) =>
                  setDraft({ ...draft, fullName: event.target.value })
                }
              />
            </TTField>
            <TTField label="Email">
              <TTInput
                type="email"
                value={draft.email}
                onChange={(event) => setDraft({ ...draft, email: event.target.value })}
              />
            </TTField>
            <TTField label="Company" optional>
              <TTInput
                value={draft.companyName}
                onChange={(event) =>
                  setDraft({ ...draft, companyName: event.target.value })
                }
              />
            </TTField>
            <TTField
              label="Matched prospect"
              optional
              hint={
                draft.suggestedProspectId
                  ? "Matched on the email domain. Change it if that is wrong."
                  : "No Scout prospect matched this domain."
              }
            >
              <select
                value={draft.prospectId}
                onChange={(event) => setDraft({ ...draft, prospectId: event.target.value })}
                className="w-full border border-border bg-background px-3 py-2 text-[14px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">No prospect</option>
                {prospects.map((prospect) => (
                  <option key={prospect.id} value={prospect.id}>
                    {prospect.name}
                    {prospect.domain ? ` · ${prospect.domain}` : ""}
                  </option>
                ))}
              </select>
            </TTField>
          </div>
          <TTField label="One thing worth remembering" optional>
            <TTInput
              value={draft.note}
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            />
          </TTField>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <TTButton
              type="button"
              onClick={() => void save()}
              disabled={!draft.fullName.trim() || busy || saving}
            >
              {busy || saving ? (busyLabel ?? "Saving") : "Add to Comms"}
            </TTButton>
            <TTButton type="button" variant="quiet" onClick={() => setDraft(null)}>
              Cancel
            </TTButton>
          </div>
        </div>
      ) : null}

      {candidates && candidates.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted-foreground">
          No labeled correspondents were found in that window.
        </p>
      ) : null}

      {candidates && candidates.length > 0 ? (
        <ul className="mt-4 divide-y divide-border border-y border-border">
          {candidates.map((candidate) => (
            <li
              key={candidate.email}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-[14px] text-foreground">
                  {candidate.name || candidate.email}
                </p>
                <p className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {candidate.email} · {candidate.messageCount} message
                  {candidate.messageCount === 1 ? "" : "s"}
                </p>
              </div>
              {candidate.alreadyTracked ? (
                <span className="tt-eyebrow text-muted-foreground">Already in Comms</span>
              ) : (
                <TTButton
                  type="button"
                  variant="quiet"
                  disabled={busy}
                  onClick={() => setDraft(buildDraft(candidate, prospects))}
                >
                  Preview
                </TTButton>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
