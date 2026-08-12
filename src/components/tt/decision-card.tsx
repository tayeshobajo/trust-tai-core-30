import { useState } from "react";

import type { Decision, User } from "@/domain/entities";
import { MetaPill, StatusPill, TTButton } from "@/components/tt/primitives";

function formatDue(due?: string) {
  if (!due) return "No deadline set";
  return new Date(due).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export function DecisionCard({
  decision,
  owner,
  onResolve,
}: {
  decision: Decision;
  owner?: User | undefined;
  onResolve?: ((id: string, status: Decision["status"]) => void) | undefined;
}) {
  const [status, setStatus] = useState<Decision["status"]>(decision.status);

  function resolve(next: Decision["status"]) {
    setStatus(next);
    onResolve?.(decision.id, next);
  }

  return (
    <article className="tt-surface p-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status="needs_decision" />
        <MetaPill>Due {formatDue(decision.dueAt)}</MetaPill>
        <MetaPill>Carried by {owner?.name ?? "Unassigned"}</MetaPill>
      </div>

      <h3 className="mt-4 text-xl font-semibold tracking-tight text-foreground">
        {decision.title}
      </h3>

      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="tt-eyebrow">Context</dt>
          <dd className="mt-1 text-muted-foreground">{decision.context}</dd>
        </div>
        <div>
          <dt className="tt-eyebrow">Consequence</dt>
          <dd className="mt-1 text-muted-foreground">{decision.consequence}</dd>
        </div>
        {decision.recommendation ? (
          <div className="rounded-lg border border-royal/20 bg-royal/5 p-4">
            <dt className="tt-eyebrow text-royal">
              {decision.recommendationSource === "intelligence"
                ? "Suggested by intelligence layer"
                : "Recommended by a person"}
            </dt>
            <dd className="mt-1 text-foreground">{decision.recommendation}</dd>
          </div>
        ) : null}
      </dl>

      {status === "open" ? (
        <div className="mt-5 flex flex-wrap gap-2">
          <TTButton size="sm" onClick={() => resolve("approved")}>
            Approve this decision
          </TTButton>
          <TTButton size="sm" variant="secondary" onClick={() => resolve("deferred")}>
            Defer for now
          </TTButton>
        </div>
      ) : (
        <p className="mt-5 font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {status === "approved" ? "Approved by you" : "Deferred by you"}
        </p>
      )}
    </article>
  );
}
