import { describe, expect, it } from "vitest";

import { receiptMapFrom } from "./workroom";

describe("receiptMapFrom", () => {
  const rows = [
    {
      taskKey: "k1",
      completedAt: "2026-10-17T10:00:00Z",
      completionNote: "Done and verified in the doc.",
      completedBy: "Tai",
    },
  ] as unknown as Parameters<typeof receiptMapFrom>[0];

  it("returns receipts when the read succeeded", () => {
    const map = receiptMapFrom(rows, false);
    expect(map.size).toBe(1);
    expect(map.get("k1")?.completionNote).toBe("Done and verified in the doc.");
  });

  it("returns an EMPTY map when the read failed, so nothing can qualify as verified", () => {
    /* Regression: a failed receipt read previously left stale cached
       receipts in the map, so rows stayed green/Verified, filter tabs
       counted them and the detail panel showed proof — while the alert
       claimed nothing was shown as verified. An empty map suppresses all
       of it consistently. */
    const map = receiptMapFrom(rows, true);
    expect(map.size).toBe(0);
  });

  it("treats missing data as empty, never as proof", () => {
    expect(receiptMapFrom(undefined, false).size).toBe(0);
  });
});
