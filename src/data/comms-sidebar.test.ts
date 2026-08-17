import { describe, expect, it } from "vitest";

import { commsDriver } from "@/components/tt/comms/comms-sidebar";
import type { InboxView } from "@/data/comms-inbox";

function view(partial: Partial<InboxView["tabCounts"]>, health: Partial<InboxView["healthCounts"]> = {}): InboxView {
  return {
    priority: [],
    others: [],
    tabCounts: { all: 0, needs_you: 0, following_up: 0, archived: 0, ...partial },
    healthCounts: { healthy: 0, needs_attention: 0, at_risk: 0, quiet: 0, ...health },
  };
}

describe("commsDriver", () => {
  it("leads with conversations at risk", () => {
    expect(commsDriver(view({ all: 3, needs_you: 1 }, { at_risk: 2 })).statement).toBe(
      "Bring these back to life.",
    );
  });

  it("keeps conversations warm when someone is waiting on us", () => {
    const driver = commsDriver(view({ all: 2, needs_you: 1 }));
    expect(driver.statement).toBe("Keep conversations warm.");
    expect(driver.detail).toContain("1 conversation");
  });

  it("says nothing is waiting when the inbox is calm", () => {
    expect(commsDriver(view({ all: 2, following_up: 2 })).statement).toBe(
      "Nothing is waiting on you.",
    );
  });

  it("invites a first person when there are none", () => {
    expect(commsDriver(view({})).statement).toBe("Start with one person.");
  });
});
