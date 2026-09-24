/**
 * The graduated auto-send decision, and its handshake with the one send gate.
 *
 * Two things are proved here, both pure:
 *   1. decideAutoSend holds on anything it cannot prove, and the failsafe (a
 *      first-EVER contact) overrides even a graduated, confident, cold pass.
 *   2. decideSend accepts a valid system approval as a parallel source with the
 *      SAME payload-fingerprint discipline as a human approval, and refuses a
 *      revoked, non-graduated, or fingerprint-mismatched one.
 */

import { describe, expect, it } from "vitest";

import { decideAutoSend, type AutoSendDecisionInput } from "./comms-autosend";
import { decideSend, type SendDecisionInput } from "./comms-delivery";

/** A graduated, confident, cold, override-free draft with prior (non-reply) contact. */
function graduatedClean(): AutoSendDecisionInput {
  return {
    authority: { autonomyState: "auto_send", authorityId: "auth-1" },
    gate: { verdict: "pass", confidence: null, grade: null, hardOverride: false, reasons: [] },
    relationship: { hasAnyPriorMessage: true, hasInboundReply: false },
    confidenceFloor: 0.85,
    allowMissingConfidence: true,
  };
}

describe("decideAutoSend", () => {
  it("(ii) graduated + confident pass + prior contact + no inbound reply => auto-sends", () => {
    const verdict = decideAutoSend(graduatedClean());
    expect(verdict.autoSend).toBe(true);
    if (verdict.autoSend) {
      expect(verdict.reason).toBe("graduated_confident_cold_first_contact");
    }
  });

  it("(i) first-EVER contact ALWAYS queues, even when graduated and confident", () => {
    const verdict = decideAutoSend({
      ...graduatedClean(),
      relationship: { hasAnyPriorMessage: false, hasInboundReply: false },
    });
    expect(verdict.autoSend).toBe(false);
    if (!verdict.autoSend) expect(verdict.code).toBe("first_ever_contact");
  });

  it("(i) the failsafe wins even over a hard override — first-ever contact is checked first", () => {
    const verdict = decideAutoSend({
      ...graduatedClean(),
      gate: { verdict: "pass", confidence: null, grade: null, hardOverride: true, reasons: [] },
      relationship: { hasAnyPriorMessage: false, hasInboundReply: false },
    });
    expect(verdict.autoSend).toBe(false);
    if (!verdict.autoSend) expect(verdict.code).toBe("first_ever_contact");
  });

  it("(iii) non-graduated (bounce_only) => queues", () => {
    const verdict = decideAutoSend({
      ...graduatedClean(),
      authority: { autonomyState: "bounce_only", authorityId: "auth-1" },
    });
    expect(verdict.autoSend).toBe(false);
    if (!verdict.autoSend) expect(verdict.code).toBe("not_graduated");
  });

  it("(iii) absent authority row => queues", () => {
    const verdict = decideAutoSend({
      ...graduatedClean(),
      authority: { autonomyState: null, authorityId: null },
    });
    expect(verdict.autoSend).toBe(false);
    if (!verdict.autoSend) expect(verdict.code).toBe("not_graduated");
  });

  it("(iv) a bounce verdict => queues", () => {
    const verdict = decideAutoSend({
      ...graduatedClean(),
      gate: { verdict: "bounce", confidence: null, grade: null, hardOverride: false, reasons: [] },
    });
    expect(verdict.autoSend).toBe(false);
    if (!verdict.autoSend) expect(verdict.code).toBe("gate_not_pass");
  });

  it("(iv) a hard override => queues even on a pass", () => {
    const verdict = decideAutoSend({
      ...graduatedClean(),
      gate: { verdict: "pass", confidence: null, grade: null, hardOverride: true, reasons: [] },
    });
    expect(verdict.autoSend).toBe(false);
    if (!verdict.autoSend) expect(verdict.code).toBe("hard_override");
  });

  it("(v) a relationship that has replied before => queues", () => {
    const verdict = decideAutoSend({
      ...graduatedClean(),
      relationship: { hasAnyPriorMessage: true, hasInboundReply: true },
    });
    expect(verdict.autoSend).toBe(false);
    if (!verdict.autoSend) expect(verdict.code).toBe("has_inbound_reply");
  });

  it("a real score below the floor => queues", () => {
    const verdict = decideAutoSend({
      ...graduatedClean(),
      gate: { verdict: "pass", confidence: 0.5, grade: null, hardOverride: false, reasons: [] },
      allowMissingConfidence: false,
    });
    expect(verdict.autoSend).toBe(false);
    if (!verdict.autoSend) expect(verdict.code).toBe("low_confidence");
  });

  it("a missing score is NOT confident unless the caller vouches for the path", () => {
    const verdict = decideAutoSend({
      ...graduatedClean(),
      allowMissingConfidence: false,
    });
    expect(verdict.autoSend).toBe(false);
    if (!verdict.autoSend) expect(verdict.code).toBe("low_confidence");
  });
});

/* --------------------- decideSend accepts a system approval --------------- */

const FP = "sha256:" + "a".repeat(64);

function baseSend(): SendDecisionInput {
  return {
    missingCapability: [],
    approval: null,
    run: null,
    blockers: [],
    currentContextRevision: null,
    currentContextFingerprint: "",
    currentVersionId: null,
    payloadFingerprint: FP,
    callerMaySend: true,
  };
}

describe("decideSend with a system approval", () => {
  it("clears the send when the system approval covers the exact payload", () => {
    const decision = decideSend({
      ...baseSend(),
      systemApproval: {
        id: "sys-1",
        approvedPayloadFingerprint: FP,
        authorityState: "auto_send",
        revokedAt: null,
      },
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.source).toBe("system_autosend");
      expect(decision.approvalId).toBe("sys-1");
      expect(decision.fingerprint).toBe(FP);
    }
  });

  it("refuses a system approval whose fingerprint does not match — no send", () => {
    const decision = decideSend({
      ...baseSend(),
      systemApproval: {
        id: "sys-1",
        approvedPayloadFingerprint: "sha256:" + "b".repeat(64),
        authorityState: "auto_send",
        revokedAt: null,
      },
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe("payload_changed");
  });

  it("refuses a revoked system approval", () => {
    const decision = decideSend({
      ...baseSend(),
      systemApproval: {
        id: "sys-1",
        approvedPayloadFingerprint: FP,
        authorityState: "auto_send",
        revokedAt: "2026-09-23T00:00:00Z",
      },
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe("not_approved");
  });

  it("refuses a system approval not resting on an auto_send authority", () => {
    const decision = decideSend({
      ...baseSend(),
      systemApproval: {
        id: "sys-1",
        approvedPayloadFingerprint: FP,
        authorityState: "bounce_only",
        revokedAt: null,
      },
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe("not_approved");
  });

  it("a system approval never bypasses caller authority", () => {
    const decision = decideSend({
      ...baseSend(),
      callerMaySend: false,
      systemApproval: {
        id: "sys-1",
        approvedPayloadFingerprint: FP,
        authorityState: "auto_send",
        revokedAt: null,
      },
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe("not_authorised");
  });

  it("the human-review path is unchanged when no system approval is present", () => {
    const decision = decideSend(baseSend());
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe("no_review");
  });
});
