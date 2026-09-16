import { describe, expect, it } from "vitest";

import {
  marginRead,
  paymentView,
  setAgreementStage,
  setPaymentStage,
  type AgreementRecord,
  type PaymentRecord,
} from "./agreement-state";

const AT = "2026-03-10T09:00:00.000Z";

const agreement: AgreementRecord = {
  clientRef: "fixture-client-01",
  stage: "proposed",
  evidence: null,
  changedBy: null,
  changedAt: null,
};

const payment: PaymentRecord = {
  clientRef: "fixture-client-01",
  stage: "unpaid",
  evidence: null,
  changedBy: null,
  changedAt: null,
};

describe("agreement and payment states", () => {
  it("keeps the agreement and the money as separate readings", () => {
    const approved = setAgreementStage({
      record: agreement,
      stage: "approved",
      actorKind: "person",
      by: "person-1",
      at: AT,
    });
    expect(approved.changed && approved.record.stage).toBe("approved");
    expect(payment.stage).toBe("unpaid");
  });

  it("refuses to let preparation mark an agreement accepted", () => {
    const outcome = setAgreementStage({
      record: agreement,
      stage: "client_accepted",
      actorKind: "preparation",
      by: "job-1",
      at: AT,
      evidence: { kind: "reference", system: "Contracts", reference: "C-1", observedAt: AT },
    });
    expect(outcome.changed).toBe(false);
    expect(outcome.changed === false && outcome.because).toContain("Only a person");
  });

  it("refuses to let preparation mark money paid", () => {
    const outcome = setPaymentStage({
      record: payment,
      stage: "paid",
      actorKind: "preparation",
      by: "job-1",
      at: AT,
      evidence: { kind: "reference", system: "Invoicing", reference: "INV-1", observedAt: AT },
    });
    expect(outcome.changed).toBe(false);
  });

  it("will not mark sent or accepted without evidence", () => {
    const sent = setAgreementStage({
      record: agreement,
      stage: "sent",
      actorKind: "person",
      by: "person-1",
      at: AT,
    });
    expect(sent.changed).toBe(false);
    expect(sent.changed === false && sent.because).toContain("Record a reference");
  });

  it("accepts a human attestation with an author and a time", () => {
    const outcome = setAgreementStage({
      record: agreement,
      stage: "client_accepted",
      actorKind: "person",
      by: "person-1",
      at: AT,
      evidence: { kind: "human_attested", by: "person-1", at: AT, note: "Signed copy received" },
    });
    expect(outcome.changed).toBe(true);
    expect(outcome.changed && outcome.record.evidence?.kind).toBe("human_attested");
    expect(outcome.changed && outcome.record.changedAt).toBe(AT);
  });

  it("shows an unreadable finance system as unavailable, never as paid", () => {
    const view = paymentView({
      record: { ...payment, stage: "paid" },
      externalRead: { ok: false, because: "the invoicing tool did not answer", readAt: AT },
    });
    expect(view.stage).toBe("unknown");
    expect(view.label).toBe("Payment status unavailable");
    expect(view.basis).toContain("did not answer");
  });

  it("says where a payment reading came from", () => {
    const view = paymentView({
      record: {
        ...payment,
        stage: "paid",
        evidence: { kind: "reference", system: "Invoicing", reference: "INV-7", observedAt: AT },
      },
    });
    expect(view.stage).toBe("paid");
    expect(view.basis).toContain("INV-7");
  });

  it("leaves margin unknown rather than counting a missing cost as profit", () => {
    const read = marginRead({
      currency: "GBP",
      estimateMinor: 400000,
      agreedMinor: 420000,
      costMinor: null,
    });
    expect(read.marginMinor).toBeNull();
    expect(read.varianceMinor).toBe(20000);
    expect(read.unknowns).toContain("No cost recorded.");
    expect(read.marginNote).toContain("not nought");
  });

  it("works out margin exactly when every figure exists", () => {
    const read = marginRead({
      currency: "GBP",
      estimateMinor: 400000,
      agreedMinor: 420000,
      costMinor: 250000,
    });
    expect(read.marginMinor).toBe(170000);
    expect(read.unknowns).toHaveLength(0);
  });
});
