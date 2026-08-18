import { describe, expect, it } from "vitest";

import {
  metricText,
  paperclipConnection,
  PAPERCLIP_MODE_LABEL,
} from "./paperclip-connection";

const NOW = Date.parse("2026-08-18T20:00:00.000Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

describe("paperclip connection state", () => {
  it("reports LIVE when the direct API is reachable", () => {
    const state = paperclipConnection({
      liveReachable: true,
      lastSuccessAt: ago(45),
      now: NOW,
    });
    expect(state.mode).toBe("live");
    expect(state.label).toBe(PAPERCLIP_MODE_LABEL.live);
    expect(state.prominentWarning).toBe(false);
    expect(state.metricsKnown).toBe(true);
  });

  it("reports SYNCHRONIZED with no warning when reconciliation is fresh", () => {
    const state = paperclipConnection({
      liveReachable: false,
      lastSuccessAt: ago(3),
      now: NOW,
    });
    expect(state.mode).toBe("synchronized");
    expect(state.freshness).toBe("fresh");
    expect(state.prominentWarning).toBe(false);
    expect(state.delayed).toBe(false);
    expect(state.helper).toContain("Showing synchronized state from 3m ago");
  });

  it("softly flags a delayed sync between 10 and 30 minutes", () => {
    const state = paperclipConnection({
      liveReachable: false,
      lastSuccessAt: ago(18),
      now: NOW,
    });
    expect(state.mode).toBe("synchronized");
    expect(state.delayed).toBe(true);
    expect(state.prominentWarning).toBe(false);
    expect(state.helper).toContain("Sync delayed");
    expect(state.ageLabel).toBe("18m ago");
  });

  it("reports INTERRUPTED with a prominent warning past 30 minutes", () => {
    const state = paperclipConnection({
      liveReachable: false,
      lastSuccessAt: ago(31),
      now: NOW,
    });
    expect(state.mode).toBe("interrupted");
    expect(state.prominentWarning).toBe(true);
    expect(state.helper).toContain("Paperclip sync interrupted");
  });

  it("reports INTERRUPTED when no reconciliation has ever succeeded", () => {
    const state = paperclipConnection({ liveReachable: false, lastSuccessAt: null, now: NOW });
    expect(state.mode).toBe("interrupted");
    expect(state.freshness).toBe("never");
    expect(state.ageLabel).toBeNull();
  });

  it("treats the 10 and 30 minute edges as inclusive", () => {
    expect(
      paperclipConnection({ liveReachable: false, lastSuccessAt: ago(10), now: NOW }).delayed,
    ).toBe(false);
    expect(
      paperclipConnection({ liveReachable: false, lastSuccessAt: ago(30), now: NOW }).mode,
    ).toBe("synchronized");
  });
});

describe("unknown metrics", () => {
  it("renders an em dash when a count is unknown", () => {
    expect(metricText(null)).toBe("\u2014");
    expect(metricText(undefined)).toBe("\u2014");
  });

  it("renders 0 only when zero is proven", () => {
    expect(metricText(0)).toBe("0");
    expect(metricText(4)).toBe("4");
  });
});
