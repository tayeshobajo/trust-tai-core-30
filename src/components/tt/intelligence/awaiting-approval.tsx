/**
 * Bounded next steps awaiting a person's approval, on the Home shell.
 *
 * Home is a doorway, so this says only what is waiting on a human decision,
 * what each step will and will not do, and which room owns the change. The
 * engine still executes nothing: approving records permission, and the work
 * is finished by a person in the owning room.
 */

import { ActionProposalRow } from "@/components/tt/intelligence/business-read";
import { SectionHeading, TTCard } from "@/components/tt/primitives";
import { actionsForRead } from "@/data/intelligence/engine/propose";
import type { AccessContext } from "@/domain/access";
import { canAuthorizeAction } from "@/domain/action-authority";
import type {
  ActionAuthorizationDecision,
  ActionProposal,
  EngineRead,
} from "@/domain/intelligence-engine";

const ROOM_LABEL: Record<string, string> = {
  scout: "Scout",
  comms: "Comms",
  roadmap: "Roadmap",
  projects: "Projects",
  steward: "Steward",
  ops: "Ops",
};

export function AwaitingApproval({
  read,
  access,
  onAuthorize,
}: {
  read: EngineRead;
  access: AccessContext | null;
  onAuthorize: (input: {
    proposal: ActionProposal;
    decision: ActionAuthorizationDecision;
    note?: string;
  }) => Promise<void>;
}) {
  const grouped = actionsForRead(read.recommendations);
  const proposals: ActionProposal[] = Object.values(grouped).flat();
  if (proposals.length === 0) return null;

  const yours = proposals.filter((p) => canAuthorizeAction(access, p).allowed).length;

  return (
    <section aria-labelledby="awaiting-approval-heading" className="space-y-4">
      <SectionHeading
        eyebrow="Waiting on your approval"
        title={`${proposals.length} bounded next step${proposals.length === 1 ? "" : "s"}`}
        description={
          yours === proposals.length
            ? "Each one is small and reversible. Approving records your permission — the work is done by you, in the room that owns the change."
            : `${yours} of ${proposals.length} are yours to authorise. The rest belong to a role you do not hold.`
        }
      />

      <div id="awaiting-approval-heading" className="space-y-3">
        {proposals.map((proposal) => (
          <TTCard key={proposal.id} className="p-5">
            <p className="tt-eyebrow mb-3">
              {ROOM_LABEL[proposal.appId] ?? proposal.appId} owns this change
            </p>
            <ActionProposalRow action={proposal} access={access} onAuthorize={onAuthorize} />
          </TTCard>
        ))}
      </div>
    </section>
  );
}
