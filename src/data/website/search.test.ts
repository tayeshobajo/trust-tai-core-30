/**
 * Truth quality of the search reads.
 *
 * Two laws are under test: a metric that was never observable is unknown and
 * not zero, and the inventory can only be used as proof of absence when it was
 * actually read.
 */

import { describe, expect, it } from "vitest";

import type { SearchMetricsDay } from "@/domain/website-analytics";

import {
  contentOpportunities,
  highImpressionLowCtr,
  queryRows,
  strikingDistance,
} from "./search";

const day = (over: Partial<SearchMetricsDay>): SearchMetricsDay => ({
  date: "2026-09-01",
  query: "advisory retainer",
  path: "/advisory",
  clicks: 0,
  impressions: 0,
  position: 0,
  device: null,
  country: null,
  ...over,
});

describe("queryRows unknown handling", () => {
  it("reports an unobservable click through rate as unknown, not zero", () => {
    const [row] = queryRows([day({ clicks: 0, impressions: 0, position: 0 })]);
    expect(row?.ctr).toBeNull();
  });

  it("reports an unobservable average position as unknown, not zero", () => {
    const [row] = queryRows([day({ clicks: 0, impressions: 0, position: 0 })]);
    expect(row?.averagePosition).toBeNull();
  });

  it("keeps a genuinely measured zero click rate at zero", () => {
    const [row] = queryRows([day({ clicks: 0, impressions: 400, position: 12 })]);
    expect(row?.ctr).toBe(0);
    expect(row?.averagePosition).toBe(12);
  });

  it("skips unknown rates rather than reading them as weak", () => {
    const rows = queryRows([day({ clicks: 0, impressions: 0 })]);
    expect(highImpressionLowCtr(rows)).toHaveLength(0);
    expect(strikingDistance(rows)).toHaveLength(0);
  });

  it("still finds a real weak rate and a real striking position", () => {
    const rows = queryRows([day({ clicks: 1, impressions: 400, position: 9 })]);
    expect(highImpressionLowCtr(rows)).toHaveLength(1);
    expect(strikingDistance(rows)).toHaveLength(1);
  });
});

describe("contentOpportunities inventory honesty", () => {
  const rows = [day({ clicks: 2, impressions: 500, position: 14 })];

  it("cannot claim no coverage while the inventory is unread", () => {
    const [row] = contentOpportunities(rows, [], { read: false });
    expect(row?.coverage).toBe("unknown");
    expect(row?.refreshPath).toBe("/advisory");
    expect(row?.reason).toContain("inventory has not been read");
  });

  it("can still report an absent page once the inventory was read", () => {
    const [row] = contentOpportunities(rows, ["/about"], { read: true });
    expect(row?.coverage).toBe("none");
  });

  it("recommends refreshing the page that already covers the demand", () => {
    const [row] = contentOpportunities(rows, ["/advisory"], { read: true });
    expect(row?.coverage).toBe("thin");
    expect(row?.refreshPath).toBe("/advisory");
  });
});
