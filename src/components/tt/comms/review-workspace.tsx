/**
 * Comms review: a person's own words, judged before they send them.
 *
 * The shape of the screen follows the shape of the decision. On the left,
 * what was received and what is being sent. On the right, what the review
 * found, what the client asked that is still unanswered, and whether this
 * exact version is approved.
 *
 * Three honesty rules are visible here rather than buried:
 *  - a source Comms could not read says so, and never counts as read,
 *  - an answer Comms could not verify stays uncertain; it is never rounded up,
 *  - an approval belongs to one exact version. Edit the words and the review
 *    and the approval both say they are out of date.
 *
 * Nothing on this screen sends anything.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { EmptyState, MetaPill, SectionHeading, TTButton } from "@/components/tt/primitives";
import {
  approveReview,
  createReview,
  decideFinding,
  listReviews,
  loadReview,
  reviseDraft,
  runReview,
  sendReadiness,
} from "@/data/supabase/comms-review-client";
import { canApproveReview } from "@/domain/comms-review";
import type { ObligationVerdict } from "@/domain/comms-obligations";
import type { WorkspaceIdentity } from "@/lib/workspace";
import { cn } from "@/lib/utils";

const field =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ReviewWorkspace({
  identity,
  openSessionId,
}: {
  identity: WorkspaceIdentity;
  /** The review the queue sent this person to, when they arrived from there. */
  openSessionId?: string;
}) {
  const [openSession, setOpenSession] = useState<string | null>(openSessionId ?? null);

  return (
    <div className="space-y-8">
      <SectionHeading
        title="Review"
        description="Paste what you were sent, add anything else that matters, and write your reply. Comms judges your words against theirs, names what it could not read, and tracks every question you were asked."
      />
      {openSession ? (
        <ReviewDetail
          identity={identity}
          sessionId={openSession}
          onBack={() => setOpenSession(null)}
        />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <NewReview identity={identity} onOpened={setOpenSession} />
          <RecentReviews identity={identity} onOpen={setOpenSession} />
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- intake */

function NewReview({
  identity,
  onOpened,
}: {
  identity: WorkspaceIdentity;
  onOpened: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [goal, setGoal] = useState("");
  const [received, setReceived] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<{ filename: string; mediaType: string; text?: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const open = useMutation({
    mutationFn: () =>
      createReview({
        organizationId: identity.organizationId,
        title: title.trim() || recipientName.trim() || "Message review",
        situation: "",
        goal,
        recipientName,
        recipientEmail,
        subject,
        body,
        sources: [
          ...(received.trim() ? [{ label: "What you were sent", text: received }] : []),
          ...files.map((file) => ({
            label: file.filename,
            filename: file.filename,
            mediaType: file.mediaType,
            ...(file.text ? { text: file.text } : {}),
          })),
        ],
      }),
    onSuccess: (result) => onOpened(result.sessionId),
    onError: (cause: Error) => setError(cause.message),
  });

  async function attach(list: FileList | null) {
    if (!list) return;
    const next: { filename: string; mediaType: string; text?: string }[] = [];
    for (const file of Array.from(list).slice(0, 6)) {
      const readable = /\.(txt|md|markdown)$/i.test(file.name) || file.type.startsWith("text/");
      next.push({
        filename: file.name,
        mediaType: file.type,
        ...(readable ? { text: await file.text() } : {}),
      });
    }
    setFiles((current) => [...current, ...next]);
  }

  return (
    <form
      className="space-y-5 rounded-xl border border-border bg-card/60 p-6"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        open.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm">
          <span className="text-muted-foreground">Who is this to</span>
          <input
            className={field}
            value={recipientName}
            onChange={(event) => setRecipientName(event.target.value)}
            placeholder="Megan Walls"
          />
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="text-muted-foreground">Their email</span>
          <input
            className={field}
            type="email"
            value={recipientEmail}
            onChange={(event) => setRecipientEmail(event.target.value)}
            placeholder="megan@example.com"
          />
        </label>
      </div>

      <label className="block space-y-1.5 text-sm">
        <span className="text-muted-foreground">What you are trying to achieve</span>
        <input
          className={field}
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="Give her the date she asked for without over-promising."
        />
      </label>

      <label className="block space-y-1.5 text-sm">
        <span className="text-muted-foreground">What you were sent</span>
        <textarea
          className={cn(field, "min-h-40 font-mono text-[13px] leading-relaxed")}
          value={received}
          onChange={(event) => setReceived(event.target.value)}
          placeholder="Paste the message, thread, or brief you are replying to."
        />
      </label>

      <div className="space-y-2">
        <label className="block space-y-1.5 text-sm">
          <span className="text-muted-foreground">Anything else to read</span>
          <input
            type="file"
            multiple
            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm"
            onChange={(event) => void attach(event.target.files)}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          Text and Markdown files are read. Anything else is listed but not read, and the review
          will say so rather than pretend otherwise.
        </p>
        {files.length > 0 ? (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {files.map((file) => (
              <li key={file.filename}>
                {file.filename}
                {file.text === undefined ? " — will not be read" : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <label className="block space-y-1.5 text-sm">
        <span className="text-muted-foreground">Subject</span>
        <input className={field} value={subject} onChange={(e) => setSubject(e.target.value)} />
      </label>

      <label className="block space-y-1.5 text-sm">
        <span className="text-muted-foreground">The reply you mean to send</span>
        <textarea
          className={cn(field, "min-h-56 leading-relaxed")}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Your words. Comms reviews these; it does not write them for you here."
        />
      </label>

      <label className="block space-y-1.5 text-sm">
        <span className="text-muted-foreground">Name this review</span>
        <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>

      {error ? <p className="text-sm text-[var(--danger,#b3261e)]">{error}</p> : null}

      <TTButton type="submit" pending={open.isPending} pendingLabel="Opening review…">
        Open review
      </TTButton>
    </form>
  );
}

function RecentReviews({
  identity,
  onOpen,
}: {
  identity: WorkspaceIdentity;
  onOpen: (id: string) => void;
}) {
  const query = useQuery({
    queryKey: ["comms", "reviews", identity.organizationId],
    queryFn: () => listReviews(identity.organizationId),
  });

  return (
    <aside className="space-y-3">
      <h3 className="text-sm font-medium text-foreground">Recent reviews</h3>
      {query.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {query.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reviews yet.</p>
      ) : null}
      <ul className="space-y-2">
        {(query.data ?? []).map((session) => (
          <li key={session.id}>
            <button
              type="button"
              onClick={() => onOpen(session.id)}
              className="w-full rounded-lg border border-border bg-card/60 px-3 py-2 text-left text-sm hover:border-[var(--cloud-line)]"
            >
              <span className="block font-medium text-foreground">{session.title}</span>
              <span className="block text-xs text-muted-foreground">
                {session.status === "approved" ? "Approved" : "Open"} ·{" "}
                {new Date(session.updatedAt).toLocaleDateString()}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/* ---------------------------------------------------------------- detail */

function ReviewDetail({
  identity,
  sessionId,
  onBack,
}: {
  identity: WorkspaceIdentity;
  sessionId: string;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const key = ["comms", "review", identity.organizationId, sessionId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => loadReview(identity.organizationId, sessionId),
  });
  const [edited, setEdited] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* Anything that changes the words, the context or the decision changes the
     answer to "could this be sent?". Both readings are thrown away together,
     so the panel can never keep showing a readiness that belonged to an
     earlier version. */
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: ["comms", "send-readiness"] }),
      queryClient.invalidateQueries({ queryKey: ["comms", "reviews", identity.organizationId] }),
    ]);
  };

  const state = query.data;
  const current = state?.currentVersion ?? null;
  const bodyText = edited ?? current?.body ?? "";
  const dirty = current !== null && edited !== null && edited !== current.body;

  const save = useMutation({
    mutationFn: () =>
      reviseDraft({
        organizationId: identity.organizationId,
        sessionId,
        subject: current?.subject ?? "",
        body: bodyText,
      }),
    onSuccess: () => {
      setEdited(null);
      void refresh();
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const review = useMutation({
    mutationFn: () =>
      runReview({
        organizationId: identity.organizationId,
        sessionId,
        versionId: current?.id ?? "",
      }),
    onSuccess: () => void refresh(),
    onError: (cause: Error) => setError(cause.message),
  });

  const approve = useMutation({
    mutationFn: () =>
      approveReview({
        organizationId: identity.organizationId,
        sessionId,
        versionId: current?.id ?? "",
        ...(state?.latestRun ? { runId: state.latestRun.id } : {}),
      }),
    onSuccess: () => void refresh(),
    onError: (cause: Error) => setError(cause.message),
  });

  const decide = useMutation({
    mutationFn: (input: { findingId: string; state: "accepted" | "kept" }) =>
      decideFinding({ organizationId: identity.organizationId, ...input }),
    onSuccess: () => void refresh(),
  });

  if (query.isLoading) return <p className="text-sm text-muted-foreground">Loading review…</p>;
  if (!state || !current) {
    return (
      <EmptyState
        title="That review could not be opened"
        belongsHere="Reviews live in the workspace you were signed into when you opened them."
        whyItMatters="Nothing was changed."
        action={<TTButton onClick={onBack}>Back</TTButton>}
      />
    );
  }

  const mustFix = state.findings.filter((finding) => finding.severity === "must_fix");
  const rest = state.findings.filter((finding) => finding.severity !== "must_fix");
  const canApprove = canApproveReview(identity.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <TTButton variant="quiet" onClick={onBack}>
          Back
        </TTButton>
        <h3 className="text-lg font-medium text-foreground">{state.session.title}</h3>
        <MetaPill>Version {current.version}</MetaPill>
        {state.latestRun && !state.runIsCurrent ? <MetaPill>Review is out of date</MetaPill> : null}
      </div>

      {error ? <p className="text-sm text-[var(--danger,#b3261e)]">{error}</p> : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-4">
          <label className="block space-y-1.5 text-sm">
            <span className="text-muted-foreground">Your reply</span>
            <textarea
              className={cn(field, "min-h-[26rem] leading-relaxed")}
              value={bodyText}
              onChange={(event) => setEdited(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <TTButton
              onClick={() => save.mutate()}
              disabled={!dirty}
              pending={save.isPending}
              pendingLabel="Saving version…"
            >
              Save as new version
            </TTButton>
            <TTButton
              variant="secondary"
              onClick={() => review.mutate()}
              disabled={dirty}
              pending={review.isPending}
              pendingLabel="Reviewing…"
            >
              {state.latestRun ? "Review again" : "Review this draft"}
            </TTButton>
          </div>
          {dirty ? (
            <p className="text-xs text-muted-foreground">
              Save your edit first. A review always judges one exact version, never a moving one.
            </p>
          ) : null}

          <div className="rounded-lg border border-border bg-card/60 p-4">
            <h4 className="text-sm font-medium text-foreground">What Comms read</h4>
            <p className="mt-1 text-sm text-muted-foreground">{state.coverageNote}</p>
            <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
              {state.sources.map((source) => (
                <li key={source.id}>
                  <span className="text-foreground">{source.label}</span> — {source.statusNote}
                </li>
              ))}
              {state.sources.length === 0 ? <li>No source material was added.</li> : null}
            </ul>
          </div>
        </section>

        <aside className="space-y-6">
          {state.latestRun?.summary ? (
            <div className="rounded-lg border border-border bg-card/60 p-4">
              <p className="text-sm text-foreground">{state.latestRun.summary}</p>
              {state.latestRun.goalRead ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Read of your goal: {state.latestRun.goalRead}
                </p>
              ) : null}
              <p className="mt-3 text-[11px] text-muted-foreground">
                {state.latestRun.provider} · {state.latestRun.model} ·{" "}
                {state.latestRun.promptVersion}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">This draft has not been reviewed yet.</p>
          )}

          {mustFix.length > 0 ? (
            <FindingList
              heading="Must fix"
              note="Marking these does not clear them. A must fix is cleared by changing the words and reviewing again."
              findings={mustFix}
              onDecide={(findingId, next) => decide.mutate({ findingId, state: next })}
            />
          ) : null}
          {rest.length > 0 ? (
            <FindingList
              heading="Worth considering"
              findings={rest}
              onDecide={(findingId, next) => decide.mutate({ findingId, state: next })}
            />
          ) : null}

          <Coverage verdicts={state.obligations.verdicts} note={state.obligations.note} />

          <div className="rounded-lg border border-border bg-card/60 p-4">
            <h4 className="text-sm font-medium text-foreground">Approval</h4>
            <p className="mt-1 text-sm text-muted-foreground">{state.approval.note}</p>
            {state.readiness.blockers.length > 0 ? (
              <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                {state.readiness.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            ) : null}
            {canApprove ? (
              <TTButton
                className="mt-3"
                onClick={() => approve.mutate()}
                disabled={dirty || !state.readiness.ready || state.approval.freshness === "fresh"}
                pending={approve.isPending}
                pendingLabel="Recording approval…"
              >
                Approve this version
              </TTButton>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Approving is an owner or admin decision. You can review and revise, then ask one of
                them.
              </p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">{state.approvalScopeNote}</p>
          </div>

          {state.session.draftId ? (
            <SendReadiness
              organizationId={identity.organizationId}
              draftId={state.session.draftId}
              channel={state.session.intendedChannel}
              sender={state.session.senderIdentity}
              approvedAt={state.approval.approval?.approvedAt ?? null}
              versionId={current.id}
              contextRevision={state.session.contextRevision}
              contextFingerprint={state.fingerprint}
              dirty={dirty}
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}

/**
 * Whether this message could go out as it now stands, asked of the server and
 * shown plainly. Nothing here sends: the button lives on the queue, and the
 * server decides again at that moment. What this answers is the question a
 * person actually has after approving — "is that it, then?"
 */
function SendReadiness({
  organizationId,
  draftId,
  channel,
  sender,
  approvedAt,
  versionId,
  contextRevision,
  contextFingerprint,
  dirty,
}: {
  organizationId: string;
  draftId: string;
  channel: string | null;
  sender: string | null;
  approvedAt: string | null;
  versionId: string;
  contextRevision: number;
  contextFingerprint: string;
  dirty: boolean;
}) {
  /* The answer belongs to one exact saved state: this version, this revision
     of the context, this reading of the words, this approval. Change any of
     them and this is a different question, asked again from the start. */
  const query = useQuery({
    queryKey: [
      "comms",
      "send-readiness",
      organizationId,
      draftId,
      versionId,
      contextRevision,
      contextFingerprint,
      approvedAt,
    ],
    queryFn: () => sendReadiness(organizationId, draftId),
    /* While the editor holds an unsaved edit there is nothing truthful to
       ask about, so nothing is asked. */
    enabled: !dirty,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const state = dirty ? null : query.data;
  const checkedAt = query.dataUpdatedAt ? new Date(query.dataUpdatedAt) : null;


  return (
    <div className="rounded-lg border border-border bg-card/60 p-4">
      <h4 className="text-sm font-medium text-foreground">Sending</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        This review governs one message in the queue
        {channel === "email_gmail"
          ? ", going out by Gmail"
          : channel === "email_resend"
            ? ", going out by email"
            : channel === "linkedin_manual"
              ? ", to be sent by hand on LinkedIn"
              : ""}
        {sender ? ` as ${sender}` : ""}.
      </p>
      {query.isLoading ? (
        <p className="mt-2 text-sm text-muted-foreground">Checking…</p>
      ) : query.isError ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Whether this could be sent could not be checked just now. Nothing changed.
        </p>
      ) : state ? (
        <>
          <p className="mt-2 text-sm text-foreground">{state.message}</p>
          {state.blockers.length > 0 ? (
            <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
              {state.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          ) : null}
          {state.ready ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Send it from the queue when you are ready. Nothing goes out from this screen.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function FindingList({
  heading,
  note,
  findings,
  onDecide,
}: {
  heading: string;
  note?: string;
  findings: {
    id: string;
    why: string;
    excerpt: string | null;
    suggestion: string | null;
    state: string;
  }[];
  onDecide: (findingId: string, state: "accepted" | "kept") => void;
}) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-foreground">{heading}</h4>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      {findings.map((finding) => (
        <div key={finding.id} className="rounded-lg border border-border bg-card/60 p-4">
          {finding.excerpt ? (
            <p className="text-sm italic text-muted-foreground">“{finding.excerpt}”</p>
          ) : null}
          <p className="mt-2 text-sm text-foreground">{finding.why}</p>
          {finding.suggestion ? (
            <p className="mt-2 text-sm text-muted-foreground">Suggested: {finding.suggestion}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <TTButton
              size="sm"
              variant="secondary"
              onClick={() => onDecide(finding.id, "accepted")}
              disabled={finding.state !== "open"}
            >
              Accepted
            </TTButton>
            <TTButton
              size="sm"
              variant="quiet"
              onClick={() => onDecide(finding.id, "kept")}
              disabled={finding.state !== "open"}
            >
              Keeping mine
            </TTButton>
            {finding.state !== "open" ? (
              <span className="self-center text-xs text-muted-foreground">
                {finding.state === "accepted" ? "Accepted" : "Kept as written"}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

const STATUS_LABEL: Record<ObligationVerdict["status"], string> = {
  answered: "Answered",
  partly_answered: "Partly answered",
  pending_confirmation: "Promised, not answered",
  missing: "Not answered",
  uncertain: "Could not be judged",
};

function Coverage({ verdicts, note }: { verdicts: ObligationVerdict[]; note: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/60 p-4">
      <h4 className="text-sm font-medium text-foreground">What they asked</h4>
      <p className="mt-1 text-sm text-muted-foreground">{note}</p>
      <ul className="mt-3 space-y-3">
        {verdicts.map((verdict) => (
          <li key={verdict.obligationId} className="text-sm">
            <p className="text-foreground">{verdict.excerpt}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {STATUS_LABEL[verdict.status]} — {verdict.because}
            </p>
            {verdict.answer ? (
              <p className="mt-1 text-xs italic text-muted-foreground">“{verdict.answer.quote}”</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
