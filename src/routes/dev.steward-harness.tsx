/**
 * TEMPORARY visual-QA harness for the Steward workroom view. Renders the
 * real presentational WorkroomView with clearly fictional injected data —
 * no auth, no network, no writes. Deleted after screenshot QA.
 */

import { createFileRoute } from "@tanstack/react-router";

import { WorkroomView } from "@/components/tt/steward/workroom-view";
import type { Commitment } from "@/domain/steward";
import { buildWorkroom, receiptKey, type CompletionReceipt } from "@/domain/steward-workroom";

const TITLES = [
  "Approve the launch page copy",
  "Build the launch page",
  "Share the decisions and build order",
  "Collect the approved image assets",
  "Check analytics access before launch",
  "Review the mobile launch layout",
  "Test the enquiry form",
  "Map the old page redirects",
  "Review consent language",
  "Prepare the launch handover",
  "Confirm the page structure",
  "Share the working asset folder with the whole delivery team including contractors",
];
const OWNERS = ["Morgan", "Sam", "Alex", "Morgan", "Unassigned", "Morgan", "Sam", "Alex", "Morgan", "Alex", "Morgan", "Sam"];

const commitments: Commitment[] = TITLES.map((what, i) => ({
  id: `fictional-${i}`,
  organizationId: "fictional",
  conversationId: "fictional-call",
  ownerName: OWNERS[i] === "Unassigned" ? undefined : OWNERS[i],
  ownerUserId: OWNERS[i] === "Unassigned" ? undefined : `u-${i}`,
  what,
  status: [3, 10, 11].includes(i) ? "kept" : "open",
  sourceKey: `k-${i}`,
  evidence: [{ label: "We agreed Morgan would approve the copy before the build starts." }],
  dueText: i % 3 === 0 ? "today" : undefined,
  createdAt: "",
  updatedAt: "",
}));

const receipts = new Map<string, CompletionReceipt>(
  [3, 10, 11].map((i) => [
    receiptKey(`fictional-${i}`),
    {
      taskKey: receiptKey(`fictional-${i}`),
      completedAt: `2026-10-17T14:${10 + i}:00Z`,
      completionNote: "Verified against the agreed message and shared in the project channel.",
      completedBy: OWNERS[i],
    },
  ]),
);

const meetings = buildWorkroom(
  [
    {
      id: "fictional-call",
      title: "Weekly delivery check-in",
      occurredAt: "2026-10-17T14:00:00Z",
      provider: "fathom",
      sourceUrl: "https://fathom.video/calls/example",
      participantCount: 3,
      segmentCount: 633,
      lastSegmentAt: "01:06:45",
    },
    {
      id: "fictional-call-2",
      title: "Website discovery",
      occurredAt: "2026-10-15T10:00:00Z",
      provider: "fathom",
      sourceUrl: "",
      participantCount: 4,
      segmentCount: 210,
      lastSegmentAt: "00:44:10",
    },
  ],
  commitments,
  receipts,
  new Map([["fictional-call", 1]]),
);

export const Route = createFileRoute("/dev/steward-harness")({
  head: () => ({ meta: [{ title: "Steward harness (fictional)" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <WorkroomView
      meetings={meetings}
      commitmentFor={(id) => commitments.find((c) => c.id === id)}
      receiptsFailed={false}
      sync={{
        running: false,
        failure: null,
        lastSuccessAt: "2026-10-17T15:04:00Z",
        added: 2,
        refreshed: 0,
        pendingTranscript: 1,
        hasMore: true,
        onRetry: () => {},
      }}
      headerMenu={<span className="text-xs text-muted-foreground">Fictional harness</span>}
      accountSlot={
        <span className="flex size-8 items-center justify-center rounded-full bg-secondary text-xs text-muted-foreground">
          JD
        </span>
      }
    />
  ),
});
