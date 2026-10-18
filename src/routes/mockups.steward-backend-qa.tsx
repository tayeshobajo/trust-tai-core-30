/**
 * FICTIONAL QA PREVIEW — no backend, no live flags, no real records.
 * Renders the staged Steward backend panels against in-memory fictional
 * fixtures so the enabled/disabled journeys can be reviewed in a browser
 * while every capability flag stays OFF in the real workroom. Retained
 * through handoff for independent review; remove when requested.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import {
  ScopeReviewPanel,
  VerificationPanel,
} from "@/components/tt/steward/workroom-backend-panels";

const enabled = { kind: "enabled" as const };

const fictionalTask = {
  id: "00000000-0000-4000-8000-000000000099",
  title: "Fictional required task — confirm the roadmap scope",
  revision: 3,
};

const fictionalScope = {
  kind: "ready" as const,
  counts: { denominator: 2, verified: 0, pendingProposals: 1 },
  items: [
    {
      id: "item-1",
      taskId: fictionalTask.id,
      classification: "manual_required" as const,
      removedAt: null as string | null,
    },
    {
      id: "item-2",
      taskId: "00000000-0000-4000-8000-000000000100",
      classification: "transcript" as const,
      removedAt: "2026-01-05T10:00:00.000Z" as string | null,
    },
  ],
};

const fictionalProposals = {
  kind: "ready" as const,
  proposals: [
    {
      id: "prop-1",
      sourceKey: "seg-3948",
      kind: "task" as const,
      statement: "Fictional proposal: draft the roadmap outline",
      status: "proposed" as const,
      evidence: [{ label: "39:48 roadmap mention" }],
    },
  ],
  decisions: [],
};

function QaPage() {
  const [verified, setVerified] = useState(false);
  const [scope, setScope] = useState(fictionalScope);

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <header>
        <h1 className="text-lg font-semibold">Steward backend panels — fictional QA</h1>
        <p className="text-sm text-muted-foreground">
          Fictional fixtures only. No backend calls, no live flags, no real records. This route
          exists for independent interaction review and is removed on request.
        </p>
      </header>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Verification (enabled, fictional)</h2>
        <VerificationPanel
          capability={enabled}
          state={{
            kind: "ready",
            verified,
            task: { ...fictionalTask, status: verified ? "complete" : "open" },
            receipts: [],
          }}
          task={fictionalTask}
          onVerify={async () => {
            setVerified(true);
            return { kind: "verified" as const };
          }}
          onReopen={async () => {
            setVerified(false);
            return { kind: "reopened" as const };
          }}
          onRetryReads={() => undefined}
        />
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Scope review (enabled, fictional)</h2>
        <ScopeReviewPanel
          scope={scope}
          coverage={undefined}
          proposals={fictionalProposals}
          scopeCapability={enabled}
          coverageCapability={enabled}
          proposalCapability={enabled}
          linkTargets={[
            { id: fictionalTask.id, title: fictionalTask.title },
            { id: "00000000-0000-4000-8000-000000000100", title: "Another fictional task" },
          ]}
          expectedSource={null}
          onAttestCoverage={async () => ({ kind: "applied" as const })}
          onSyncProposals={async () => ({ kind: "applied" as const })}
          onSyncRequiredScope={async () => ({ kind: "applied" as const })}
          onLinkProposal={async () => ({ kind: "applied" as const })}
          onDismissProposal={async () => ({ kind: "applied" as const })}
          onRemoveScopeItem={async (input) => {
            setScope((s) => ({
              ...s,
              items: s.items.map((i) =>
                i.id === input.itemId ? { ...i, removedAt: new Date().toISOString() } : i,
              ),
            }));
            return { kind: "applied" as const };
          }}
          onReinstateScopeItem={async (input) => {
            setScope((s) => ({
              ...s,
              items: s.items.map((i) => (i.id === input.itemId ? { ...i, removedAt: null } : i)),
            }));
            return { kind: "applied" as const };
          }}
          mayAmendScopeItem={(taskId) => taskId === fictionalTask.id}
          onRetryReads={() => undefined}
        />
      </section>
    </main>
  );
}

export const Route = createFileRoute("/mockups/steward-backend-qa")({
  component: QaPage,
  head: () => ({
    meta: [
      { title: "Steward backend panels — fictional QA" },
      { name: "robots", content: "noindex" },
    ],
  }),
});
