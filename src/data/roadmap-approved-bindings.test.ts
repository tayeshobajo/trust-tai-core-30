import { expect, it } from "vitest";
import { approvedCanonicalBindings } from "./roadmap-approved-bindings";
import { native } from "@/domain/roadmap-evidence.fixtures";
import { canonicalOutreachHolds, evidenceHolds, projectEvidence } from "@/domain/roadmap-evidence";
const org = "ee683a64-e045-4226-a8ff-4ae6590d6789";
const record = {
  ...native,
  organizationId: org,
  id: "55d288a0-e8f1-5f54-aa4a-61afbd77368e",
  relationshipId: "a670e5ea-fcb8-566e-803a-60233f82fcf3",
  prospectId: "aa2dbb75-63d2-5f6c-bd57-95eff0b06d67",
};
it("binds only the approved identity with current canonical associations", () => {
  expect(approvedCanonicalBindings([record], org)[0]?.slug).toBe("highview");
  expect(approvedCanonicalBindings([{ ...record, relationshipId: "changed" }], org)).toEqual([]);
  expect(approvedCanonicalBindings([record], "other-org")).toEqual([]);
});
it("preserves canonical suppression and bounce holds without inventing message evidence", () => {
  for (const kind of ["declined", "permanent_email_bounce"]) {
    const [r] = projectEvidence(
      [
        {
          ...record,
          metadata: {
            outreach_holds: [
              { kind, source: "Approved canonical batch", outreach_suppressed: true },
            ],
          },
        },
      ],
      org,
    );
    expect(canonicalOutreachHolds(r!)[0]?.kind).toBe(kind);
    expect(evidenceHolds(r!)[0]).toMatch(/suppressed|held/);
    expect(r!.messages).toEqual([]);
  }
});
