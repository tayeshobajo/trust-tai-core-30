import { describe, expect, it } from "vitest";
import {
  attestCoverage,
  resolveCoverage,
  type CoverageAttestation,
} from "./steward-coverage.server";

const BASE = {
  orgId: "org-a",
  conversationId: "conv-1",
  transcriptHash: "hash-v1-0123456789ab",
  scopeVersion: 1,
  actorId: "user-owner",
};

const ATTEST = {
  orgId: BASE.orgId,
  conversationId: BASE.conversationId,
  operationId: "op-attest-1",
  expectedTranscriptHash: BASE.transcriptHash,
  expectedScopeVersion: BASE.scopeVersion,
  actorId: BASE.actorId,
};

function attestation(partial: Partial<CoverageAttestation>): CoverageAttestation {
  return {
    id: "att-1",
    organizationId: BASE.orgId,
    conversationId: BASE.conversationId,
    transcriptHash: BASE.transcriptHash,
    scopeVersion: 1,
    attestedBy: BASE.actorId,
    attestedAt: "now",
    supersededAt: null,
    ...partial,
  };
}

describe("resolveCoverage", () => {
  it("is unconfirmed when nothing was ever attested", async () => {
    const repo = {
      latestAttestation: async () => null,
      attest: async () => attestation({}),
      currentCoverage: async () => false,
    };
    expect(await resolveCoverage(repo, BASE)).toEqual({
      kind: "unconfirmed",
      reason: "never_attested",
    });
  });

  it("is unconfirmed when the attestation was superseded", async () => {
    const repo = {
      latestAttestation: async () => attestation({ supersededAt: "later" }),
      attest: async () => attestation({}),
      currentCoverage: async () => false,
    };
    expect(await resolveCoverage(repo, BASE)).toEqual({
      kind: "unconfirmed",
      reason: "never_attested",
    });
  });

  it("is unconfirmed when the transcript hash changed", async () => {
    const repo = {
      latestAttestation: async () => attestation({}),
      attest: async () => attestation({}),
      currentCoverage: async () => false,
    };
    const state = await resolveCoverage(repo, {
      ...BASE,
      transcriptHash: "hash-v2-EDITED-01234567",
    });
    expect(state).toEqual({ kind: "unconfirmed", reason: "transcript_changed" });
  });

  it("is unconfirmed when the scope version changed", async () => {
    const repo = {
      latestAttestation: async () => attestation({}),
      attest: async () => attestation({}),
      currentCoverage: async () => false,
    };
    const state = await resolveCoverage(repo, { ...BASE, scopeVersion: 2 });
    expect(state).toEqual({ kind: "unconfirmed", reason: "scope_changed" });
  });

  it("is confirmed only when hash and scope version both match", async () => {
    const repo = {
      latestAttestation: async () => attestation({}),
      attest: async () => attestation({}),
      currentCoverage: async () => true,
    };
    const state = await resolveCoverage(repo, BASE);
    expect(state.kind).toBe("confirmed");
  });
});

describe("attestCoverage", () => {
  it("rejects a toy transcript hash", async () => {
    const repo = { attest: async () => attestation({}), currentCoverage: async () => true };
    await expect(
      attestCoverage(repo, { ...ATTEST, expectedTranscriptHash: "short" }),
    ).rejects.toThrow("digest");
  });

  it("rejects a missing scope version binding", async () => {
    const repo = { attest: async () => attestation({}), currentCoverage: async () => true };
    await expect(
      attestCoverage(repo, { ...ATTEST, expectedScopeVersion: 0 }),
    ).rejects.toThrow("scope version");
  });

  it("passes the operation id and reviewed source binding to the repository", async () => {
    const seen: unknown[] = [];
    const repo = {
      attest: async (input: unknown) => {
        seen.push(input);
        return attestation({});
      },
      currentCoverage: async () => true,
    };
    await attestCoverage(repo, ATTEST);
    expect(seen[0]).toMatchObject({
      operationId: "op-attest-1",
      expectedTranscriptHash: BASE.transcriptHash,
      expectedScopeVersion: 1,
    });
  });
});
