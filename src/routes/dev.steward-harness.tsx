/**
 * TEMPORARY local QA harness — fictional data only, deleted after capture.
 * Renders the real WorkroomView in the receipts-failed state so the
 * suppressed verification UI can be screenshot-verified. No network, no
 * auth, no live data.
 */
import { createFileRoute } from "@tanstack/react-router";

import type { Commitment } from "@/domain/steward";
import { buildWorkroom } from "@/domain/steward-workroom";
import { WorkroomView } from "@/components/tt/steward/workroom-view";

export const Route = createFileRoute("/dev/steward-harness")({
  component: Harness,
  head: () => ({ meta: [{ title: "Steward QA harness (fictional)" }, { name: "robots", content: "noindex" }] }),
});

const TASKS: [string, string, Commitment["status"]][] = [
  ["Send the revised pricing proposal to the client with the updated payment schedule and onboarding timeline attached", "Tai", "kept"],
  ["Book the follow-up call with the operations team", "Amara", "kept"],
  ["Draft the onboarding checklist for the new workspace", "Tai", "kept"],
  ["Share the brand guidelines PDF with the design partner", "Amara", "open"],
  ["Confirm the invoice date with finance", "Tai", "open"],
  ["Prepare the quarterly review agenda", "Amara", "open"],
  ["Update the roadmap tracker with the new milestones", "Tai", "open"],
  ["Schedule the site visit for next week", "Amara", "open"],
  ["Collect signed consent forms from all participants", "Tai", "open"],
  ["Write the launch announcement draft", "Amara", "open"],
];

const commitments: Commitment[] = TASKS.map(([what, owner, status], i) => ({
  id: `c${i + 1}`,
  organizationId: "fictional-org",
  conversationId: "m1",
  ownerName: owner,
  ownerUserId: `u-${owner.toLowerCase()}`,
  what,
  status,
  sourceKey: `s${i + 1}`,
  evidence: [{ kind: "quote", label: `“${what.slice(0, 60)}…”` }],
  createdAt: "2026-10-16T09:00:00Z",
  updatedAt: "2026-10-16T09:00:00Z",
})) as Commitment[];

const meetings = buildWorkroom(
  [
    {
      id: "m1",
      title: "Weekly operations sync — Fictional QA data",
      occurredAt: "2026-10-16T09:00:00Z",
      provider: "fathom",
      sourceUrl: "https://fathom.video/calls/fictional",
      participantCount: 4,
      segmentCount: 128,
      lastSegmentAt: "00:47:12",
      coverageConfirmed: false,
    },
  ],
  commitments,
  /* Receipts failed to read: the map is empty, so nothing qualifies as
     verified — exactly what the screenshot must show. */
  new Map(),
  new Map([["m1", 1]]),
);

const byId = new Map(commitments.map((c) => [c.id, c]));

function Harness() {
  return (
    <div>
      <p className="bg-warning/15 px-4 py-1 text-center text-xs font-medium text-foreground">
        Fictional QA data — harness only, no live workspace
      </p>
      <WorkroomView
        meetings={meetings}
        commitmentFor={(id) => byId.get(id)}
        receiptsFailed={true}
        sync={{
          running: false,
          failure: null,
          lastSuccessAt: "2026-10-17T09:00:00Z",
          added: 0,
          refreshed: 0,
          pendingTranscript: 0,
          hasMore: false,
          onRetry: () => {},
        }}
        headerMenu={<span className="text-xs text-muted-foreground">More</span>}
        accountSlot={
          <span className="flex size-8 items-center justify-center rounded-full bg-secondary text-xs text-muted-foreground">
            QA
          </span>
        }
      />
    </div>
  );
}
