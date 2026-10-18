/**
 * TEMPORARY fictional QA fixture for the staged Steward backend panels.
 * In-memory fixtures only — no live data, no flags, no writes. This route
 * exists for independent browser screenshots and is removed after QA.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  ScopeReviewPanel,
  VerificationPanel,
} from "@/components/tt/steward/workroom-backend-panels";

export const Route = createFileRoute("/mockups/steward-backend-qa")({
  component: StewardBackendQa,
});

const enabled = { kind: "enabled" as const };

function StewardBackendQa() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4">
      <h1 className="text-lg font-semibold">Fictional backend panel QA</h1>
      <VerificationPanel
        capability={enabled}
        state={{
          kind: "ready",
          verified: true,
          task: { status: "complete", revision: 4 },
          receipts: [
            {
              id: "r1",
              kind: "verify",
              note: "Fictional verification with recorded evidence",
              actorId: "aaaaaaaa-0000-0000-0000-000000000000",
              createdAt: "2026-01-02T10:00:00.000Z",
            },
            {
              id: "r2",
              kind: "reopen",
              note: "Fictional reopen reason preserved in history",
              actorId: "bbbbbbbb-0000-0000-0000-000000000000",
              createdAt: "2026-01-03T10:00:00.000Z",
            },
          ],
        }}
        task={{ id: "t1", title: "Fictional required task", revision: 4, status: "complete" } as never}
        onVerify={async () => ({ kind: "verified" })}
        onReopen={async () => ({ kind: "reopened" })}
      />
      <ScopeReviewPanel
        scope={{
          kind: "ready",
          counts: { denominator: 2, verified: 1, pendingProposals: 1 },
          items: [
            {
              id: "item-1",
              taskId: "00000000-0000-4000-8000-000000000099",
              classification: "manual_required",
              removedAt: null,
            },
            {
              id: "item-2",
              taskId: "00000000-0000-4000-8000-000000000100",
              classification: "transcript",
              removedAt: "2026-01-05T10:00:00.000Z",
            },
          ],
        }}
        coverage={{ kind: "ready", current: false, attestedAt: null }}
        proposals={{
          kind: "ready",
          proposals: [
            {
              id: "prop-1",
              sourceKey: "seg-3948",
              kind: "task",
              statement: "Fictional proposal: prepare the orthodontic roadmap handoff",
              status: "proposed",
              evidence: [{ label: "39:48 roadmap mention" }],
            },
          ],
          decisions: [],
        }}
        scopeCapability={enabled}
        coverageCapability={enabled}
        proposalCapability={enabled}
        linkTargets={[
          { id: "00000000-0000-4000-8000-000000000099", title: "Fictional required task" },
        ]}
        expectedSource={{ transcriptHash: "fictional-hash", scopeVersion: 1 }}
        onAttestCoverage={async () => ({ kind: "applied" })}
        onSyncProposals={async () => ({ kind: "applied" })}
        onSyncRequiredScope={async () => ({ kind: "applied" })}
        onLinkProposal={async () => ({ kind: "applied" })}
        onDismissProposal={async () => ({ kind: "applied" })}
        onRemoveScopeItem={async () => ({ kind: "applied" })}
        onReinstateScopeItem={async () => ({ kind: "applied" })}
      />
    </main>
  );
}
