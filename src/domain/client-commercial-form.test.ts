import { describe, expect, it } from "vitest";

import {
  commercialFormFrom,
  readCommercialForm,
  readMoneyCents,
  type CommercialFormCurrent,
  type CommercialFormInput,
} from "./client-commercial-form";

const EMPTY: CommercialFormCurrent = {
  tier: null,
  mrrCents: null,
  renewalAt: null,
  nextReviewAt: null,
};

function form(overrides: Partial<CommercialFormInput> = {}): CommercialFormInput {
  return {
    tier: "run",
    mrr: "3500",
    renewalAt: "",
    nextReviewAt: "",
    buildPhaseAmount: "",
    because: "Signed retainer agreed on the call.",
    ...overrides,
  };
}

describe("readMoneyCents", () => {
  it("reads plain, formatted and decimal amounts", () => {
    expect(readMoneyCents("3500")).toEqual({ ok: true, cents: 350000 });
    expect(readMoneyCents(" $3,500.50 ")).toEqual({ ok: true, cents: 350050 });
    expect(readMoneyCents("")).toEqual({ ok: true, cents: null });
  });

  it("refuses anything that is not a plain amount", () => {
    expect(readMoneyCents("about 3k").ok).toBe(false);
    expect(readMoneyCents("-100").ok).toBe(false);
  });
});

describe("readCommercialForm", () => {
  it("requires a human reason", () => {
    const result = readCommercialForm(form({ because: "" }), EMPTY);
    expect(result.ok).toBe(false);
  });

  it("writes only the facts that actually changed", () => {
    const result = readCommercialForm(form({ mrr: "3500" }), {
      ...EMPTY,
      tier: "run",
      mrrCents: 100000,
    });
    expect(result).toMatchObject({ ok: true, tierChanged: false });
    if (!result.ok) throw new Error("expected ok");
    expect(result.patch.tier).toBeUndefined();
    expect(result.patch.mrrCents).toBe(350000);
  });

  it("records nothing when nothing changed", () => {
    const current: CommercialFormCurrent = {
      tier: "run",
      mrrCents: 350000,
      renewalAt: null,
      nextReviewAt: null,
    };
    expect(readCommercialForm(form(), current).ok).toBe(false);
  });

  it("refuses a move into Build without a human-entered phase amount", () => {
    const result = readCommercialForm(form({ tier: "build", buildPhaseAmount: "" }), EMPTY);
    expect(result).toEqual({
      ok: false,
      because: "Moving this company into Build needs the phase amount a person actually agreed.",
    });
  });

  it("carries the human-entered Build phase amount on a real tier move", () => {
    const result = readCommercialForm(
      form({ tier: "build", mrr: "", buildPhaseAmount: "12,000" }),
      EMPTY,
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.tierChanged).toBe(true);
    expect(result.patch.buildPhaseAmountCents).toBe(1200000);
  });

  it("refuses a date that is not a real day", () => {
    expect(readCommercialForm(form({ renewalAt: "next March" }), EMPTY).ok).toBe(false);
  });

  it("clears a stored date when the field is emptied", () => {
    const result = readCommercialForm(form({ mrr: "", renewalAt: "" }), {
      ...EMPTY,
      tier: "run",
      renewalAt: "2027-01-31T00:00:00Z",
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.patch.renewalAt).toBeNull();
  });

  it("fills the form from stored state without inventing anything", () => {
    expect(
      commercialFormFrom({
        tier: null,
        mrrCents: null,
        renewalAt: null,
        nextReviewAt: null,
      }),
    ).toEqual({
      tier: "none",
      mrr: "",
      renewalAt: "",
      nextReviewAt: "",
      buildPhaseAmount: "",
      because: "",
    });
    expect(
      commercialFormFrom({
        tier: "run",
        mrrCents: 350050,
        renewalAt: "2027-01-31T00:00:00Z",
        nextReviewAt: null,
      }),
    ).toMatchObject({ tier: "run", mrr: "3500.50", renewalAt: "2027-01-31" });
  });
});
