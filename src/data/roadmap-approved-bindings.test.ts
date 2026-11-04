import { publicRoadmapObservation } from "./roadmap-publication-observation";
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

const nextSeven = [
  {
    slug: "classy-cactus-farm",
    company: "Classy Cactus Farm",
    id: "82146b24-036b-41a5-afab-ebc1ebf9641c",
    relationshipId: "4394a189-b2b0-41a5-9fd3-62d573b9933d",
    prospectId: "96c50123-341c-4f4b-b1a1-aec532a366c8",
  },
  {
    slug: "crenshaw-landscaping",
    company: "Crenshaw Landscaping",
    id: "337e79af-52d6-4fae-9546-39fb5d3d1866",
    relationshipId: "d011b12a-9659-4c57-9d48-b6c8efebc52c",
    prospectId: "d909c2e8-547c-4728-b52a-838442580b53",
  },
  {
    slug: "littlebranch-farm",
    company: "Littlebranch Farm",
    id: "2a2c2a7e-aec4-4fa8-a9de-c85c33328243",
    relationshipId: "f9042865-f1c3-4f60-bfda-de9163d59f61",
    prospectId: "44c1caeb-6339-4541-9282-b3dd7cacc36b",
  },
  {
    slug: "turnip-green",
    company: "Turnip Green Creative Reuse",
    id: "a49dd512-40bb-444e-be43-e0abe8a5a331",
    relationshipId: "aa5aa4a2-3929-4167-811a-fa13f528de71",
    prospectId: "73de4cc7-0846-45ab-94ba-d4aebe092ffc",
  },
  {
    slug: "one-chance-bookkeeping",
    company: "One Chance Bookkeeping",
    id: "4d24fc7d-75bb-45f9-9707-35c32399e187",
    relationshipId: "94cac80d-0d93-4c74-9771-47c278932bec",
    prospectId: "a1ba16a7-fc04-4419-b06e-e8a31f619c30",
  },
  {
    slug: "nashville-glasshaus",
    company: "Nashville Glasshaüs",
    id: "9ecf1d17-c533-4e6e-9d51-bb7686b20902",
    relationshipId: "0e5315f5-8c6f-4b77-b0e6-58a880bdeb5f",
    prospectId: "22afe17d-5ab9-4396-b5e7-e04352b4af62",
  },
  {
    slug: "sase",
    company: "SASE",
    id: "e84cbd41-2fdb-4d0e-8372-ae694335b17c",
    relationshipId: "9145d6a3-f7d0-459e-b060-b6057b920a56",
    prospectId: "1231fa2f-3a63-47ac-8aec-f4ac4e959c9f",
  },
];
const heldRecords = nextSeven.map((entry) => ({
  ...native,
  ...entry,
  organizationId: org,
  title: entry.company,
  subjectLabel: entry.company,
  status: "draft" as const,
  metadata: {
    outreach_holds: [
      {
        kind: "recipient_identity_not_merged",
        source: "Synthetic hold fixture",
        outreach_suppressed: true,
      },
    ],
  },
}));
it("validates all seven approved chains and rejects changed associations despite matching labels", () => {
  const bindings = approvedCanonicalBindings(heldRecords, org);
  expect(bindings).toHaveLength(7);
  expect(bindings.every((b) => b.reviewedAt === "2026-11-03T22:21:43.799148Z")).toBe(true);
  for (const r of heldRecords) {
    expect(approvedCanonicalBindings([{ ...r, relationshipId: "changed" }], org)).toEqual([]);
    expect(approvedCanonicalBindings([{ ...r, prospectId: "changed" }], org)).toEqual([]);
    expect(approvedCanonicalBindings([{ ...r, organizationId: "other-org" }], org)).toEqual([]);
    expect(approvedCanonicalBindings([{ ...r, id: "unreviewed-same-company" }], org)).toEqual([]);
  }
  expect(approvedCanonicalBindings(heldRecords, "other-org")).toEqual([]);
});
it("joins each new public reference once while preserving holds and unknown conversation coverage", () => {
  const records = projectEvidence(
    heldRecords,
    org,
    undefined,
    approvedCanonicalBindings(heldRecords, org),
    publicRoadmapObservation,
  );
  for (const entry of nextSeven) {
    const matches = records.filter(
      (r) => r.native?.id === entry.id || r.publication?.slug === entry.slug,
    );
    expect(matches).toHaveLength(1);
    const r = matches[0]!;
    expect(r.binding).toBe("reviewed");
    expect(r.publication?.url).toBe(`https://trusttai.com/clients/${entry.slug}`);
    expect(r.native?.status).toBe("draft");
    expect(canonicalOutreachHolds(r)[0]?.kind).toBe("recipient_identity_not_merged");
    expect(r.messages).toEqual([]);
    expect(r.importedActivity).toBeUndefined();
    expect(r.coverage).toBeUndefined();
    expect(r.followUp).toBeNull();
  }
});
it("keeps the separate SASE person candidate and existing archives outside the seven bindings", () => {
  const separate = {
    ...native,
    organizationId: org,
    id: "unreviewed-sase-person",
    title: "SASE",
    subjectLabel: "SASE",
    relationshipId: "f987d448-f09b-41eb-8396-60aa2ffb76b8",
  };
  const archived = { ...record, status: "archived" as const };
  const records = projectEvidence(
    [...heldRecords, separate, archived],
    org,
    undefined,
    approvedCanonicalBindings([...heldRecords, separate, archived], org),
    publicRoadmapObservation,
  );
  expect(records.find((r) => r.native?.id === separate.id)?.publication).toBeUndefined();
  expect(records.find((r) => r.native?.id === archived.id)?.native?.status).toBe("archived");
  const sase = records.find((r) => r.publication?.slug === "sase")!;
  expect(sase.native?.relationshipId).toBe("9145d6a3-f7d0-459e-b060-b6057b920a56");
});
it("retains the initial batch provenance while adding the new batch", () => {
  const bindings = approvedCanonicalBindings([record, ...heldRecords], org);
  expect(bindings).toHaveLength(8);
  expect(bindings.find((b) => b.slug === "highview")?.reviewedAt).toBe(
    "2026-11-03T18:25:22.418683Z",
  );
});
