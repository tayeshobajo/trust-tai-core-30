/**
 * MOCKUP ONLY — review mode, the hero.
 *
 * A large editable draft with anchored highlights and margin markers, and a
 * reviewer notes pane holding prioritised findings, question coverage and the
 * approval footer. Every state here is local. Nothing is reviewed by a model,
 * nothing is written, nothing is sent.
 */

import { useMemo, useState } from "react";
import { ArrowLeft, Check, FileText, Pencil, X } from "lucide-react";

import {
  FINDING_GROUP_LABEL,
  type CoverageState,
  type V2Finding,
  type V2Thread,
} from "@/data/mockups/comms-workspace-v2";
import { cn } from "@/lib/utils";

export type ReviewState = "none" | "running" | "complete" | "stale";
export type ApprovalState = "none" | "requested" | "approved";
export type DemoRole = "member" | "reviewer";
export type FindingDecision = "open" | "accepted" | "kept";

const GROUP_ORDER: V2Finding["group"][] = ["must_fix", "confirm", "style"];

const COVERAGE_LABEL: Record<CoverageState, string> = {
  answered: "Answered",
  missing: "Missing",
  pending: "Pending",
};

const COVERAGE_TONE: Record<CoverageState, string> = {
  answered: "text-[var(--success)]",
  missing: "text-[var(--danger)]",
  pending: "text-[var(--warning)]",
};

/* ------------------------------------------------ anchored draft editor */

function AnchoredDraftEditor({
  draft,
  findings,
  decisions,
  selectedId,
  onSelect,
  editing,
  onDraft,
}: {
  draft: string;
  findings: V2Finding[];
  decisions: Record<string, FindingDecision>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  editing: boolean;
  onDraft: (value: string) => void;
}) {
  const live = findings.filter(
    (finding) => finding.anchor && draft.includes(finding.anchor) && decisions[finding.id] !== "accepted",
  );

  if (editing) {
    return (
      <textarea
        value={draft}
        onChange={(event) => onDraft(event.target.value)}
        aria-label="Draft text"
        className="min-h-[320px] w-full flex-1 resize-none rounded-lg border border-border bg-card p-4 text-[16px] leading-[1.7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    );
  }

  const paragraphs = draft.split(/\n{2,}/);

  return (
    <div className="text-[16px] leading-[1.7]">
      {paragraphs.map((paragraph, index) => {
        const hit = live.find((finding) => paragraph.includes(finding.anchor));
        const marked = hit
          ? (() => {
              const at = paragraph.indexOf(hit.anchor);
              return [
                paragraph.slice(0, at),
                paragraph.slice(at, at + hit.anchor.length),
                paragraph.slice(at + hit.anchor.length),
              ] as const;
            })()
          : null;
        return (
          <div key={`p-${index}`} className="relative flex gap-3 py-1.5">
            <span
              aria-hidden
              className={cn(
                "mt-2 w-1 shrink-0 rounded-full",
                hit
                  ? hit.group === "must_fix"
                    ? "bg-[var(--danger)]"
                    : hit.group === "confirm"
                      ? "bg-[var(--warning)]"
                      : "bg-[var(--royal)]"
                  : "bg-transparent",
              )}
            />
            <p className="min-w-0 whitespace-pre-line">
              {marked && hit ? (
                <>
                  {marked[0]}
                  <button
                    type="button"
                    onClick={() => onSelect(hit.id)}
                    aria-pressed={selectedId === hit.id}
                    className={cn(
                      "rounded-sm border-b-2 px-0.5 text-left transition-colors duration-150 motion-reduce:transition-none",
                      hit.group === "must_fix"
                        ? "border-[var(--danger)]"
                        : hit.group === "confirm"
                          ? "border-[var(--warning)]"
                          : "border-[var(--royal)]",
                      selectedId === hit.id
                        ? "bg-[var(--royal-wash-strong)] font-medium"
                        : "bg-[var(--royal-wash)] hover:bg-[var(--royal-wash-strong)]",
                    )}
                  >
                    {marked[1]}
                  </button>
                  {marked[2]}
                </>
              ) : (
                paragraph
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------ notes pane */

function FindingCard({
  finding,
  decision,
  selected,
  onSelect,
  onAccept,
  onKeep,
  onEdit,
}: {
  finding: V2Finding;
  decision: FindingDecision;
  selected: boolean;
  onSelect: () => void;
  onAccept: () => void;
  onKeep: () => void;
  onEdit: () => void;
}) {
  return (
    <li
      id={`finding-${finding.id}`}
      className={cn(
        "border-b border-border px-4 py-3.5 transition-colors duration-150 motion-reduce:transition-none",
        selected ? "bg-[var(--royal-wash)]" : "",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span
            aria-hidden
            className={cn(
              "inline-block size-2 rounded-full",
              finding.group === "must_fix"
                ? "bg-[var(--danger)]"
                : finding.group === "confirm"
                  ? "bg-[var(--warning)]"
                  : "bg-[var(--royal)]",
            )}
          />
          {FINDING_GROUP_LABEL[finding.group]}
          {decision === "accepted" ? <span className="text-[var(--success)]">· applied</span> : null}
          {decision === "kept" ? <span>· kept as written</span> : null}
        </span>
        <span className="mt-1.5 block text-[14px] leading-snug">
          {finding.anchor ? (
            <span className="italic text-muted-foreground">“{finding.anchor}”</span>
          ) : (
            <span className="italic text-muted-foreground">Nothing in the draft covers this</span>
          )}
        </span>
        <span className="mt-1.5 block text-[14px] leading-relaxed">{finding.issue}</span>
        <span className="mt-1 block text-[13px] leading-relaxed text-muted-foreground">
          {finding.why}
        </span>
      </button>

      {finding.suggestion ? (
        <p className="mt-2 border-l-2 border-[var(--royal)] pl-3 text-[14px] leading-relaxed">
          {finding.suggestion}
        </p>
      ) : null}

      <div className="mt-2.5 flex flex-wrap gap-2">
        {finding.suggestion ? (
          <button
            type="button"
            onClick={onAccept}
            disabled={decision === "accepted"}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--royal)] px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
          >
            <Check aria-hidden className="size-4" />
            Accept change
          </button>
        ) : null}
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] transition-colors hover:border-[var(--royal)]"
        >
          <Pencil aria-hidden className="size-4" />
          Edit myself
        </button>
        <button
          type="button"
          onClick={onKeep}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <X aria-hidden className="size-4" />
          Keep original
        </button>
      </div>
    </li>
  );
}

/* ------------------------------------------------------- review workspace */

export function DraftReviewWorkspace({
  thread,
  draft,
  goal,
  version,
  reviewState,
  approval,
  role,
  onRole,
  decisions,
  onDraft,
  onAccept,
  onKeep,
  onRerun,
  onRequestApproval,
  onApprove,
  onSend,
  onBack,
  onOpenContext,
  onOpenPerson,
  sentAt,
}: {
  thread: V2Thread;
  draft: string;
  goal: string;
  version: number;
  reviewState: ReviewState;
  approval: ApprovalState;
  role: DemoRole;
  onRole: (role: DemoRole) => void;
  decisions: Record<string, FindingDecision>;
  onDraft: (value: string) => void;
  onAccept: (finding: V2Finding) => void;
  onKeep: (finding: V2Finding) => void;
  onRerun: () => void;
  onRequestApproval: () => void;
  onApprove: () => void;
  onSend: () => void;
  onBack: () => void;
  onOpenContext: () => void;
  onOpenPerson: () => void;
  sentAt: string | null;
}) {
  const [tab, setTab] = useState<"findings" | "coverage" | "judgment">("findings");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const open = thread.findings.filter((finding) => decisions[finding.id] !== "accepted");
  const mustFixOpen = open.filter(
    (finding) => finding.group === "must_fix" && decisions[finding.id] !== "accepted",
  );
  const ordered = useMemo(
    () => [...thread.findings].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)),
    [thread.findings],
  );
  const answered = thread.questions.filter((question) => question.state === "answered").length;

  const ready = reviewState === "complete" && mustFixOpen.length === 0;

  function select(id: string) {
    setSelectedId(id);
    setTab("findings");
    setNotesOpen(true);
  }

  const notes = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-4 border-b border-border px-4">
        {(["findings", "coverage", "judgment"] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setTab(entry)}
            aria-pressed={tab === entry}
            className={cn(
              "-mb-px h-11 border-b-2 text-[13px] capitalize transition-colors duration-150 motion-reduce:transition-none",
              tab === entry
                ? "border-[var(--royal)] font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {entry === "findings"
              ? `${open.length} issues to resolve`
              : entry === "coverage"
                ? `${answered} of ${thread.questions.length} addressed`
                : "What matters here"}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "findings" ? (
          reviewState === "running" ? (
            <p className="px-4 py-4 text-[14px] text-muted-foreground">Reading the draft…</p>
          ) : reviewState === "stale" ? (
            <div className="px-4 py-4">
              <p className="text-[14px]">
                The draft changed after the last review, so these notes no longer describe what is
                written.
              </p>
              <button
                type="button"
                onClick={onRerun}
                className="mt-3 inline-flex h-10 items-center rounded-lg bg-[var(--royal)] px-4 text-[14px] font-medium text-primary-foreground hover:opacity-90"
              >
                Review changes
              </button>
            </div>
          ) : ordered.length === 0 ? (
            <p className="px-4 py-4 text-[14px] text-muted-foreground">
              Nothing to fix. This draft answers what was asked.
            </p>
          ) : (
            <ul>
              {ordered.map((finding) => (
                <FindingCard
                  key={finding.id}
                  finding={finding}
                  decision={decisions[finding.id] ?? "open"}
                  selected={selectedId === finding.id}
                  onSelect={() => setSelectedId(finding.id)}
                  onAccept={() => onAccept(finding)}
                  onKeep={() => onKeep(finding)}
                  onEdit={() => {
                    setSelectedId(finding.id);
                    setEditing(true);
                  }}
                />
              ))}
            </ul>
          )
        ) : null}

        {tab === "coverage" ? (
          <ul className="px-4 py-2">
            {thread.questions.length === 0 ? (
              <li className="py-3 text-[14px] text-muted-foreground">
                Nothing in the source is phrased as a question.
              </li>
            ) : null}
            {thread.questions.map((question) => (
              <li key={question.id} className="border-b border-border py-3 last:border-0">
                <p className={cn("text-[12px]", COVERAGE_TONE[question.state])}>
                  {COVERAGE_LABEL[question.state]}
                </p>
                <button
                  type="button"
                  onClick={onOpenContext}
                  className="mt-1 block text-left text-[14px] leading-snug underline-offset-4 hover:underline"
                >
                  “{question.sourceText}”
                </button>
                {question.answeredBy ? (
                  <p className="mt-1.5 border-l-2 border-border pl-3 text-[13px] leading-relaxed text-muted-foreground">
                    Draft: “{question.answeredBy}”
                  </p>
                ) : null}
                <p className="mt-1 text-[13px] text-muted-foreground">{question.note}</p>
              </li>
            ))}
          </ul>
        ) : null}

        {tab === "judgment" ? (
          <div className="space-y-3 px-4 py-4 text-[14px] leading-relaxed">
            <p>
              <span className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground">
                Fact
              </span>
              <br />
              {thread.judgment.fact}{" "}
              <button
                type="button"
                onClick={onOpenContext}
                className="text-[13px] underline underline-offset-4 text-muted-foreground hover:text-foreground"
              >
                source
              </button>
            </p>
            <p>
              <span className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground">
                Interpretation
              </span>
              <br />
              {thread.judgment.interpretation}
            </p>
            <p>
              <span className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground">
                Next move
              </span>
              <br />
              {thread.judgment.move}
            </p>
            {thread.opportunity ? (
              <p className="border-t border-border pt-3 text-[13px] text-muted-foreground">
                <span className="text-foreground">Private opportunity · hypothesis.</span>{" "}
                {thread.opportunity.hypothesis} {thread.opportunity.timing}{" "}
                <button
                  type="button"
                  onClick={onOpenPerson}
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  Open in relationship
                </button>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-5 py-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {thread.person} · {thread.subject}
        </button>
        <span className="text-[12px] text-muted-foreground">Reviewing draft v{version}</span>
        <button
          type="button"
          onClick={onOpenContext}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] transition-colors hover:border-[var(--royal)]"
        >
          <FileText aria-hidden className="size-4" />
          Source
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col overflow-y-auto px-5 py-4 lg:basis-[62%]">
          <div className="flex items-baseline gap-3">
            <h2 className="font-display text-[15px] font-semibold">Your draft</h2>
            <span className="text-[12px] text-muted-foreground">{goal}</span>
            <button
              type="button"
              onClick={() => setEditing((value) => !value)}
              className="ml-auto text-[13px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {editing ? "Done editing" : "Edit text"}
            </button>
          </div>
          <div className="mt-3 flex-1">
            <AnchoredDraftEditor
              draft={draft}
              findings={thread.findings}
              decisions={decisions}
              selectedId={selectedId}
              onSelect={select}
              editing={editing}
              onDraft={onDraft}
            />
          </div>
          <p className="mt-4 text-[12px] text-muted-foreground">
            Author {thread.owner} · reviewed by Tai's house voice · sending identity{" "}
            {thread.owner}. Author, reviewer and sender stay separate roles.
          </p>
        </section>

        <aside className="hidden min-h-0 w-[360px] shrink-0 border-l border-border lg:flex lg:flex-col">
          {notes}
        </aside>
      </div>

      {/* Notes as a bottom sheet below lg. */}
      {notesOpen ? (
        <div className="fixed inset-x-0 bottom-0 z-30 max-h-[70dvh] rounded-t-xl border-t border-border bg-card shadow-card lg:hidden">
          <div className="flex items-center border-b border-border px-4 py-2">
            <span className="text-[13px] font-medium">Reviewer notes</span>
            <button
              type="button"
              onClick={() => setNotesOpen(false)}
              className="ml-auto inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground"
            >
              <X aria-hidden className="size-[18px]" />
              <span className="sr-only">Close notes</span>
            </button>
          </div>
          <div className="max-h-[58dvh] overflow-y-auto">{notes}</div>
        </div>
      ) : null}

      {/* Approval footer. Reading the review is never approval. */}
      <footer className="shrink-0 border-t border-border px-5 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            onClick={() => setNotesOpen(true)}
            className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-[13px] lg:hidden"
          >
            {open.length} issues
          </button>
          <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
            Demo role
            <select
              value={role}
              onChange={(event) => onRole(event.target.value as DemoRole)}
              className="h-9 rounded-lg border border-border bg-card px-2 text-[13px]"
            >
              <option value="member">Team member</option>
              <option value="reviewer">Authorised reviewer</option>
            </select>
          </label>

          <span className="text-[13px] text-muted-foreground">
            {sentAt
              ? `Simulated send recorded ${sentAt}. No provider was contacted.`
              : reviewState === "stale"
                ? "The draft changed. The previous decision no longer applies."
                : approval === "approved"
                  ? `Approved for v${version}`
                  : approval === "requested"
                    ? "Ready for approval"
                    : mustFixOpen.length > 0
                      ? `${mustFixOpen.length} must-fix ${mustFixOpen.length === 1 ? "issue" : "issues"} outstanding`
                      : reviewState === "complete"
                        ? "Reviewed. No blockers."
                        : "Not reviewed yet"}
          </span>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {reviewState !== "complete" ? (
              <button
                type="button"
                onClick={onRerun}
                className="inline-flex h-10 items-center rounded-lg bg-[var(--royal)] px-4 text-[14px] font-medium text-primary-foreground hover:opacity-90"
              >
                {reviewState === "stale" ? "Review changes" : "Review draft"}
              </button>
            ) : null}
            {reviewState === "complete" && approval === "none" ? (
              <button
                type="button"
                onClick={onRequestApproval}
                disabled={!ready}
                title={ready ? undefined : "A must-fix issue is still open."}
                className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-[14px] transition-colors hover:border-[var(--royal)] disabled:opacity-50"
              >
                Request approval
              </button>
            ) : null}
            {reviewState === "complete" && approval !== "approved" && role === "reviewer" ? (
              <button
                type="button"
                onClick={onApprove}
                disabled={!ready}
                className="inline-flex h-10 items-center rounded-lg bg-[var(--royal)] px-4 text-[14px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                Approve
              </button>
            ) : null}
            {approval === "approved" ? (
              <button
                type="button"
                onClick={onSend}
                className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-[14px] transition-colors hover:border-[var(--royal)]"
              >
                Send (simulated)
              </button>
            ) : null}
          </div>
        </div>
      </footer>
    </div>
  );
}
