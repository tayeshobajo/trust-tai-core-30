/**
 * MOCKUP ONLY — the Comms v2 workspace container.
 *
 * One workspace, three modes: conversation, new review intake, focused review.
 * All state is local React state over invented fixtures. No Supabase read or
 * write, no model run, no approval record, no send.
 */

import { useState } from "react";

import {
  V2_CONTEXT_FILES,
  V2_INTAKE_SAMPLE,
  v2ThreadById,
  type V2Finding,
  type WorkState,
} from "@/data/mockups/comms-workspace-v2";
import { MockCommsShell } from "./shell";
import { WorkList } from "./work-list";
import { ConversationWorkspace } from "./conversation";
import { ReviewIntake } from "./intake";
import {
  DraftReviewWorkspace,
  type ApprovalState,
  type DemoRole,
  type FindingDecision,
  type ReviewState,
} from "./review";
import { ContextDrawer, RelationshipDrawer } from "./drawers";

export function CommsWorkspaceV2() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | WorkState>("all");
  const [selectedId, setSelectedId] = useState("t-northlight");
  const [view, setView] = useState<"conversation" | "intake" | "review">("conversation");

  const thread = v2ThreadById(selectedId);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [goals, setGoals] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(1);
  const [reviewState, setReviewState] = useState<ReviewState>("none");
  const [approval, setApproval] = useState<ApprovalState>("none");
  const [role, setRole] = useState<DemoRole>("member");
  const [decisions, setDecisions] = useState<Record<string, FindingDecision>>({});
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [humourOn, setHumourOn] = useState(false);
  const [keptOpportunity, setKeptOpportunity] = useState(false);
  const [drawer, setDrawer] = useState<"none" | "person" | "context">("none");

  // Intake keeps its own text, so switching views never discards it.
  const [intakeContext, setIntakeContext] = useState("");
  const [intakeDraft, setIntakeDraft] = useState("");
  const [intakeRecipient, setIntakeRecipient] = useState(V2_INTAKE_SAMPLE.recipient);
  const [intakeGoal, setIntakeGoal] = useState(V2_INTAKE_SAMPLE.goal);

  const draft = drafts[thread.id] ?? thread.draft;
  const goal = goals[thread.id] ?? thread.goal;

  function setDraft(value: string) {
    setDrafts((current) => ({ ...current, [thread.id]: value }));
    // Any change immediately invalidates a visible ready or approved state.
    if (reviewState === "complete") setReviewState("stale");
    if (approval !== "none") setApproval("none");
    setSentAt(null);
  }

  function selectThread(id: string) {
    setSelectedId(id);
    setView("conversation");
    setReviewState("none");
    setApproval("none");
    setDecisions({});
    setVersion(1);
    setSentAt(null);
    setDrawer("none");
  }

  function runReview() {
    setReviewState("running");
    setView("review");
    window.setTimeout(() => setReviewState("complete"), 450);
  }

  function acceptFinding(finding: V2Finding) {
    if (!finding.suggestion) return;
    const next = finding.anchor
      ? draft.replace(finding.anchor, finding.suggestion)
      : `${draft}\n\n${finding.suggestion}`;
    setDrafts((current) => ({ ...current, [thread.id]: next }));
    setDecisions((current) => ({ ...current, [finding.id]: "accepted" }));
    setVersion((current) => current + 1);
    setReviewState("stale");
    setApproval("none");
    setSentAt(null);
  }

  function keepFinding(finding: V2Finding) {
    setDecisions((current) => ({ ...current, [finding.id]: "kept" }));
  }

  const listVisible = view !== "review";

  return (
    <MockCommsShell
      search={search}
      onSearch={setSearch}
      onNewReview={() => {
        setView("intake");
        setDrawer("none");
      }}
    >
      <div className="relative flex h-full min-h-0 overflow-hidden rounded-none border-0 border-border bg-card md:rounded-xl md:border">
        {listVisible ? (
          <div className="hidden w-[300px] shrink-0 border-r border-border md:block">
            <WorkList
              selectedId={selectedId}
              filter={filter}
              onFilter={setFilter}
              onSelect={selectThread}
              search={search}
            />
          </div>
        ) : null}

        <div className="min-w-0 flex-1">
          {view === "conversation" ? (
            <ConversationWorkspace
              thread={thread}
              draft={draft}
              goal={goal}
              onGoal={(value) => setGoals((current) => ({ ...current, [thread.id]: value }))}
              onDraft={setDraft}
              onReview={runReview}
              onOpenPerson={() => setDrawer("person")}
              onOpenContext={() => setDrawer("context")}
              humourOn={humourOn}
              onHumour={setHumourOn}
            />
          ) : null}

          {view === "intake" ? (
            <ReviewIntake
              context={intakeContext}
              draft={intakeDraft}
              recipient={intakeRecipient}
              goal={intakeGoal}
              onContext={setIntakeContext}
              onDraft={setIntakeDraft}
              onRecipient={setIntakeRecipient}
              onGoal={setIntakeGoal}
              onBack={() => setView("conversation")}
              onReview={() => {
                setDrafts((current) => ({ ...current, [thread.id]: intakeDraft }));
                setGoals((current) => ({ ...current, [thread.id]: intakeGoal }));
                runReview();
              }}
            />
          ) : null}

          {view === "review" ? (
            <DraftReviewWorkspace
              thread={thread}
              draft={draft}
              goal={goal}
              version={version}
              reviewState={reviewState}
              approval={approval}
              role={role}
              onRole={setRole}
              decisions={decisions}
              onDraft={setDraft}
              onAccept={acceptFinding}
              onKeep={keepFinding}
              onRerun={runReview}
              onRequestApproval={() => setApproval("requested")}
              onApprove={() => setApproval("approved")}
              onSend={() => setSentAt("just now")}
              onBack={() => setView("conversation")}
              onOpenContext={() => setDrawer("context")}
              onOpenPerson={() => setDrawer("person")}
              sentAt={sentAt}
            />
          ) : null}
        </div>

        {drawer === "person" ? (
          <RelationshipDrawer
            thread={thread}
            onClose={() => setDrawer("none")}
            onKeepForLater={() => setKeptOpportunity(true)}
            opportunityKept={keptOpportunity}
          />
        ) : null}
        {drawer === "context" ? (
          <ContextDrawer
            thread={thread}
            files={view === "conversation" ? [] : V2_CONTEXT_FILES}
            onClose={() => setDrawer("none")}
          />
        ) : null}
      </div>
    </MockCommsShell>
  );
}
