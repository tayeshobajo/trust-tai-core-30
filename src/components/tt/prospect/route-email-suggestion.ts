/**
 * The one decision the "Add a route" form needs from the email-pattern module:
 * given the person being routed and the addresses we already trust at their
 * company, is there an address worth suggesting, is the company's naming
 * genuinely split, or is there nothing honest to say?
 *
 * Pure, so it can be unit-tested without a component framework. Filtering the
 * known addresses down to verified ones is the CALLER's job (the module's own
 * contract): passing guessed addresses here would launder a guess into
 * apparent corroboration.
 */

import {
  inferEmailPattern,
  proposeEmail,
  type EmailCandidate,
  type KnownAddress,
} from "@/domain/email-pattern";

export type RouteEmailSuggestion =
  /** The module proposed an address. Always a guess; never pre-confirmed. */
  | { kind: "suggestion"; candidate: EmailCandidate }
  /** The company's verified addresses follow more than one convention. */
  | { kind: "conflict"; because: string }
  /** Nothing honest to show: no domain, no usable evidence, or the module declined. */
  | { kind: "none" };

export function suggestRouteEmail(input: {
  fullName: string;
  companyDomain: string | undefined;
  knownAddresses: KnownAddress[];
}): RouteEmailSuggestion {
  const domain = input.companyDomain?.trim();
  if (!domain || !input.fullName.trim() || input.knownAddresses.length === 0) {
    return { kind: "none" };
  }

  const inference = inferEmailPattern({ domain, known: input.knownAddresses });
  if (inference.kind === "conflicting") {
    return { kind: "conflict", because: inference.because };
  }

  const proposal = proposeEmail(input.fullName, inference);
  if (proposal.kind === "declined") return { kind: "none" };
  return { kind: "suggestion", candidate: proposal.candidate };
}
