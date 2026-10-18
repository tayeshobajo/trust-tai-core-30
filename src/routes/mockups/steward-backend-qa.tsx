/**
 * TEMPORARY fictional QA fixture for the staged workroom backend panels.
 * In-memory fictional data only — no live reads, no writes, no real
 * records. Removed after visual QA. `?off=1` renders the feature-off
 * state (what the live preview shows while flags are OFF).
 */

import { createFileRoute } from "@tanstack/react-router";

import { WorkroomView, type WorkroomBackend } from "@/components/tt/steward/workroom-view";
import { appendLinkedBusinessWork, withMeetingAssociation } from "@/domain/steward-meeting-links";
import { buildWorkroom } from "@/domain/steward-workroom";
import type { BoardTask } from "@/domain/cmd-tasks";
import type { Commitment } from "@/domain/steward";

const MEETING = "00000000-0000-4000-8000-0000000000aa";
const TASK = "00000000-0000-4000-8000-0000000000bb";
const COMMITMENT = "00000000-0000-4000-8000-0000000000cc";

const task = {
  id: TASK,
  organization_id: "org",
  task_visibility: "business",
  title: "Prepare the Soji pilot roadmap review for the founding team",
  status: "in_progress",
  next_action: "Draft the roadmap outline from the meeting transcript",
  notes: "Fictional notes. Mentions https://example.com/plan — not opened or checked.",
  acceptance_criteria: ["Outline covers all agreed phases"],
  context_links: withMeetingAssociation([], MEETING),
  completion_evidence: null,
  owner_user_id: null,
  owner_label: "Fictional Owner",
  due_at: "2026-10-25",
  revision: 3,
} as unknown as BoardTask;

const commitment = {
  id: COMMITMENT,
  organizationId: "org",
  createdAt: "2026-10-18T01:00:00Z",
  updatedAt: "2026-10-18T01:00:00Z",
  conversationId: MEETING,
  what: "Send the revised proposal to the client",
  status: "open",
  ownerName: "Fictional",
  evidence: [],
  sourceKey: "source",
} as Commitment;

const meetings = appendLinkedBusinessWork(
  buildWorkroom(
    [
      {
        id: MEETING,
        title: "Fictional pilot planning call",
        occurredAt: "2026-10-17",
        provider: "fathom",
        sourceUrl: "",
        participantCount: 3,
        segmentCount: 42,
        lastSegmentAt: "53:57",
      },
    ],
    [commitment],
  ),
  [task],
  "org",
);

const OFF = { kind: "unavailable", reason: "Staged, not activated: the reviewed backend contract is not applied." } as const;

function fixtureBackend(off: boolean): WorkroomBackend {
  if (off) {
    return {
      capabilities: {
        preparation: OFF,
        verification: OFF,
        coverage: OFF,
        scope: OFF,
        proposals: OFF,
      },
    };
  }
  const enabled = { kind: "enabled" } as const;
  return {
    capabilities: {
      preparation: enabled,
      verification: enabled,
      coverage: enabled,
      scope: enabled,
      proposals: enabled,
    },
    runsFor: () => ({
      kind: "ready",
      runs: [
        {
          id: "run-1",
          action: "prepare_task_brief",
          status: "complete",
          artifactText:
            "Draft brief (fictional): the pilot roadmap has three phases; phase one needs the transcript decisions reviewed before drafting.",
          artifactDigest: "fictionaldigest1234",
          evidenceRefs: [`transcript:${MEETING}`, `task_notes:${TASK}`],
          failureReason: null,
          clientOperationId: "op-1",
        },
        {
          id: "run-0",
          action: "prepare_task_brief",
          status: "failed",
          artifactText: null,
          artifactDigest: null,
          evidenceRefs: [],
          failureReason: "uncertain: the provider call timed out; outcome unknown",
          clientOperationId: "op-0",
        },
      ],
    }),
    verificationFor: () => ({
      kind: "ready",
      task: { status: "open", revision: 3 },
      receipts: [],
    }),
    meetingState: () => ({
      scope: { kind: "ready", counts: { denominator: 2, verified: 1, pendingProposals: 1 } },
      coverage: { kind: "ready", current: true, attestedAt: "2026-10-17T12:00:00Z" },
      proposals: {
        kind: "ready",
        proposals: [
          {
            id: "prop-1",
            sourceKey: "seg:39:48",
            kind: "roadmap",
            statement: "Roadmap should include a phase for onboarding review",
            status: "proposed",
            evidence: [{ label: "39:48 — “we should add an onboarding review phase”" }],
          },
        ],
      },
    }),
    onRequestRun: async () => ({ kind: "queued", message: "Queued (fictional)" }),
    onExecuteRun: async () => ({ kind: "result", message: "Executed (fictional)" }),
    onVerify: async () => ({ kind: "verified", message: "Verified (fictional)" }),
    onReopen: async () => ({ kind: "reopened", message: "Reopened (fictional)" }),
    onAttestCoverage: async () => ({ kind: "attested", message: "Attested (fictional)" }),
    onSyncProposals: async () => ({ kind: "registered", message: "Registered (fictional)" }),
    onLinkProposal: async () => ({ kind: "linked", message: "Linked (fictional)" }),
    onDismissProposal: async () => ({ kind: "dismissed", message: "Dismissed (fictional)" }),
  };
}

function QaPage() {
  const off = new URLSearchParams(window.location.search).get("off") === "1";
  return (
    <div className="min-h-screen bg-background">
      <WorkroomView
        meetings={meetings}
        commitmentFor={() => commitment}
        receiptsFailed={false}
        sync={{
          running: false,
          failure: null,
          lastSuccessAt: null,
          added: 0,
          refreshed: 0,
          unchanged: 0,
          preserved: 0,
          warnings: [],
          pendingTranscript: 0,
          hasMore: false,
          onRetry: () => {},
        }}
        headerMenu={null}
        accountSlot={null}
        linkedRead={{ state: "ready", truncated: false }}
        backend={fixtureBackend(off)}
      />
    </div>
  );
}

export const Route = createFileRoute("/mockups/steward-backend-qa")({
  component: QaPage,
  ssr: false,
  head: () => ({ meta: [{ title: "Steward backend QA fixture (fictional)" }] }),
});
