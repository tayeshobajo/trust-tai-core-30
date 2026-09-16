/**
 * The strategic gate, proved on words rather than opinions.
 *
 * Two misses are pinned here: a teammate's message that quietly hands the
 * client to the person who has been leading them, and a routine rate applied
 * to a contract that is not routine. The quiet cases matter just as much: an
 * acknowledgement, a scheduling note, and repeat work on agreed terms must
 * raise nothing.
 */

import { describe, expect, it } from "vitest";

import { commercialSignals, leadsRelationship, strategicFindings } from "./comms-strategic-gate";

const TAI_LED = [
  "Notes from the client: we have been working directly with Tai since the discovery call.",
  "Tai walked us through the roadmap last month.",
].join("\n");

describe("relationship continuity", () => {
  it("flags a teammate's message that reads as a handoff to the person leading", () => {
    const [finding] = strategicFindings({
      draftBody:
        "Thanks for confirming Thursday. I have put the invite in.\n\nTai will also walk you through the estimated build time, pricing, and finalize the details.\n\nBest,\nPriya",
      sourceTexts: [TAI_LED],
      authorName: "Priya Raman",
    });

    expect(finding?.kind).toBe("relationship");
    expect(finding?.severity).toBe("must_fix");
    expect(finding?.excerpt).toContain("Tai will also walk you through");
    expect(finding?.why).toContain("leading this relationship");
    /* The teammate stays the sender; nothing is invented. */
    expect(finding?.suggestion).toContain("Keep your own name as the sender");
  });

  it("says nothing when the packet does not show who leads the relationship", () => {
    expect(
      strategicFindings({
        draftBody: "Tai will walk you through the build time and pricing.",
        sourceTexts: ["Can we get moving on the build?"],
        authorName: "Priya Raman",
      }),
    ).toEqual([]);
  });

  it("does not flag the author describing their own next step", () => {
    expect(
      strategicFindings({
        draftBody: "Tai will walk you through the build time on Thursday.",
        sourceTexts: [TAI_LED],
        authorName: "Tai Shobajo",
      }),
    ).toEqual([]);
  });

  it("does not flag an ordinary mention of the person leading", () => {
    expect(
      strategicFindings({
        draftBody: "Tai will be on the call on Thursday as usual.",
        sourceTexts: [TAI_LED],
        authorName: "Priya Raman",
      }),
    ).toEqual([]);
  });

  it("reads leadership only from evidence that places the person with the client", () => {
    expect(leadsRelationship("Tai", TAI_LED)).toBe(true);
    expect(leadsRelationship("Tai", "Copy Tai on the invoice.")).toBe(false);
  });
});

const GOV_INVITE = [
  "Upwork invitation: City of Fairhaven, Department of Transport.",
  "You have been invited to submit a proposal for a public sector website rebuild.",
  "Quarterly reporting and an accessibility compliance review are required.",
].join("\n");

describe("commercial judgment", () => {
  it("blocks a default rate offered into a non-routine opportunity", () => {
    const [finding] = strategicFindings({
      draftBody:
        "Thanks for the invitation. We would deliver this at our standard hourly rate of $95 per hour, starting in October.",
      sourceTexts: [GOV_INVITE],
      authorName: "Priya Raman",
    });

    expect(finding?.kind).toBe("commercial");
    expect(finding?.severity).toBe("must_fix");
    expect(finding?.excerpt).toContain("$95");
    expect(finding?.why).toContain("public sector");
    expect(finding?.why).toContain("human commercial review");
    /* It names what to weigh, and never names a number. */
    expect(finding?.suggestion).toContain("payment cycle");
    expect(`${finding?.why} ${finding?.suggestion}`).not.toMatch(/charge more|premium|too low/i);
  });

  it("says nothing when the reply makes no commercial commitment", () => {
    expect(
      strategicFindings({
        draftBody:
          "Thank you for the invitation. We are reviewing it now and will come back to you this week.",
        sourceTexts: [GOV_INVITE],
        authorName: "Priya Raman",
      }),
    ).toEqual([]);
  });

  it("leaves routine repeat work on agreed terms alone", () => {
    expect(
      strategicFindings({
        draftBody:
          "Happy to run the same monthly session. Tuesday at 10 works at the agreed rate. I will send the invite.",
        sourceTexts: ["Same as last quarter please, the agreed rate is fine."],
        authorName: "Priya Raman",
      }),
    ).toEqual([]);
  });

  it("blocks a concession the packet does not show as approved", () => {
    const [finding] = strategicFindings({
      draftBody:
        "To get this moving I can offer a 15% discount on the first three months and move you to net 60.",
      sourceTexts: ["Budget is tight this quarter."],
      authorName: "Priya Raman",
    });

    expect(finding?.kind).toBe("commercial");
    expect(finding?.excerpt).toContain("15% discount");
    expect(finding?.why).toContain("nothing in the packet shows as already approved");
  });

  it("allows a concession the packet records as approved", () => {
    expect(
      strategicFindings({
        draftBody: "As agreed, the 15% discount applies to the first three months.",
        sourceTexts: ["Owner approved discount of 15% for the first three months."],
        authorName: "Priya Raman",
      }),
    ).toEqual([]);
  });

  it("names only the signals the text actually contains", () => {
    expect(commercialSignals(GOV_INVITE)).toContain("public sector");
    expect(commercialSignals("Quick catch up about Thursday.")).toEqual([]);
  });
});

describe("both gates together", () => {
  it("can raise a relationship finding and a commercial finding on one draft", () => {
    const findings = strategicFindings({
      draftBody:
        "Tai will walk you through the delivery plan.\n\nWe would price this at $95 per hour.",
      sourceTexts: [TAI_LED, GOV_INVITE],
      authorName: "Priya Raman",
    });
    expect(findings.map((finding) => finding.kind)).toEqual(["relationship", "commercial"]);
  });

  it("only ever returns words that are really in the draft", () => {
    for (const finding of strategicFindings({
      draftBody: "Tai will walk you through pricing at $95 per hour.",
      sourceTexts: [TAI_LED, GOV_INVITE],
      authorName: "Priya Raman",
    })) {
      expect("Tai will walk you through pricing at $95 per hour.").toContain(finding.excerpt);
    }
  });
});
