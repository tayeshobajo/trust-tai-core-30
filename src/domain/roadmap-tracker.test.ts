import { describe, expect, it } from "vitest";
import { trackerBaseline as baseline } from "@/data/roadmap-tracker/baseline.server";
import {
  checkReviewedApply,
  preparationBlockers,
  preparationFingerprint,
  previewTracker,
  trackerSummary,
  type TrackerBinding,
  type OutreachPreparation,
} from "./roadmap-tracker";
import type { Roadmap } from "./roadmap";

const roadmap: Roadmap = {
  id: "canonical-1",
  organizationId: "org",
  title: "Spartan roadmap",
  subjectLabel: "Spartan",
  status: "approved",
  objective: "",
  pointA: [],
  pointB: null,
  nextMove: { action: "Human next move", because: "Discussed today", tier: "decided" },
  metadata: {},
  createdAt: "2026-10-01",
  updatedAt: "2026-10-14",
};
const row = baseline.rows[2]!;
const binding: TrackerBinding = {
  sourceKey: row.sourceKey,
  fileId: baseline.fileId,
  sheet: baseline.sheet,
  roadmapId: roadmap.id,
  organizationId: "org",
  reviewedBy: "person",
  reviewedAt: "2026-10-14",
};
const review = () => previewTracker(baseline, [roadmap], "org", [binding])[2]!;

describe("verified workbook import review", () => {
  it("retains exact file identity, all 12 rows, original row evidence and blanks", () => {
    expect(baseline.fileId).toBe("1kr0sb0LQAaJbm-HtUauQW6WUFQkCKjt9");
    expect(baseline.sha256).toBe(
      "edd238c355030f1072f9d9ad17a19a1358c93ba5a7846716938f5ee078cee7c3",
    );
    expect(baseline.sheet).toBe("Roadmap Tracker");
    expect(baseline.rows).toHaveLength(12);
    expect(baseline.rows.map((r) => r.row)).toEqual(Array.from({ length: 12 }, (_, i) => i + 5));
    expect(
      baseline.rows.every(
        (r) =>
          Object.keys(r.cells).length === 13 &&
          r.cells.dateSent === null &&
          r.cells.clientSignal === null &&
          r.cells.channel === null &&
          r.cells.keyLinks === null,
      ),
    ).toBe(true);
    expect(baseline.rows.filter((r) => r.cells.nextAction === null)).toHaveLength(11);
  });
  it("does not bind by name, even one exact match", () => {
    const item = previewTracker(baseline, [roadmap], "org")[2]!;
    expect(item.roadmap).toBeNull();
    expect(item.holds.join()).toContain("binding needs review");
  });
  it("holds ambiguous names, duplicate source keys, and cross-organization bindings", () => {
    expect(
      previewTracker(baseline, [roadmap, { ...roadmap, id: "other" }], "org")[2]!.holds.join(),
    ).toContain("Ambiguous");
    expect(
      previewTracker({ ...baseline, rows: [row, row] }, [roadmap], "org", [
        binding,
      ])[0]!.holds.join(),
    ).toContain("Duplicate source");
    expect(previewTracker(baseline, [roadmap], "another-org", [binding])[2]!.roadmap).toBeNull();
  });
  it("repeated preview is deterministic and sorting does not change binding or receipt", () => {
    expect(review()).toEqual(review());
    const sorted = previewTracker(
      { ...baseline, rows: [...baseline.rows].reverse().map((r, i) => ({ ...r, row: i + 5 })) },
      [roadmap],
      "org",
      [binding],
    ).find((r) => r.source.sourceKey === row.sourceKey)!;
    expect(sorted.receiptKey).toBe(review().receiptKey);
    expect(sorted.roadmap?.id).toBe(roadmap.id);
  });
  it("treats a repeated reviewed import as a no-op after readback", () => {
    const current = {
      ...roadmap,
      metadata: {
        outreach_tracker: { fields: { pipelineStage: "Sent" }, receipts: [review().receiptKey] },
      },
    };
    expect(checkReviewedApply(review(), current, review().receiptKey)).toBe("no_op");
  });
  it("does not overwrite lifecycle, ownership, next move or newer human fields", () => {
    const current = {
      ...roadmap,
      metadata: {
        outreach_tracker: {
          fields: {
            pipelineStage: "Follow-up",
            priority: "High",
            lastMeaningfulUpdate: "2026-10-14",
          },
          receipts: [],
        },
      },
    };
    const item = previewTracker(baseline, [current], "org", [binding])[2]!;
    expect(item.conflicts.join()).toContain("Roadmap Stage");
    expect(item.proposed.priority).toBeUndefined();
    expect(item.proposed.lastMeaningfulUpdate).toBeUndefined();
    expect(item.roadmap?.nextMove).toEqual(roadmap.nextMove);
    expect(item.roadmap?.status).toBe("approved");
  });
  it("preserves source Approved and never grants approval", () => {
    const sase = baseline.rows[9]!;
    const item = previewTracker(baseline, [roadmap], "org", [
      { ...binding, sourceKey: sase.sourceKey },
    ])[9]!;
    expect(item.proposed.pipelineStage).toBe("Approved");
    expect(Object.keys(item.proposed)).not.toContain("status");
  });
  it("holds Elevate old action and preserves the original words", () => {
    const item = previewTracker(baseline, [roadmap], "org", [
      { ...binding, sourceKey: baseline.rows[0]!.sourceKey },
    ])[0]!;
    expect(item.holds.join()).toContain("October 2");
    expect(item.proposed.nextAction).toBeUndefined();
    expect(item.source.cells.nextAction).toContain("Send the updated roadmap");
  });
  it("requires fresh readback, exact review and optimistic concurrency", () => {
    const item = review();
    expect(checkReviewedApply(item, null, item.receiptKey)).toBe("readback_required");
    expect(checkReviewedApply(item, roadmap, null)).toBe("review_required");
    expect(checkReviewedApply(item, { ...roadmap, updatedAt: "later" }, item.receiptKey)).toBe(
      "conflict",
    );
    expect(
      checkReviewedApply(
        item,
        { ...roadmap, nextMove: { ...roadmap.nextMove!, action: "changed" } },
        item.receiptKey,
      ),
    ).toBe("conflict");
    expect(checkReviewedApply(item, roadmap, item.receiptKey)).toBe("eligible_for_later_apply");
  });
  it("does not convert unknown outcomes or dates to zero", () => {
    expect(trackerSummary(baseline.rows)).toMatchObject({
      won: 0,
      lost: 0,
      winRate: null,
      averageDays: null,
    });
    expect(
      trackerSummary([
        { ...row, cells: { ...row.cells, pipelineStage: "Closed - Won", conversionDays: "0" } },
      ]),
    ).toMatchObject({ winRate: 1, averageDays: 0 });
  });
});

function prepared(): OutreachPreparation {
  const value: OutreachPreparation = {
    roadmapId: roadmap.id,
    organizationId: "org",
    draftId: "draft-1",
    recipientVerifiedAt: "2026-10-14T12:00:00Z",
    recipientEvidence: "contact-verified-1",
    payload: {
      channel: "email_gmail",
      subject: "Roadmap preview",
      body: "Exact reviewed words",
      recipient: "recipient@example.test",
      senderIdentity: "sender@example.test",
      attachments: [],
    },
    export: {
      id: "export-1",
      roadmapId: roadmap.id,
      version: "v2",
      digest: "sha256:exact-export",
      frozen: true,
      kind: "preview",
    },
    approval: {
      requestId: "approval-1",
      itemId: "item-1",
      eventId: "event-1",
      revision: 1,
      status: "approved",
      fingerprint: "",
      expiresAt: "2026-10-15T00:00:00Z",
      maxSends: 1,
    },
    deliveryState: "not_attempted",
  };
  value.approval!.fingerprint = preparationFingerprint(value);
  return value;
}
describe("outreach preparation, never dispatch", () => {
  it("requires verified recipient, exact frozen export and bounded approval", () => {
    const value = prepared();
    expect(preparationBlockers(review(), value, "2026-10-14T15:00:00Z")).toEqual([]);
    value.recipientEvidence = null;
    value.export!.frozen = false;
    value.approval!.maxSends = 2;
    expect(preparationBlockers(review(), value, "2026-10-14T15:00:00Z")).toHaveLength(3);
  });
  it.each(["recipient", "body", "version", "revision", "kind", "revoked", "expired"])(
    "invalidates approval after %s changes",
    (change) => {
      const value = prepared();
      if (change === "recipient") value.payload.recipient = "other@example.test";
      if (change === "body") value.payload.body = "changed";
      if (change === "version") value.export!.version = "v3";
      if (change === "revision") value.approval!.revision++;
      if (change === "kind") value.export!.kind = "priced_proposal";
      if (change === "revoked") value.approval!.status = "revoked";
      if (change === "expired") value.approval!.expiresAt = "2026-10-13T00:00:00Z";
      expect(preparationBlockers(review(), value, "2026-10-14T15:00:00Z").join()).toContain(
        "human approval",
      );
    },
  );
  it.each(["sent", "unknown", "attempting", "failed"] as const)(
    "refuses a repeated attempt after %s",
    (deliveryState) => {
      expect(
        preparationBlockers(
          review(),
          { ...prepared(), deliveryState },
          "2026-10-14T15:00:00Z",
        ).join(),
      ).toContain("delivery receipt");
    },
  );
});
