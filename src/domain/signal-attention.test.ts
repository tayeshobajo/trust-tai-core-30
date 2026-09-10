import { describe, expect, it } from "vitest";

import {
  ATTENTION_THRESHOLDS,
  LEAK_PATTERN_KEYS,
  isLeakPattern,
  impactOf,
  severityOf,
} from "./signal-attention";
import { impactOf as pulseImpactOf, severityOf as pulseSeverityOf } from "@/data/pulse/projection";
import type { Signal, SignalCategory } from "./signals";

function signal(urgency: number, category: SignalCategory): Signal {
  return {
    id: `sig-${urgency}-${category}`,
    appId: "comms",
    category,
    title: "A signal",
    why: "Because it was read.",
    urgency,
    at: "2026-09-09T00:00:00.000Z",
    evidence: [],
  } as unknown as Signal;
}

const CATEGORIES: SignalCategory[] = [
  "pipeline",
  "client_stewardship",
  "pattern",
  "stewardship",
  "growth",
  "technical_risk",
];

describe("shared signal attention", () => {
  it("is the only reading: Pulse projects it rather than re-deriving it", () => {
    for (const category of CATEGORIES) {
      for (let urgency = 0; urgency <= 100; urgency += 5) {
        const row = signal(urgency, category);
        expect(pulseSeverityOf(row)).toBe(severityOf(row));
        expect(pulseImpactOf(row)).toBe(impactOf(row));
      }
    }
  });

  it("reads urgency against the written thresholds", () => {
    expect(severityOf(signal(ATTENTION_THRESHOLDS.actNow, "technical_risk"))).toBe("act_now");
    expect(severityOf(signal(ATTENTION_THRESHOLDS.decide, "pipeline"))).toBe("evaluate");
    expect(severityOf(signal(ATTENTION_THRESHOLDS.watch, "technical_risk"))).toBe("watch_closely");
    expect(severityOf(signal(0, "technical_risk"))).toBe("good_to_know");
  });

  it("treats growth as information, however urgent the number", () => {
    expect(severityOf(signal(100, "growth"))).toBe("good_to_know");
  });

  it("names work leaking between rooms in one place", () => {
    expect(LEAK_PATTERN_KEYS).toEqual(["reply_debt", "unworked_opportunity", "promises_slipping"]);
    expect(isLeakPattern("reply_debt")).toBe(true);
    expect(isLeakPattern("something_else")).toBe(false);
  });
});
