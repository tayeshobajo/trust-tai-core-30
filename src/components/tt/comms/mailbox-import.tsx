/**
 * Mailbox import: the Add to Comms decision queue.
 *
 * People you already correspond with — discovered on Trust Tai/Comms labeled
 * threads in ONE connected mailbox — waiting for a human decision. The
 * default queue is only who still needs one; people already in Comms live in
 * their own quiet view. Reading is explicit, nothing is imported until you
 * choose, and every import is confirmed first: one person in the Preview
 * editor, or many in a single bulk review where each person is still seen
 * and edited before anything is created.
 *
 * The laws that hold here:
 * - Selection never crosses a context change: switching mailbox, view,
 *   search, or page clears it. Select-all touches the current page only.
 * - Bulk add is sequential and human-triggered. Each person goes through the
 *   same governed creation plus same-mailbox 30-day labeled backfill as a
 *   single import. A failure never rolls back a success; the people who
 *   still need attention stay in the review, ready to retry.
 * - Pagination is truthful: the server returns everyone discovered inside
 *   the bounded labeled window (at most 60 messages, up to 90 days), and
 *   every count and range on screen describes that full set.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { TTButton, TTField, TTInput } from "@/components/tt/primitives";
import { CommsPagination } from "@/components/tt/comms/pagination";
import {
  buildImportDraft,
  changeImportContext,
  countImportViews,
  draftToRelationshipInput,
  filterImportCandidates,
  IMPORT_PAGE_SIZE,
  importCandidatesInOrder,
  importEmptyMessage,
  importPageFullySelected,
  initialImportQueue,
  setImportPageSelection,
  toggleImportSelection,
  type ImportDraft,
  type ImportQueueState,
  type ImportView,
} from "@/data/comms-import-queue";
import { paginate } from "@/data/pagination";
import {
  gmailCandidates,
  gmailSendStatus,
  type MailboxCandidate,
  type MailboxCoverage,
} from "@/data/supabase/comms-gmail";
import type { RelationshipInput } from "@/data/supabase/comms-service";
import { listProspects } from "@/data/supabase/prospects";
import type { Prospect } from "@/domain/entities";
import { cn } from "@/lib/utils";

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
   * Bulk imports pass `keepOpen` so the panel stays put between people.
   */
  onImport: (
    input: RelationshipInput,
    integrationId?: string,
    options?: { keepOpen?: boolean },
  ) => void | Promise<void>;
  busy?: boolean;
  /** Progress wording while an import runs, e.g. "Bringing in labeled history…". */
  busyLabel?: string;
}) {
  const [candidates, setCandidates] = useState<MailboxCandidate[] | null>(null);
  const [coverage, setCoverage] = useState<MailboxCoverage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [saving, setSaving] = useState(false);

  // The decision queue: view, search, page, and the page-bounded selection.
  const [queue, setQueue] = useState<ImportQueueState>(initialImportQueue);

  // Bulk review: one compact confirmation surface for everyone selected.
  const [bulkDrafts, setBulkDrafts] = useState<ImportDraft[] | null>(null);
  const [bulkErrors, setBulkErrors] = useState<Record<string, string>>({});
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);

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
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  // The mailbox the current candidate list was read from. Defaults to the
  // only mailbox when there is one, so the control stays invisible.
  const activeMailboxId = mailboxId ?? mailboxes[0]?.integrationId ?? null;
  const activeMailboxEmail =
    accountEmail ?? mailboxes.find((mailbox) => mailbox.integrationId === activeMailboxId)?.accountEmail ?? null;

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
      setAccountEmail(result.accountEmail ?? null);
      setCandidates(result.candidates);
      setCoverage(result.coverage ?? null);
      setQueue(initialImportQueue);
      setBulkDrafts(null);
      setBulkNotice(null);
    },
    onError: (failure: unknown) =>
      setError(failure instanceof Error ? failure.message : "That read failed."),
  });

  /* -------------------------------------------- derived queue contents */

  const counts = useMemo(() => countImportViews(candidates ?? []), [candidates]);
  const filtered = useMemo(
    () => filterImportCandidates(candidates ?? [], queue.view, queue.query),
    [candidates, queue.view, queue.query],
  );
  const pageView = useMemo(
    () => paginate(filtered, queue.page, IMPORT_PAGE_SIZE),
    [filtered, queue.page],
  );
  const allOnPageSelected = importPageFullySelected(queue, pageView.rows);
  const someOnPageSelected =
    !allOnPageSelected &&
    pageView.rows.some((row) => queue.selected.includes(row.email.toLowerCase()));

  /* ------------------------------------------------------- single save */

  async function save() {
    if (!draft || !draft.fullName.trim() || saving) return;
    const email = draft.email.trim().toLowerCase();
    setSaving(true);
    try {
      await onImport(draftToRelationshipInput(draft), activeMailboxId ?? undefined);
      setDraft(null);
      // The person is tracked now, even if their history is still coming in.
      if (email) markTracked([email]);
    } catch {
      // The parent surfaces the failure; the preview stays open so nothing typed is lost.
    } finally {
      setSaving(false);
    }
  }

  function markTracked(emails: string[]) {
    const done = new Set(emails.map((email) => email.toLowerCase()));
    setCandidates((previous) =>
      previous
        ? previous.map((candidate) =>
            done.has(candidate.email.toLowerCase())
              ? { ...candidate, alreadyTracked: true }
              : candidate,
          )
        : previous,
    );
  }

  /* ---------------------------------------------------------- bulk add */

  function openBulkReview() {
    const byEmail = new Map(
      (candidates ?? []).map((candidate) => [candidate.email.toLowerCase(), candidate]),
    );
    const drafts = queue.selected
      .map((email) => byEmail.get(email))
      .filter((candidate): candidate is MailboxCandidate => Boolean(candidate))
      .map((candidate) => buildImportDraft(candidate, prospects));
    if (drafts.length === 0) return;
    setBulkErrors({});
    setBulkNotice(null);
    setBulkDrafts(drafts);
  }

  async function runBulk() {
    if (!bulkDrafts || bulkRunning) return;
    setBulkRunning(true);
    setBulkErrors({});
    setBulkNotice(null);
    setBulkProgress({ done: 0, total: bulkDrafts.length });
    try {
      const outcome = await importCandidatesInOrder(
        bulkDrafts.map((entry) => ({
          email: entry.email,
          input: draftToRelationshipInput(entry),
        })),
        {
          importOne: (input, integrationId) =>
            onImport(input, integrationId, { keepOpen: true }),
          ...(activeMailboxId ? { integrationId: activeMailboxId } : {}),
          onProgress: (done, total) => setBulkProgress({ done, total }),
        },
      );
      markTracked(outcome.added);
      setQueue((current) => ({
        ...current,
        selected: current.selected.filter(
          (email) => !outcome.added.includes(email.toLowerCase()),
        ),
      }));
      if (outcome.failed.length === 0) {
        setBulkDrafts(null);
        setBulkErrors({});
        setBulkNotice(
          `${outcome.added.length} ${outcome.added.length === 1 ? "person" : "people"} added to Comms.`,
        );
      } else {
        // Successes stay; failures stay open and reviewable. A retry only
        // revisits the people still here — creation dedupes on email, so no
        // one is ever added twice.
        const failedEmails = new Set(outcome.failed.map((failure) => failure.email));
        setBulkDrafts(
          bulkDrafts.filter((entry) => failedEmails.has(entry.email.trim().toLowerCase())),
        );
        setBulkErrors(
          Object.fromEntries(outcome.failed.map((failure) => [failure.email, failure.error])),
        );
        setBulkNotice(
          `${outcome.added.length} added · ${outcome.failed.length} need${
            outcome.failed.length === 1 ? "s" : ""
          } attention.`,
        );
      }
    } finally {
      setBulkRunning(false);
      setBulkProgress(null);
    }
  }

  /* -------------------------------------------------------------- render */

  const viewTab = (view: ImportView, label: string, count: number) => (
    <button
      key={view}
      type="button"
      aria-pressed={queue.view === view}
      onClick={() => setQueue((current) => changeImportContext(current, { view }))}
      className={cn(
        "rounded-full border px-3 py-1 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        queue.view === view
          ? "border-royal/30 bg-royal/8 font-medium text-royal"
          : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {label} {count}
    </button>
  );

  return (
    <div className="border-t border-border pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="tt-eyebrow">Labeled in Gmail, not yet decided</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            People on threads you have labeled Trust Tai/Comms in Gmail. Reads message metadata
            only; nothing is saved until you confirm. Adding a person brings in their last 30
            days of labeled mail right away — unlabeled mail is never read.
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
                setAccountEmail(null);
                setCandidates(null);
                setCoverage(null);
                setDraft(null);
                setBulkDrafts(null);
                setBulkNotice(null);
                setQueue(initialImportQueue);
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
          {coverage.correspondents} labeled correspondent
          {coverage.correspondents === 1 ? "" : "s"} in the past {coverage.windowDays} days
          {" · "}
          {coverage.pending} need review
          {" · "}
          {coverage.tracked} already in Comms
        </p>
      ) : null}

      {candidates ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5" role="group" aria-label="Import view">
              {viewTab("pending", "Needs review", counts.pending)}
              {viewTab("tracked", "In Comms", counts.tracked)}
            </div>
            <TTInput
              type="search"
              value={queue.query}
              onChange={(event) =>
                setQueue((current) => changeImportContext(current, { query: event.target.value }))
              }
              placeholder="Search name, email, or domain"
              aria-label="Search people"
              className="h-8 w-full max-w-56 px-3 text-[12px]"
            />
          </div>

          {activeMailboxEmail ? (
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Reviewing {activeMailboxEmail} · labeled Trust Tai/Comms
            </p>
          ) : null}

          {bulkNotice ? (
            <p className="text-[13px] text-muted-foreground" role="status">
              {bulkNotice}
            </p>
          ) : null}

          {queue.selected.length > 0 && queue.view === "pending" ? (
            <div
              className="flex flex-wrap items-center gap-3 border border-border bg-muted/30 px-3 py-2"
              role="region"
              aria-label="Selection actions"
            >
              <p className="text-[13px] text-foreground" aria-live="polite">
                {queue.selected.length} selected
              </p>
              <TTButton type="button" size="sm" onClick={openBulkReview} disabled={busy}>
                Add to Comms
              </TTButton>
              <TTButton
                type="button"
                variant="quiet"
                size="sm"
                onClick={() => setQueue((current) => ({ ...current, selected: [] }))}
              >
                Clear
              </TTButton>
            </div>
          ) : null}

          {filtered.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              {importEmptyMessage(queue.view, queue.query)}
            </p>
          ) : (
            <div className="border-y border-border">
              {queue.view === "pending" ? (
                <div className="flex items-center gap-3 border-b border-border py-2">
                  <input
                    type="checkbox"
                    aria-label="Select everyone on this page"
                    checked={allOnPageSelected}
                    ref={(element) => {
                      if (element) element.indeterminate = someOnPageSelected;
                    }}
                    onChange={(event) =>
                      setQueue((current) =>
                        setImportPageSelection(current, pageView.rows, event.target.checked),
                      )
                    }
                    className="size-3.5 accent-royal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <span className="text-[11px] text-muted-foreground">
                    Select this page
                  </span>
                </div>
              ) : null}

              <ul className="divide-y divide-border">
                {pageView.rows.map((candidate) => {
                  const email = candidate.email.toLowerCase();
                  const selected = queue.selected.includes(email);
                  return (
                    <li
                      key={candidate.email}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        {queue.view === "pending" ? (
                          <input
                            type="checkbox"
                            aria-label={`Select ${candidate.name || candidate.email}`}
                            checked={selected}
                            onChange={() =>
                              setQueue((current) => toggleImportSelection(current, email))
                            }
                            className="size-3.5 shrink-0 accent-royal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                        ) : null}
                        <div className="min-w-0">
                          <p className="truncate text-[14px] text-foreground">
                            {candidate.name || candidate.email}
                          </p>
                          <p className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            {candidate.email} · {candidate.messageCount} message
                            {candidate.messageCount === 1 ? "" : "s"}
                          </p>
                          {candidate.lastSubject ? (
                            <p className="truncate text-[11px] text-muted-foreground">
                            {candidate.lastSubject}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      {queue.view === "tracked" ? (
                        <span className="tt-eyebrow text-muted-foreground">In Comms</span>
                      ) : (
                        <TTButton
                          type="button"
                          variant="quiet"
                          disabled={busy}
                          onClick={() => setDraft(buildImportDraft(candidate, prospects))}
                        >
                          Preview
                        </TTButton>
                      )}
                    </li>
                  );
                })}
              </ul>

              <CommsPagination
                view={pageView}
                onPage={(page) => setQueue((current) => changeImportContext(current, { page }))}
                label="Candidate list pagination"
              />
            </div>
          )}
        </div>
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

      {bulkDrafts ? (
        <div className="mt-4 border border-border bg-muted/30 p-5">
          <p className="tt-eyebrow">Review before adding</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Each person is created exactly as a single Add to Comms — one relationship, one
            labeled backfill from this mailbox. Nothing is created until you confirm below.
          </p>
          <ul className="mt-4 space-y-4">
            {bulkDrafts.map((entry, index) => {
              const email = entry.email.trim().toLowerCase();
              const rowError = bulkErrors[email];
              const update = (patch: Partial<ImportDraft>) =>
                setBulkDrafts((current) =>
                  current
                    ? current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, ...patch } : item,
                      )
                    : current,
                );
              return (
                <li key={entry.email} className="border border-border bg-card p-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <TTField label="Name">
                      <TTInput
                        value={entry.fullName}
                        onChange={(event) => update({ fullName: event.target.value })}
                        className="h-9 px-3 text-[13px]"
                      />
                    </TTField>
                    <TTField label="Email">
                      <TTInput
                        type="email"
                        value={entry.email}
                        onChange={(event) => update({ email: event.target.value })}
                        className="h-9 px-3 text-[13px]"
                      />
                    </TTField>
                    <TTField label="Company" optional>
                      <TTInput
                        value={entry.companyName}
                        onChange={(event) => update({ companyName: event.target.value })}
                        className="h-9 px-3 text-[13px]"
                      />
                    </TTField>
                  </div>
                  <div className="mt-3">
                    <TTField
                      label="Matched prospect"
                      optional
                      hint={
                        entry.suggestedProspectId
                          ? "Matched on the email domain. Change it if that is wrong."
                          : "No Scout prospect matched this domain."
                      }
                    >
                      <select
                        value={entry.prospectId}
                        onChange={(event) => update({ prospectId: event.target.value })}
                        className="w-full border border-border bg-background px-3 py-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-xs"
                      >
                        <option value="">No prospect</option>
                        {prospects.map((prospect: Prospect) => (
                          <option key={prospect.id} value={prospect.id}>
                            {prospect.name}
                            {prospect.domain ? ` · ${prospect.domain}` : ""}
                          </option>
                        ))}
                      </select>
                    </TTField>
                  </div>
                  {rowError ? (
                    <p className="mt-3 text-[13px] text-destructive" role="alert">
                      {rowError}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <TTButton
              type="button"
              onClick={() => void runBulk()}
              disabled={
                bulkRunning ||
                busy ||
                bulkDrafts.every((entry) => !entry.fullName.trim())
              }
            >
              {bulkRunning && bulkProgress
                ? `Adding ${bulkProgress.done} of ${bulkProgress.total}…`
                : `Add ${bulkDrafts.length} to Comms`}
            </TTButton>
            <TTButton
              type="button"
              variant="quiet"
              disabled={bulkRunning}
              onClick={() => {
                setBulkDrafts(null);
                setBulkErrors({});
              }}
            >
              Cancel
            </TTButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
