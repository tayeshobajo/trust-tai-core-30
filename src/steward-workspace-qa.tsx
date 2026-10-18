/* TEMPORARY fictional QA harness — removed after screenshot verification.
   Renders WorkroomView with in-memory fictional data only; no live reads. */
import { createRoot } from "react-dom/client";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { useState } from "react";

import "./styles.css";
import { WorkroomView } from "@/components/tt/steward/workroom-view";
import type { WorkroomMeeting } from "@/domain/steward-workroom";
import type { BoardTask } from "@/domain/cmd-tasks";

const boardTask = (over: Partial<BoardTask>): BoardTask =>
  ({
    id: crypto.randomUUID(),
    organization_id: "fiction",
    title: "Task",
    task_visibility: "business",
    owner_user_id: null,
    owner_label: null,
    created_by: "u1",
    status: "open",
    next_action: "",
    blocked_because: "",
    depends_on_task_id: null,
    parent_task_id: null,
    completion_evidence: "",
    completed_at: null,
    completed_by: null,
    archived_at: null,
    due_at: null,
    updated_at: "2026-10-17T09:00:00Z",
    revision: 3,
    acceptance_criteria: [],
    context_links: [],
    notes: null,
    correlation_id: null,
    ...over,
  }) as BoardTask;

const soji1 = boardTask({
  title: "Soji — Artist website mockup for the label launch page",
  owner_label: "Ana",
  status: "in_progress",
  next_action: "Prepare the first mockup pass for review.",
  acceptance_criteria: ["Mockup reviewed by Ana", "Matches the agreed visual direction"],
  context_links: [{ label: "Brief", url: "https://example.com/brief" }],
  notes: "Direction discussed in the call; assets not yet received.",
});
const soji2 = boardTask({
  title: "Soji — Phased artist-growth roadmap for the label roster",
  owner_label: "Ben",
  due_at: "2026-10-30T00:00:00.000Z",
  next_action: "Draft the phase outline.",
});
const required = boardTask({
  title: "Soji — Confirm launch date with the distributor",
  correlation_id: "cmd-meeting-required:v1:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222",
  context_links: [
    {
      label: "Steward meeting association",
      url: "https://cmd.trusttai.com/modules/steward/meetings/11111111-1111-4111-8111-111111111111",
    },
  ],
});

const meetings: WorkroomMeeting[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Soji weekly sync",
    occurredAt: "2026-10-16T10:00:00Z",
    provider: "fathom",
    sourceUrl: "https://fathom.video/example",
    participantCount: 3,
    segmentCount: 214,
    lastSegmentAt: "00:58:12",
    coverage: "unknown",
    openProposals: 4,
    agreed: 1,
    done: 0,
    needsVerification: 1,
    score: 0,
    remark: "0 of 1 verified. 1 still open, transcript coverage is not confirmed, 4 unreviewed proposals.",
    requiredWork: { total: 1, verified: 0, denominator: 2 },
    linkedWork: { total: 2, open: 2 },
    rows: [
      {
        kind: "commitment",
        id: "c1",
        what: "Send the revised proposal to the label",
        owner: { label: "Ana (said)", verified: false },
        due: { label: "“next week”", exact: false },
        status: "kept",
        kept: true,
        verified: false,
        receipt: null,
        evidenceCount: 1,
        sourceKey: "k1",
      },
      {
        kind: "business-task",
        id: soji1.id,
        boardTask: soji1,
        what: soji1.title,
        owner: { label: "Ana", verified: false },
        due: { label: "No date", exact: false },
        status: "In progress",
        kept: false,
        verified: false,
        receipt: null,
        evidenceCount: 1,
        sourceKey: "linked-business-task",
      },
      {
        kind: "business-task",
        id: soji2.id,
        boardTask: soji2,
        what: soji2.title,
        owner: { label: "Ben", verified: false },
        due: { label: "2026-10-30", exact: true },
        status: "Planned",
        kept: false,
        verified: false,
        receipt: null,
        evidenceCount: 0,
        sourceKey: "linked-business-task",
      },
      {
        kind: "required-task",
        id: required.id,
        boardTask: required,
        what: required.title,
        owner: { label: "Unassigned", verified: false },
        due: { label: "No date", exact: false },
        status: "Verification unavailable",
        kept: false,
        verified: false,
        receipt: null,
        evidenceCount: 1,
        sourceKey: "manually-required-work",
      },
    ],
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    title: "Mental Dental onboarding",
    occurredAt: "2026-10-14T14:00:00Z",
    provider: "fathom",
    sourceUrl: "",
    participantCount: 2,
    segmentCount: 96,
    lastSegmentAt: "00:31:40",
    coverage: "unknown",
    openProposals: 0,
    agreed: 0,
    done: 0,
    needsVerification: 0,
    score: null,
    remark: "No promises confirmed from this meeting yet. Review it to confirm what was agreed.",
    rows: [],
  },
];

function Qa() {
  const [selection, setSelection] = useState<{ meetingId: string | null; rowKey: string | null }>({
    meetingId: null,
    rowKey: null,
  });
  const [edited, setEdited] = useState("");
  return (
    <div>
      {edited ? (
        <p role="status" className="bg-secondary p-2 text-xs">
          Editor would open focused on: {edited}
        </p>
      ) : null}
      <WorkroomView
        meetings={meetings}
        commitmentFor={() => undefined}
        receiptsFailed={false}
        sync={{
          running: false,
          failure: null,
          lastSuccessAt: "2026-10-18T03:30:00Z",
          added: 0,
          refreshed: 0,
          unchanged: 2,
          preserved: 0,
          warnings: [],
          pendingTranscript: 0,
          hasMore: false,
          onRetry: () => {},
        }}
        headerMenu={null}
        accountSlot={null}
        selection={selection}
        onSelect={(meetingId, rowKey) => setSelection({ meetingId, rowKey })}
        onEditTaskField={(row, field) => setEdited(`${field} · ${row.what}`)}
        taskById={(id) => [soji1, soji2, required].find((t) => t.id === id)}
        linkedRead={{ state: "ready", truncated: false }}
      />
    </div>
  );
}

const rootRoute = createRootRoute({ component: Qa });
const router = createRouter({
  routeTree: rootRoute,
  history: createMemoryHistory({ initialEntries: ["/"] }),
});
createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
