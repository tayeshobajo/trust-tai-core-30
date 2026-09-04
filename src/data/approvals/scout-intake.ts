/**
 * Scout intake: a strong ICP match is a judgment, not an instruction.
 *
 * A company scoring at or above the bar has earned a person's attention. It has
 * not earned a message, a relationship or a place in anyone's inbox. So Scout
 * submits the decision here, with its own canonical prospect and person ids
 * intact, and waits.
 *
 * Two honest landing places, never one pretending to be the other:
 *
 *   - **Ready to approve** when Scout's own handoff brief is ready: a
 *     traceable decision maker, a confirmed route, and enough evidence to
 *     stand behind.
 *   - **Needs context** when identity, reachability or evidence is missing.
 *     False identity is worse than a missed opportunity, so the card says what
 *     is missing rather than dressing a guess up as a recommendation.
 *
 * Nothing here contacts anyone, opens a relationship or writes Scout's truth.
 * Execution stays with Scout's existing handoff, after a person approves.
 */

import { listOrganizationContacts } from "@/data/supabase/contacts";
import { scoutService } from "@/data/supabase/scout-service";
import { approvalsService, type ApprovalsContext } from "@/data/supabase/approvals-service";
import { buildHandoffDraft, developmentFromBrief } from "@/data/comms-handoff";
import { buildRelationshipBrief } from "@/data/relationship-development";
import { composeProspectPage } from "@/data/prospect-modules";
import type { ApprovalRequest } from "@/domain/approvals";
import type { HandoffDraft } from "@/domain/comms-handoff";
import type { Person } from "@/domain/people";
import type { ProspectCandidate } from "@/domain/scout";

import { scoutRelationshipSubmission } from "./submissions";
import type { IntakeReport } from "./intake";

/** The bar at which a match is worth a person's judgment. Not a send trigger. */
export const SCOUT_APPROVAL_FIT_THRESHOLD = 70;

/** Statuses that mean Scout already settled this company one way or another. */
const SETTLED: string[] = ["ready_for_comms", "passed", "archived", "client"];

/**
 * The governed submission for one strong match.
 *
 * Pure translation over facts Scout already holds: no reads, no writes, and no
 * reachability or identity invented anywhere.
 */
export function scoutFitSubmissionFor(
  candidate: ProspectCandidate,
  people: Person[],
  activeIcpVersion: number | null,
) {
  const composition = composeProspectPage({ candidate, activeIcpVersion });
  const development =
    developmentFromBrief(
      candidate.development?.research?.state === "prepared"
        ? candidate.development.research.brief
        : undefined,
    ) ?? developmentFromBrief(buildRelationshipBrief({ candidate, people }));

  const handoff: HandoffDraft = buildHandoffDraft({
    candidate,
    people,
    coverage: composition.coverage,
    fitConfidence: composition.confidence,
    ...(development ? { development } : {}),
  });

  const primary = handoff.targets.find((target) => target.rank === "primary") ?? null;
  const contact = primary ?? handoff.contact;

  const submission = scoutRelationshipSubmission({
    prospectId: candidate.prospect.id,
    companyName: candidate.prospect.name,
    ...(contact?.fullName ? { personName: contact.fullName } : {}),
    ...(contact?.roleTitle ? { roleTitle: contact.roleTitle } : {}),
    fitScore: candidate.evaluation.score ?? 0,
    fitReasons: [candidate.fit.whyItFits].filter(Boolean),
    gaps: handoff.blockers,
    evidence: handoff.requiredContext.flatMap((item) => item.evidence).slice(0, 8),
  });

  return {
    submission: {
      ...submission,
      payload: {
        ...(submission.payload ?? {}),
        /* The brief travels only when Scout can stand behind it. An unready
           brief in the payload would let execution route a person we cannot
           honestly reach. */
        ...(handoff.ready ? { handoff: handoff as unknown as Record<string, unknown> } : {}),
        contactId: primary?.personId ?? contact?.personId ?? null,
        prospectId: candidate.prospect.id,
        handoffReady: handoff.ready,
      },
    },
    handoff,
  };
}

/**
 * Ask a person whether this company is worth a relationship.
 *
 * Idempotent by source key: the same prospect never becomes two decisions, and
 * a company Scout already routed or a person already decided is left alone.
 */
export async function submitScoutFitForApproval(
  candidate: ProspectCandidate,
  people: Person[],
  activeIcpVersion: number | null,
  context: ApprovalsContext,
): Promise<ApprovalRequest | null> {
  const score = candidate.evaluation.score ?? 0;
  if (!candidate.evaluation.scoreable || score < SCOUT_APPROVAL_FIT_THRESHOLD) return null;
  if (SETTLED.includes(candidate.prospect.status)) return null;

  const { submission } = scoutFitSubmissionFor(candidate, people, activeIcpVersion);
  return approvalsService.submit(context, submission);
}

/**
 * Bring existing strong matches into the queue.
 *
 * Reads Scout's own rows through Scout's own service, groups the people in one
 * pass rather than one lookup per company, and leans on the source key so a
 * second run changes nothing.
 */
export async function backfillScoutApprovals(
  context: ApprovalsContext,
  options: { minFit?: number; limit?: number } = {},
): Promise<IntakeReport & { ready: number; needsContext: number }> {
  const minimum = options.minFit ?? SCOUT_APPROVAL_FIT_THRESHOLD;
  const report = {
    scanned: 0,
    submitted: 0,
    skipped: 0,
    failed: 0,
    errors: [] as string[],
    ready: 0,
    needsContext: 0,
  };

  const [candidates, icp, contacts] = await Promise.all([
    scoutService.list(context.organizationId),
    scoutService.icp(context.organizationId),
    listOrganizationContacts(context.organizationId),
  ]);

  const byProspect = new Map<string, Person[]>();
  for (const person of contacts) {
    if (!person.prospectId) continue;
    const bucket = byProspect.get(person.prospectId) ?? [];
    bucket.push(person);
    byProspect.set(person.prospectId, bucket);
  }

  const eligible = candidates
    .filter(
      (candidate) =>
        candidate.evaluation.scoreable &&
        (candidate.evaluation.score ?? 0) >= minimum &&
        !SETTLED.includes(candidate.prospect.status),
    )
    .slice(0, options.limit ?? 200);

  report.scanned = eligible.length;

  for (const candidate of eligible) {
    try {
      const request = await submitScoutFitForApproval(
        candidate,
        byProspect.get(candidate.prospect.id) ?? [],
        icp?.version ?? null,
        context,
      );
      if (!request) {
        report.skipped += 1;
        continue;
      }
      report.submitted += 1;
      if (request.status === "ready") report.ready += 1;
      if (request.status === "needs_context") report.needsContext += 1;
    } catch (failure) {
      report.failed += 1;
      report.errors.push(`${candidate.prospect.name}: ${(failure as Error).message}`);
    }
  }

  return report;
}
