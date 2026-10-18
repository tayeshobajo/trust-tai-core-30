/**
 * Read-only overlap detection for proposal review.
 *
 * When a meeting says the same thing twice ("a phased roadmap" at 39:48,
 * 39:59 and 40:03), each passage becomes its own proposal. Confirming all of
 * them would create duplicate commitments, so the review surface groups
 * likely overlaps and asks a person to decide. Grouping never confirms,
 * merges or links anything by itself — it only makes the overlap visible
 * with every source reference preserved.
 */

import type { Proposal } from "./steward";

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "will", "shall", "should",
  "would", "could", "have", "has", "from", "into", "about", "over", "then",
  "than", "them", "they", "their", "there", "here", "what", "when", "where",
  "your", "yours", "ours", "mine", "need", "needs", "going", "gonna",
]);

function tokensOf(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 4 && !STOPWORDS.has(token)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export interface ProposalOverlapGroup {
  /** Stable review key, derived from member proposal ids. */
  key: string;
  proposals: Proposal[];
  /** Why these were grouped — shown to the reviewer, never acted on. */
  because: string;
}

/**
 * Cluster proposals of the same kind whose statements share at least half of
 * their significant tokens. Deterministic: proposals are considered in input
 * order and each joins the first group it overlaps.
 */
export function groupRelatedProposals(
  proposals: readonly Proposal[],
  threshold = 0.5,
): ProposalOverlapGroup[] {
  const groups: { kind: string; tokens: Set<string>; members: Proposal[] }[] = [];
  for (const proposal of proposals) {
    const tokens = tokensOf(`${proposal.statement} ${proposal.quote}`);
    if (tokens.size === 0) continue;
    const match = groups.find(
      (group) => group.kind === proposal.kind && jaccard(group.tokens, tokens) >= threshold,
    );
    if (match) {
      match.members.push(proposal);
      for (const token of tokens) match.tokens.add(token);
    } else {
      groups.push({ kind: proposal.kind, tokens: new Set(tokens), members: [proposal] });
    }
  }
  return groups
    .filter((group) => group.members.length > 1)
    .map((group) => ({
      key: group.members.map((member) => member.id).join("+"),
      proposals: group.members,
      because: `${group.members.length} passages appear to describe the same ${group.kind.replace("_", " ")}. Confirm at most one, or confirm none — duplicates would create duplicate commitments.`,
    }));
}
