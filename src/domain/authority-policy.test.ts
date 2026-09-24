import { describe, expect, it } from "vitest";

import {
  MANUAL_V1_POLICY,
  recommendAuthority,
  type DecisionClassSummary,
} from "@/domain/authority-policy";

function summary(overrides: Partial<DecisionClassSummary> = {}): DecisionClassSummary {
  return {
    decisionClass: "congratulate:milestone_event",
    currentState: "supervised",
    observations: 8,
    voice: { gatePassRate: 0.95, voiceEditDensity: 0.05 },
    truth: { violations: 0, factualCorrections: 0 },
    judgment: { reversedByTai: 0, confirmedByTai: 8 },
    outcome: { replies: 3, positiveProgressions: 1, silences: 4, negativeSignals: 0 },
    ...overrides,
  };
}

describe("MANUAL_V1_POLICY", () => {
  it("is explicitly temporary: engine recommends, human authorizes", () => {
    expect(MANUAL_V1_POLICY.mode).toBe("manual_v1");
    expect(MANUAL_V1_POLICY.engineMayApply).toBe(false);
    expect(MANUAL_V1_POLICY.statedDestination).toContain("Policy-driven graduation");
  });
});

describe("recommendAuthority", () => {
  it("recommends graduation only when all four dimensions carry it", () => {
    const rec = recommendAuthority(summary());
    expect(rec).not.toBeNull();
    expect(rec!.to).toBe("graduated");
    expect(rec!.requiresHumanAuthorization).toBe(true);
    expect(rec!.evidence.join(" ")).toMatch(/Voice.*/);
  });

  it("withholds graduation on any reversal or truth issue", () => {
    expect(recommendAuthority(summary({ judgment: { reversedByTai: 1, confirmedByTai: 7 } }))).toBeNull();
    expect(recommendAuthority(summary({ truth: { violations: 1, factualCorrections: 0 } }))).toBeNull();
    expect(recommendAuthority(summary({ observations: 3, judgment: { reversedByTai: 0, confirmedByTai: 3 } }))).toBeNull();
  });

  it("recommends regression for a graduated class Tai keeps reversing", () => {
    const rec = recommendAuthority(
      summary({ currentState: "graduated", judgment: { reversedByTai: 4, confirmedByTai: 2 } }),
    );
    expect(rec!.to).toBe("supervised");
  });

  it("escalates a graduated class on truth violations", () => {
    const rec = recommendAuthority(
      summary({ currentState: "graduated", truth: { violations: 2, factualCorrections: 1 } }),
    );
    expect(rec!.to).toBe("escalated");
  });

  it("an escalated class only returns through supervision", () => {
    const rec = recommendAuthority(summary({ currentState: "escalated" }));
    expect(rec!.to).toBe("supervised");
    expect(recommendAuthority(summary({ currentState: "escalated", observations: 2 }))).toBeNull();
  });
});
