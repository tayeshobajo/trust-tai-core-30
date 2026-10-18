/**
 * STAGED — NOT WIRED TO ANY ROUTE. Durable transcript-coverage attestation.
 *
 * Application-side half of the UNAPPLIED proposal in
 * `docs/proposed/steward-backend/003_coverage_attestation.up.sql`. Coverage
 * is valid only while the latest attestation matches BOTH the current
 * transcript hash and the current reviewed scope version. Any edit or scope
 * amendment invalidates it — a stale attestation can never keep a meeting
 * at 100. No browser-only flags, no timestamp heuristics.
 */

export interface CoverageAttestation {
  id: string;
  organizationId: string;
  conversationId: string;
  transcriptHash: string;
  scopeVersion: number;
  attestedBy: string;
  attestedAt: string;
  supersededAt: string | null;
}

/** Minimal repository contract over the proposed SQL functions. */
export interface CoverageRepository {
  /* The attestation is bound to the exact source the human reviewed: the
     SQL derives the CURRENT hash/version itself and rejects the call when
     it differs from expectedTranscriptHash/expectedScopeVersion, so a
     source change during review is never silently attested. The operation
     UUID makes an uncertain-transport retry replay the same attestation. */
  attest(input: {
    orgId: string;
    conversationId: string;
    operationId: string;
    expectedTranscriptHash: string;
    expectedScopeVersion: number;
  }): Promise<CoverageAttestation>;
  currentCoverage(input: { orgId: string; conversationId: string }): Promise<boolean>;
}

export type CoverageState =
  | { kind: "confirmed"; attestation: CoverageAttestation }
  | { kind: "unconfirmed"; reason: "never_attested" | "transcript_changed" | "scope_changed" };

/**
 * Resolve the honest coverage state for a conversation. Never returns
 * "confirmed" without a durable attestation matching the CURRENT transcript
 * hash and scope version.
 */
export async function resolveCoverage(
  repo: CoverageRepository & {
    latestAttestation(orgId: string, conversationId: string): Promise<CoverageAttestation | null>;
  },
  input: { orgId: string; conversationId: string; transcriptHash: string; scopeVersion: number },
): Promise<CoverageState> {
  const latest = await repo.latestAttestation(input.orgId, input.conversationId);
  if (!latest || latest.supersededAt) return { kind: "unconfirmed", reason: "never_attested" };
  if (latest.transcriptHash !== input.transcriptHash)
    return { kind: "unconfirmed", reason: "transcript_changed" };
  if (latest.scopeVersion !== input.scopeVersion)
    return { kind: "unconfirmed", reason: "scope_changed" };
  return { kind: "confirmed", attestation: latest };
}

/** Record a new attestation bound to the exact reviewed source. The SQL
 *  supersedes any prior current attestation in the same transaction and
 *  rejects the call when the stored source drifted from the reviewed one. */
export async function attestCoverage(
  repo: CoverageRepository,
  input: {
    orgId: string;
    conversationId: string;
    operationId: string;
    expectedTranscriptHash: string;
    expectedScopeVersion: number;
    actorId: string;
  },
): Promise<CoverageAttestation> {
  if (input.expectedTranscriptHash.trim().length < 16) {
    throw new Error("a real transcript digest (at least 16 characters) is required");
  }
  if (!Number.isInteger(input.expectedScopeVersion) || input.expectedScopeVersion < 1) {
    throw new Error("a real scope version is required");
  }
  return repo.attest(input);
}
