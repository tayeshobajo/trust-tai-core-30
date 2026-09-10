/**
 * Email pattern inference: guessing a company's naming convention from
 * addresses we already trust, and declining honestly when we cannot.
 *
 * The module's three rules under test: what comes out is a guess with a
 * readable rationale, disagreement is reported rather than averaged away, and
 * role mailboxes never count as evidence of anything.
 */

import { describe, expect, it } from "vitest";

import {
  buildLocalPart,
  inferEmailPattern,
  isRoleMailbox,
  normalizeDomain,
  parsePersonName,
  patternsExplaining,
  proposeEmail,
  proposeEmailFromKnown,
  type EmailPatternId,
} from "./email-pattern";

const DOMAIN = "acme.com";

function known(fullName: string, email: string) {
  return { fullName, email };
}

describe("parsePersonName", () => {
  it.each([
    ["Jane Smith", "jane", "smith"],
    ["  jANE   sMith ", "jane", "smith"],
    ["José Álvarez", "jose", "alvarez"],
    ["Björn Øst", "bjorn", "ost"],
    ["O'Brien Kelly", "obrien", "kelly"],
    ["Jane Smith-Jones", "jane", "smithjones"],
  ])("folds %s to %s / %s", (written, first, last) => {
    const name = parsePersonName(written);
    expect(name.first).toBe(first);
    expect(name.last).toBe(last);
  });

  it("keeps middle names on record but out of first and last", () => {
    const name = parsePersonName("Mary Anne van der Berg");
    expect(name.first).toBe("mary");
    expect(name.last).toBe("berg");
    expect(name.middle).toEqual(["anne", "van", "der"]);
  });

  it("drops stacked honorifics from the front, as written, for a human to audit", () => {
    const name = parsePersonName("Dr. Prof. Ada Lovelace");
    expect(name.first).toBe("ada");
    expect(name.last).toBe("lovelace");
    expect(name.dropped).toEqual(["Dr.", "Prof."]);
  });

  it("drops stacked suffixes from the back", () => {
    const name = parsePersonName("Harold Reed Jr., PhD");
    expect(name.first).toBe("harold");
    expect(name.last).toBe("reed");
    expect(name.dropped).toEqual(["PhD", "Jr."]);
  });

  it("never eats a short name down to nothing: Reed Jr keeps its two parts", () => {
    const name = parsePersonName("Reed Jr");
    expect(name.first).toBe("reed");
    expect(name.last).toBe("jr");
    expect(name.dropped).toEqual([]);
  });

  it("gives a single-word name an empty surname", () => {
    const name = parsePersonName("Madonna");
    expect(name.first).toBe("madonna");
    expect(name.last).toBe("");
  });

  it("yields nothing usable from an empty name", () => {
    expect(parsePersonName("   ")).toEqual({ first: "", last: "", middle: [], dropped: [] });
  });
});

describe("buildLocalPart", () => {
  const jane = parsePersonName("Jane Smith");

  it.each<[EmailPatternId, string]>([
    ["first.last", "jane.smith"],
    ["firstlast", "janesmith"],
    ["first", "jane"],
    ["f.last", "j.smith"],
    ["flast", "jsmith"],
    ["first_last", "jane_smith"],
    ["last.first", "smith.jane"],
    ["firstl", "janes"],
  ])("builds %s as %s", (pattern, local) => {
    expect(buildLocalPart(pattern, jane)).toBe(local);
  });

  it("returns null when a surname pattern meets a single-word name", () => {
    const madonna = parsePersonName("Madonna");
    expect(buildLocalPart("first.last", madonna)).toBeNull();
    expect(buildLocalPart("first", madonna)).toBe("madonna");
  });
});

describe("role mailboxes", () => {
  it.each(["info@acme.com", "hello@acme.com", "support@acme.com", "no-reply@acme.com"])(
    "recognises %s as a function, not a person",
    (email) => {
      expect(isRoleMailbox(email)).toBe(true);
    },
  );

  it("does not mistake a person for a function", () => {
    expect(isRoleMailbox("jane.smith@acme.com")).toBe(false);
  });

  it("never reads a role mailbox as evidence, even when a name would explain it", () => {
    // The scraped-record trap from the module's own comment: without the role
    // check, "Acme Support" would corroborate first@ for the whole company.
    expect(patternsExplaining(known("Info Acme", "info@acme.com"))).toEqual([]);

    const inference = inferEmailPattern({
      domain: DOMAIN,
      known: [known("Acme Support", "support@acme.com")],
    });
    expect(inference.kind).toBe("no_pattern");
    expect(inference.excluded).toEqual([
      expect.objectContaining({ email: "support@acme.com", reason: "role_mailbox" }),
    ]);
  });
});

describe("inferEmailPattern", () => {
  it.each<[EmailPatternId, string]>([
    ["first.last", "jane.smith@acme.com"],
    ["firstlast", "janesmith@acme.com"],
    ["first", "jane@acme.com"],
    ["f.last", "j.smith@acme.com"],
    ["flast", "jsmith@acme.com"],
    ["first_last", "jane_smith@acme.com"],
    ["last.first", "smith.jane@acme.com"],
    ["firstl", "janes@acme.com"],
  ])("reads %s off %s", (pattern, email) => {
    const inference = inferEmailPattern({ domain: DOMAIN, known: [known("Jane Smith", email)] });
    expect(inference.kind).toBe("inferred");
    if (inference.kind !== "inferred") return;
    expect(inference.pattern).toBe(pattern);
  });

  it("recognises a hyphenated surname written into the stored address", () => {
    expect(patternsExplaining(known("Jane Smith-Jones", "jane.smith-jones@acme.com"))).toEqual([
      "first.last",
    ]);
  });

  it("gains confidence as corroboration grows: one is low, two moderate, three high", () => {
    const examples = [
      known("Jane Smith", "jane.smith@acme.com"),
      known("Bob Jones", "bob.jones@acme.com"),
      known("Carol White", "carol.white@acme.com"),
    ];
    const confidences = [1, 2, 3].map((count) => {
      const inference = inferEmailPattern({ domain: DOMAIN, known: examples.slice(0, count) });
      return inference.kind === "inferred" ? inference.confidence : inference.kind;
    });
    expect(confidences).toEqual(["low", "moderate", "high"]);
  });

  it("reports disagreement between conventions rather than picking a winner", () => {
    const inference = inferEmailPattern({
      domain: DOMAIN,
      known: [known("Jane Smith", "jane.smith@acme.com"), known("Bob Jones", "bjones@acme.com")],
    });
    expect(inference.kind).toBe("conflicting");
    if (inference.kind !== "conflicting") return;
    expect(inference.patternsSeen).toEqual(["first.last", "flast"]);
    expect(inference.supporting).toHaveLength(2);
    expect(inference.because).toMatch(/no single convention/i);
  });

  it("caps confidence when the examples cannot tell two conventions apart", () => {
    // A one-letter given name makes first.last and f.last identical, so three
    // examples corroborate without deciding, and high stays out of reach.
    const inference = inferEmailPattern({
      domain: DOMAIN,
      known: [
        known("J Smith", "j.smith@acme.com"),
        known("A Jones", "a.jones@acme.com"),
        known("B White", "b.white@acme.com"),
      ],
    });
    expect(inference.kind).toBe("inferred");
    if (inference.kind !== "inferred") return;
    expect(inference.pattern).toBe("first.last");
    expect(inference.alsoConsistentWith).toEqual(["f.last"]);
    expect(inference.confidence).toBe("moderate");
  });

  it("answers no_pattern honestly when nothing usable was given", () => {
    const inference = inferEmailPattern({ domain: DOMAIN, known: [] });
    expect(inference.kind).toBe("no_pattern");
    expect(inference.because).toMatch(/no convention to apply/i);
  });

  it("excludes each unusable address with its reason in plain English", () => {
    const inference = inferEmailPattern({
      domain: DOMAIN,
      known: [
        known("Jane Smith", "not-an-address"),
        known("Bob Jones", "bob.jones@other.example"),
        known("", "carol.white@acme.com"),
        known("Dan Green", "zebra@acme.com"),
      ],
    });
    expect(inference.kind).toBe("no_pattern");
    expect(inference.excluded.map((entry) => entry.reason)).toEqual([
      "malformed",
      "other_domain",
      "unnamed",
      "unexplained",
    ]);
  });

  it("compares domains case-insensitively and ignores a leading @", () => {
    expect(normalizeDomain(" @Acme.COM ")).toBe("acme.com");
    const inference = inferEmailPattern({
      domain: "Acme.COM",
      known: [known("Jane Smith", "Jane.Smith@ACME.com")],
    });
    expect(inference.kind).toBe("inferred");
  });
});

describe("proposeEmail", () => {
  const settled = inferEmailPattern({
    domain: DOMAIN,
    known: [
      known("Jane Smith", "jane.smith@acme.com"),
      known("Bob Jones", "bob.jones@acme.com"),
      known("Carol White", "carol.white@acme.com"),
    ],
  });

  it("applies the settled convention to a new name, accents folded", () => {
    const proposal = proposeEmail("Diego Marín", settled);
    expect(proposal.kind).toBe("candidate");
    if (proposal.kind !== "candidate") return;
    expect(proposal.candidate.email).toBe("diego.marin@acme.com");
    expect(proposal.candidate.pattern).toBe("first.last");
    expect(proposal.candidate.confidence).toBe("high");
    expect(proposal.candidate.supportingCount).toBe(3);
  });

  it("keeps honorifics and suffixes out of the proposed address", () => {
    const proposal = proposeEmail("Dr. Harold Reed Jr.", settled);
    expect(proposal.kind).toBe("candidate");
    if (proposal.kind !== "candidate") return;
    expect(proposal.candidate.email).toBe("harold.reed@acme.com");
  });

  it("says out loud that nobody has confirmed the guess", () => {
    const proposal = proposeEmail("Diego Marín", settled);
    if (proposal.kind !== "candidate") throw new Error("expected a candidate");
    expect(proposal.candidate.rationale).toMatch(/^Guess only:/);
    expect(proposal.candidate.rationale).toMatch(/Nobody has confirmed this address/);
    expect(proposal.candidate.rationale).toContain("3 known addresses");
  });

  it("caps a collision-prone first@ convention at moderate however strong the support", () => {
    const proposal = proposeEmailFromKnown({
      fullName: "Diego Marín",
      domain: DOMAIN,
      known: [
        known("Jane Smith", "jane@acme.com"),
        known("Bob Jones", "bob@acme.com"),
        known("Carol White", "carol@acme.com"),
      ],
    });
    expect(proposal.kind).toBe("candidate");
    if (proposal.kind !== "candidate") return;
    expect(proposal.candidate.email).toBe("diego@acme.com");
    expect(proposal.candidate.confidence).toBe("moderate");
    expect(proposal.candidate.rationale).toMatch(/could not share it/);
  });

  it("declines when the company's conventions conflict", () => {
    const proposal = proposeEmailFromKnown({
      fullName: "Diego Marín",
      domain: DOMAIN,
      known: [known("Jane Smith", "jane.smith@acme.com"), known("Bob Jones", "bjones@acme.com")],
    });
    expect(proposal).toEqual({
      kind: "declined",
      because: expect.stringMatching(/no single convention/i),
    });
  });

  it("declines when there is no pattern to apply", () => {
    const proposal = proposeEmailFromKnown({ fullName: "Diego Marín", domain: DOMAIN, known: [] });
    expect(proposal.kind).toBe("declined");
  });

  it("declines a name with nothing usable in it", () => {
    const proposal = proposeEmail("   ", settled);
    expect(proposal).toEqual({
      kind: "declined",
      because: expect.stringMatching(/does not contain a usable name/i),
    });
  });

  it("declines a single-word name when the convention needs a surname", () => {
    const proposal = proposeEmail("Madonna", settled);
    expect(proposal).toEqual({
      kind: "declined",
      because: expect.stringMatching(/no surname/i),
    });
  });
});
