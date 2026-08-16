/**
 * Proposal payload auto-fill.
 *
 * A recommendation can say "source against the current ICP", but Scout's
 * discovery adapter needs a concrete brief before it will route anything —
 * without one it refuses with `missing_input`, and the loop can never start
 * from reasoning alone.
 *
 * This module closes that gap using only what already exists: the
 * organisation's saved `icp_profiles` row. It derives the brief from the ICP
 * a person wrote, and carries the ICP's own identifiers through so the run is
 * traceable back to the version it targeted.
 *
 * Three rules, deliberately narrow:
 *
 *   1. Nothing is invented. No company, no criteria, no identifier that is not
 *      already stored. With no saved ICP, the proposal is left exactly as it
 *      was — a look-only step a person completes in Scout.
 *   2. Only the discovery proposal is upgraded. Every other operation passes
 *      through untouched.
 *   3. Approval is unaffected. The filled action still requires a person, in
 *      the owning room, with `scout.write`.
 */

import type { ActionProposal } from "@/domain/intelligence-engine";

/** The saved ICP, read from `icp_profiles`. Never constructed here. */
export interface IcpContext {
  profileId: string;
  version: number;
  title: string;
  contentMarkdown: string;
  updatedAt?: string | null;
}

/** The look-only proposal this fill upgrades. */
export const DISCOVERY_PROPOSAL_OPERATION = "scout.open_discovery";
/** The executable operation Scout's adapter claims. */
export const DISCOVERY_RUN_OPERATION = "scout.start_discovery_run";

/** How much of the ICP is carried into the brief. */
const MAX_BRIEF_CHARS = 900;

function isMeaningful(line: string): boolean {
  const text = line.trim();
  if (text.length === 0) return false;
  /* Headings, rules and list bullets alone carry no criteria. */
  if (/^[#>*\-_=\s]+$/.test(text)) return false;
  return true;
}

/**
 * The plain-English brief a saved ICP already states.
 *
 * Markdown decoration is stripped so Scout receives criteria rather than
 * formatting. Returns null when the ICP holds nothing to search on — silence
 * is the honest answer, not a generic brief.
 */
export function deriveDiscoveryBrief(icp: IcpContext | null | undefined): string | null {
  if (!icp) return null;
  const lines = icp.contentMarkdown
    .split(/\r?\n/)
    .filter(isMeaningful)
    .map((line) =>
      line
        .replace(/^\s*[#>]+\s*/, "")
        .replace(/^\s*[-*+]\s+/, "")
        .replace(/\*\*/g, "")
        .replace(/`/g, "")
        .trim(),
    )
    .filter((line) => line.length > 0);

  if (lines.length === 0) return null;

  const brief = lines.join(". ").replace(/\.\.+/g, ".").trim();
  if (brief.length === 0) return null;
  return brief.length > MAX_BRIEF_CHARS ? `${brief.slice(0, MAX_BRIEF_CHARS).trimEnd()}…` : brief;
}

/**
 * Upgrade the discovery proposal into a routable sourcing run when — and only
 * when — the organisation's saved ICP supplies the brief.
 */
export function fillDiscoveryPayload(
  proposal: ActionProposal,
  icp: IcpContext | null | undefined,
): ActionProposal {
  if (proposal.operation !== DISCOVERY_PROPOSAL_OPERATION) return proposal;
  const brief = deriveDiscoveryBrief(icp);
  if (!brief || !icp) return proposal;

  return {
    ...proposal,
    operation: DISCOVERY_RUN_OPERATION,
    title: "Run one sourcing pass against the saved ICP",
    summary: `Scout runs a single sourcing pass using the ICP this organisation already saved ("${icp.title}", version ${icp.version}). Nothing is contacted and the ICP is not changed.`,
    willDo: [
      "Run one sourcing pass in Scout against the saved ICP",
      "Save only the companies Scout can verify",
    ],
    willNotDo: ["Contact anyone", "Change the ICP", "Qualify or pass any company for you"],
    payload: {
      ...proposal.payload,
      brief,
      icpProfileId: icp.profileId,
      icpVersion: icp.version,
      icpTitle: icp.title,
      ...(icp.updatedAt ? { icpUpdatedAt: icp.updatedAt } : {}),
      /* Derived, never invented: the brief is the saved ICP itself. */
      briefSource: "icp_profiles",
    },
  };
}

/** Apply every available payload fill across a set of proposals. */
export function fillProposalPayloads(
  proposals: ActionProposal[],
  icp: IcpContext | null | undefined,
): ActionProposal[] {
  return proposals.map((proposal) => fillDiscoveryPayload(proposal, icp));
}
