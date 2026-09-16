import { describe, expect, it } from "vitest";
import { actionIntegrityFindings, attachmentStamp } from "./comms-action-integrity";

const facts = (body: string, attachments: { filename: string; mimeType: string }[] | null = []) => ({
  body,
  attachments,
});

const SARENA = `Hi Dami,

You can choose a time that works for both of you here:
Strategic Clarity Session With Tai - Tai Shobajo

Thanks,
Sarena`;

describe("the link promise", () => {
  it("catches the booking line with no address after it", () => {
    const found = actionIntegrityFindings(facts(SARENA));
    expect(found).toHaveLength(1);
    expect(found[0]?.problem).toBe("missing_link");
    expect(found[0]?.severity).toBe("must_fix");
    expect(found[0]?.excerpt).toBe("You can choose a time that works for both of you here:");
    expect(found[0]?.suggestion).not.toMatch(/https?:\/\//);
  });

  it("stays quiet when a real booking address is in the message", () => {
    const body = SARENA.replace(
      "Strategic Clarity Session With Tai - Tai Shobajo",
      "Strategic Clarity Session With Tai - Tai Shobajo\nhttps://cal.trusttai.com/clarity",
    );
    expect(actionIntegrityFindings(facts(body))).toEqual([]);
  });

  it("does not fire on the ordinary word here", () => {
    expect(
      actionIntegrityFindings(facts("We're happy to help here if needed. Just say the word.")),
    ).toEqual([]);
  });

  it("treats a label that looks like a link as text, not a link", () => {
    const found = actionIntegrityFindings(facts("Please book here:\nDiscovery Call - Trust Tai"));
    expect(found[0]?.problem).toBe("missing_link");
  });
});

describe("the attachment promise", () => {
  it("catches a promised file when nothing is staged", () => {
    const found = actionIntegrityFindings(facts("Hi, I've attached invoice 481 for last month."));
    expect(found).toHaveLength(1);
    expect(found[0]?.problem).toBe("missing_attachment");
    expect(found[0]?.excerpt).toContain("attached invoice 481");
  });

  it("stays quiet when the file is really staged", () => {
    expect(
      actionIntegrityFindings(
        facts("Hi, I've attached invoice 481 for last month.", [
          { filename: "invoice-481.pdf", mimeType: "application/pdf" },
        ]),
      ),
    ).toEqual([]);
  });

  it("never claims there is no attachment when it cannot check", () => {
    expect(actionIntegrityFindings(facts("See attached.", null))).toEqual([]);
  });
});

describe("the below reference", () => {
  it("catches a promise with nothing after it", () => {
    const found = actionIntegrityFindings(facts("See the details below:\n\nThanks,\nSarena"));
    expect(found[0]?.problem).toBe("missing_below");
  });

  it("stays quiet when the promised content is really there", () => {
    const body = "The steps are below:\n1. Confirm the date\n2. Send the brief\n\nThanks";
    expect(actionIntegrityFindings(facts(body))).toEqual([]);
  });
});

describe("the destination promise", () => {
  it("catches call me at with no number", () => {
    const found = actionIntegrityFindings(facts("Call me at any time this week."));
    expect(found[0]?.problem).toBe("missing_destination");
  });

  it("stays quiet when the number is supplied", () => {
    expect(actionIntegrityFindings(facts("Call me at +44 7700 900123 any time."))).toEqual([]);
  });

  it("stays quiet when the address is supplied", () => {
    expect(actionIntegrityFindings(facts("Email me at tai@trusttai.com when ready."))).toEqual([]);
  });
});

describe("quiet by default", () => {
  it("raises nothing on a public sector acknowledgement with a valid booking address", () => {
    const body = `Thank you for the invitation. We are reviewing the requirements and will respond this week.

If it helps in the meantime, you can book a call here: https://cal.trusttai.com/clarity

Best,
Tai`;
    expect(actionIntegrityFindings(facts(body))).toEqual([]);
  });

  it("only ever quotes words that are really in the draft", () => {
    for (const finding of actionIntegrityFindings(facts(SARENA))) {
      expect(SARENA.includes(finding.excerpt)).toBe(true);
    }
  });
});

describe("the attachment stamp", () => {
  it("is empty when nothing is staged, so old fingerprints do not move", () => {
    expect(attachmentStamp([])).toBe("");
    expect(attachmentStamp(null)).toBe("");
  });

  it("changes when the staged set changes", () => {
    const one = attachmentStamp([
      { filename: "a.pdf", mimeType: "application/pdf", size: 10, path: "o/d/a" },
    ]);
    const two = attachmentStamp([
      { filename: "a.pdf", mimeType: "application/pdf", size: 10, path: "o/d/b" },
    ]);
    expect(one).not.toBe(two);
  });

  it("does not depend on the order files were staged in", () => {
    const a = { filename: "a.pdf", mimeType: "application/pdf", size: 1, path: "x" };
    const b = { filename: "b.pdf", mimeType: "application/pdf", size: 2, path: "y" };
    expect(attachmentStamp([a, b])).toBe(attachmentStamp([b, a]));
  });
});
