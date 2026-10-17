/**
 * TEMPORARY QA harness — fictional data only, deleted after screenshot
 * capture. Renders the real presentational WorkroomView with injected
 * fictional props so layout can be reviewed without a session. Nothing here
 * reads or writes live data.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import { WorkroomView, type WorkroomSyncState } from "@/components/tt/steward/workroom-view";
import type { Commitment } from "@/domain/steward";
import type { WorkroomMeeting, WorkroomRow } from "@/domain/steward-workroom";

export const Route = createFileRoute("/mockups/steward-qa")({
  component: StewardQaHarness,
  head: () => ({
    meta: [
      { title: "Steward QA harness — fictional data" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

const OWNERS = ["Tai", "Maya", "Jonas", "Unassigned"];
const WHAT = [
  "Send the revised proposal with updated pricing",
  "Confirm the onboarding date with the client",
  "Draft the follow-up note from the discovery call",
  "Share the contract redlines with legal",
  "Book the next check-in before Friday",
  "Update the roadmap with the agreed milestones",
  "Prepare the demo environment for the walkthrough",
  "Collect the missing billing details",
  "Write the summary for the leadership update",
  "Review the draft agreement clause by clause",
  "Circulate the meeting notes to everyone who attended",
  "Chase the outstanding signature on the order form",
];

function fictionalRow(i: number): WorkroomRow {
  const verified = i < 3;
  return {
    id: `row-${i}`,
    what: WHAT[i]!,
    owner: { label: OWNERS[i % OWNERS.length]!, verified: i % 4 !== 3 },
    due: { label: i % 3 === 0 ? "Unknown" : `2026-10-${20 + i}`, exact: i % 3 !== 0 },
    status: verified ? "kept" : i % 2 === 0 ? "kept" : "open",
    kept: verified || i % 2 === 0,
    verified,
    receipt: verified
      ? {
          taskKey: `commitment:row-${i}`,
          completedAt: "2026-10-16T14:32:00Z",
          completionNote: "Done and confirmed with the client on the follow-up call.",
          completedBy: "Tai",
        }
      : null,
    evidenceCount: 1,
    sourceKey: `src-${i}`,
  };
}

function fictionalMeeting(id: string, title: string, rows: WorkroomRow[]): WorkroomMeeting {
  const done = rows.filter((r) => r.verified).length;
  const agreed = rows.length;
  return {
    id,
    title,
    occurredAt: "2026-10-15T09:00:00Z",
    provider: "fathom",
    sourceUrl: "https://fathom.video/calls/fictional",
    participantCount: 4,
    segmentCount: 212,
    lastSegmentAt: "2026-10-15T09:58:00Z",
    coverageConfirmed: false,
    rows,
    agreed,
    done,
    needsVerification: rows.filter((r) => r.kept && !r.verified).length,
    coverage: "unknown",
    openProposals: 1,
    score: agreed === 0 ? null : Math.round((done / agreed) * 100),
    remark: `${agreed - done} agreed tasks still need verified completion, and transcript coverage is not confirmed.`,
  };
}

const FICTIONAL_COMMITMENT = {
  id: "row-0",
  evidence: [{ label: "“I'll send the revised proposal with updated pricing by Thursday.”" }],
} as unknown as Commitment;

const SYNC_IDLE: WorkroomSyncState = {
  running: false,
  failure: null,
  lastSuccessAt: "2026-10-17T23:40:00Z",
  added: 0,
  refreshed: 0,
  pendingTranscript: 0,
  hasMore: false,
  onRetry: () => {},
};

function StewardQaHarness() {
  const state = new URLSearchParams(window.location.search).get("state") ?? "normal";
  const meetings = useMemo(
    () =>
      state === "empty"
        ? []
        : [
            fictionalMeeting(
              "m1",
              "Weekly partnership sync — pricing, onboarding and the outstanding signature on the order form",
              Array.from({ length: 12 }, (_, i) => fictionalRow(i)),
            ),
            fictionalMeeting("m2", "Discovery call — Northwind", [fictionalRow(3)]),
          ],
    [state],
  );
  return (
    <div>
      <p className="bg-warning/15 px-4 py-1 text-center text-xs font-semibold text-warning">
        Fictional QA data — harness only, no live records
      </p>
      <WorkroomView
        meetings={meetings}
        commitmentFor={(id) => (id === "row-0" ? FICTIONAL_COMMITMENT : undefined)}
        receiptsFailed={state === "receipts-failed"}
        sync={state === "loading" ? { ...SYNC_IDLE, running: true, lastSuccessAt: null } : SYNC_IDLE}
        headerMenu={<span className="text-xs text-muted-foreground">More</span>}
        accountSlot={
          <span className="flex size-8 items-center justify-center rounded-full bg-secondary text-xs text-muted-foreground">
            TA
          </span>
        }
      />
    </div>
  );
}
