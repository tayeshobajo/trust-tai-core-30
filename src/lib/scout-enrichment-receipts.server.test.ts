import { beforeEach, describe, expect, it } from "vitest";

import {
  clearReceipts,
  consumeReceipt,
  issueReceipt,
  readReceipt,
} from "./scout-enrichment-receipts.server";

const answer = {
  email: "k@acumen.com",
  verified: true,
  provider: "apollo" as const,
  at: "2026-09-16T10:00:00Z",
};

describe("enrichment receipts", () => {
  beforeEach(clearReceipts);

  it("hands back the provider answer for the workspace it was issued to", () => {
    const receipt = issueReceipt({
      organizationId: "org-1",
      prospectId: "pro-1",
      identity: "provider:abc",
      answer,
      now: "2026-09-16T10:00:00Z",
    });
    const read = readReceipt({
      id: receipt.id,
      organizationId: "org-1",
      prospectId: "pro-1",
      now: "2026-09-16T10:05:00Z",
    });
    expect(read?.answer).toEqual(answer);
  });

  it("refuses another workspace or another company", () => {
    const receipt = issueReceipt({
      organizationId: "org-1",
      prospectId: "pro-1",
      identity: "provider:abc",
      answer,
      now: "2026-09-16T10:00:00Z",
    });
    expect(
      readReceipt({ id: receipt.id, organizationId: "org-2", prospectId: "pro-1" }),
    ).toBeNull();
    expect(
      readReceipt({ id: receipt.id, organizationId: "org-1", prospectId: "pro-2" }),
    ).toBeNull();
  });

  it("survives a first failed save and disappears after it is used", () => {
    const receipt = issueReceipt({
      organizationId: "org-1",
      prospectId: "pro-1",
      identity: "provider:abc",
      answer,
      now: "2026-09-16T10:00:00Z",
    });
    expect(readReceipt({ id: receipt.id, organizationId: "org-1", prospectId: "pro-1" })).not.toBeNull();
    consumeReceipt(receipt.id);
    expect(readReceipt({ id: receipt.id, organizationId: "org-1", prospectId: "pro-1" })).toBeNull();
  });

  it("expires honestly rather than pretending it still holds the answer", () => {
    const receipt = issueReceipt({
      organizationId: "org-1",
      prospectId: "pro-1",
      identity: "provider:abc",
      answer,
      now: "2026-09-16T10:00:00Z",
    });
    expect(
      readReceipt({
        id: receipt.id,
        organizationId: "org-1",
        prospectId: "pro-1",
        now: "2026-09-16T11:00:00Z",
      }),
    ).toBeNull();
  });
});
