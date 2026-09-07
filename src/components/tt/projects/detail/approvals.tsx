/**
 * Decisions affecting this project, read from Approvals.
 *
 * Approvals owns decision authority. This is a read-through so the person
 * working the project can see what is waiting on judgment; deciding still
 * happens in Approvals, through the canonical path.
 */

import { Link } from "@tanstack/react-router";

import { TTButton, TTCard } from "@/components/tt/primitives";
import type { ApprovalRequest } from "@/domain/approvals";

export function ProjectApprovals({ requests }: { requests: ApprovalRequest[] }) {
  const open = requests.filter(
    (request) =>
      request.status === "needs_review" ||
      request.status === "needs_context" ||
      request.status === "ready" ||
      request.status === "revision_requested",
  );

  if (requests.length === 0) return null;

  return (
    <TTCard className="space-y-4 p-6">
      <div>
        <p className="tt-eyebrow">Needs a decision</p>
        <p className="mt-1 text-[15px] text-foreground">
          {open.length > 0
            ? `${open.length} ${open.length === 1 ? "decision is" : "decisions are"} waiting on a person.`
            : "Nothing is waiting on a decision for this work."}
        </p>
      </div>
      <ul className="space-y-3">
        {(open.length > 0 ? open : requests.slice(0, 3)).map((request) => (
          <li key={request.id} className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{request.title}</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {request.whyItNeedsYou || request.summary}
              </p>
            </div>
            <TTButton asChild size="sm" variant="secondary">
              <Link to="/modules/approvals">Decide in Approvals</Link>
            </TTButton>
          </li>
        ))}
      </ul>
    </TTCard>
  );
}
