/**
 * TEMPORARY fictional QA fixture for the staged Steward backend panels.
 * In-memory only; no live data, no writes. Removed after screenshot QA.
 */
import { createFileRoute } from "@tanstack/react-router";
import React from "react";

import type { BoardTask } from "@/domain/cmd-tasks";
import type { WorkroomMeeting } from "@/domain/steward-workroom";
import {
  WorkroomView,
  type WorkroomBackend,
  type WorkroomSyncState,
} from "@/components/tt/steward/workroom-view";
import type { ActionOutcome } from "@/components/tt/steward/workroom-backend-panels";

export const Route = createFileRoute("/mockups/steward-backend-qa")({
  component: StewardBackendQa,
});

const ORG = "11111111-1111-4111-8111-111111111111";
const MEETING = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TASK1 = "10000000-0000-4000-8000-000000000001";
const TASK2 = "10000000-0000-4000-8000-000000000002";

function boardTask(id: string, title: string, revision: number): BoardTask {
  return {
    id,
    organization_id: ORG,
    title,
    task_visibility: "business",
    owner_user_id: "aaaaaaaa-0000-4000-8000-000000000000",
    owner_label: "Tai",
    created_by: "aaaaaaaa-0000-4000-8000-000000000000",
    status: "in_progress",
    next_action: "Draft the review outline and share it for comment.",
    blocked_because: "",
    depends_on_task_id: null,
    parent_task_id: null,
    completion_evidence: "",
    completed_at: null,
    completed_by: null,
    archived_at: null,
    due_at: "2026-10-24T09:00:00.000Z",
    updated_at: "2026-10-17T12:00:00.000Z",
    revision,
    acceptance_criteria: ["Outline reviewed by Tai", "Roadmap statements cross-checked"],
    context_links: [],
    notes:
      "Fictional notes with a mentioned link https://example.invalid/spec — mentioned links are not read.",
    correlation_id: null,
  };
}

const meetings: WorkroomMeeting[] = [
  {
    id: MEETING,
    title: "Fictional pilot planning call",
    occurredAt: "2026-10-16T14:00:00.000Z",
    provider: "fathom",
    sourceUrl: "https://fathom.invalid/calls/1",
    participantCount: 3,
    segmentCount: 42,
    lastSegmentAt: "2026-10-16T14:45:00.000Z",
    rows: [
      {
        kind: "required-task",
        boardTask: boardTask(TASK1, "Prepare the Soji pilot roadmap review", 3),
        id: `required:${TASK1}`,
        what: "Prepare the Soji pilot roadmap review",
        owner: { label: "Tai", verified: true },
        due: { label: "Oct 24", exact: true },
        status: "In progress",
        kept: false,
        verified: false,
        receipt: null,
        evidenceCount: 0,
        sourceKey: "manual-required",
      },
      {
        kind: "business-task",
        boardTask: boardTask(TASK2, "Share the pricing worksheet with the clinic", 1),
        id: `business:${TASK2}`,
        what: "Share the pricing worksheet with the clinic",
        owner: { label: "Tai", verified: true },
        due: { label: "No date recorded", exact: false },
        status: "Planned",
        kept: false,
        verified: false,
        receipt: null,
        evidenceCount: 0,
        sourceKey: "linked",
      },
    ],
    agreed: 1,
    done: 0,
    needsVerification: 0,
    coverage: "unknown",
    openProposals: 1,
    score: null,
    remark: "2 recorded tasks; scope review pending",
  },
];

const ok: ActionOutcome = { kind: "applied" };

const backend: WorkroomBackend = {
  capabilities: {
    preparation: { kind: "enabled" },
    verification: { kind: "enabled" },
    coverage: { kind: "enabled" },
    scope: { kind: "enabled" },
    proposals: { kind: "enabled" },
  },
  scoreFor: (meetingId) =>
    meetingId === MEETING
      ? {
          kind: "ready",
          snapshot: {
            denominator: 1,
            verified: 0,
            pendingProposals: 1,
            coverageCurrent: false,
            attestedAt: null,
            scopeVersion: 4,
            complete: false,
          },
        }
      : undefined,
  runsFor: (taskId) =>
    taskId === TASK1
      ? {
          kind: "ready",
          truncated: true,
          runs: [
            {
              id: "run-1",
              action: "prepare_brief",
              status: "complete",
              artifactText: "Fictional draft brief for review only.",
              artifactDigest: "abcdef0123456789",
              evidenceRefs: ["transcript:dddddddd", "task_notes:10000000"],
              failureReason: null,
              clientOperationId: "op-1",
            },
            {
              id: "run-2",
              action: "prepare_brief",
              status: "failed",
              artifactText: null,
              artifactDigest: null,
              evidenceRefs: [],
              failureReason: "uncertain: worker timed out before confirming",
              clientOperationId: "op-2",
            },
          ],
        }
      : { kind: "ready", runs: [], truncated: false },
  verificationFor: (taskId) =>
    taskId === TASK1
      ? {
          kind: "ready",
          task: { status: "open", revision: 3 },
          receipts: [
            {
              id: "r1",
              kind: "verify",
              note: "Fictional verification receipt",
              actorId: "aaaaaaaa-0000-4000-8000-000000000000",
              createdAt: "2026-10-16T15:00:00.000Z",
            },
            {
              id: "r2",
              kind: "reopen",
              note: "Fictional reopen — evidence was withdrawn",
              actorId: "aaaaaaaa-0000-4000-8000-000000000000",
              createdAt: "2026-10-16T16:00:00.000Z",
            },
          ],
        }
      : { kind: "ready", task: { status: "open", revision: 1 }, receipts: [] },
  meetingState: (meetingId) =>
    meetingId === MEETING
      ? {
          scope: { kind: "ready", counts: { denominator: 1, verified: 0, pendingProposals: 1 } },
          coverage: { kind: "ready", current: false, attestedAt: null },
          proposals: {
            kind: "ready",
            proposals: [
              {
                id: "prop-1",
                sourceKey: "ext-3948",
                kind: "action",
                statement: "Fictional: send the roadmap draft before Friday.",
                status: "proposed",
                evidence: [{ label: "39:48" }, { label: "39:59" }, { label: "40:03" }],
              },
            ],
            decisions: [
              {
                proposalId: null,
                kind: "register",
                reason: null,
                actorId: "aaaaaaaa-0000-4000-8000-000000000000",
                createdAt: "2026-10-16T15:10:00.000Z",
                taskId: null,
              },
            ],
          },
        }
      : undefined,
  onRequestRun: async () => ok,
  onExecuteRun: async () => ok,
  onVerify: async () => ({ kind: "verified" }),
  onReopen: async () => ({ kind: "reopened" }),
  onAttestCoverage: async () => ok,
  onSyncProposals: async () => ok,
  onSyncRequiredScope: async () => ok,
  onLinkProposal: async () => ok,
  onDismissProposal: async () => ok,
};

const sync: WorkroomSyncState = {
  running: false,
  failure: null,
  lastSuccessAt: "2026-10-17T12:00:00.000Z",
  added: 0,
  refreshed: 0,
  unchanged: 1,
  preserved: 0,
  warnings: [],
  pendingTranscript: 0,
  hasMore: false,
  onRetry: () => {},
};

function StewardBackendQa() {
  return (
    <WorkroomView
      meetings={meetings}
      commitmentFor={() => undefined}
      receiptsFailed={false}
      sync={sync}
      headerMenu={<span className="text-xs text-muted-foreground">Fictional QA</span>}
      accountSlot={null}
      backend={backend}
      taskById={(id) =>
        id === TASK1 ? boardTask(TASK1, "Prepare the Soji pilot roadmap review", 3) : undefined
      }
      mayEditTask={() => true}
      onAddRequiredTask={async () => {}}
      linkedRead={{ state: "ready", truncated: false }}
    />
  );
}
