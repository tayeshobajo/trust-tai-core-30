import { describe, expect, it } from "vitest";

import {
  CONTEXTUAL_PANELS,
  PANEL_DOORWAY,
  isPanelOpen,
  panelVisibility,
} from "./project-workroom-contextual";

describe("project workroom contextual panels", () => {
  it("hides a panel that has no state and was not asked for", () => {
    for (const panel of CONTEXTUAL_PANELS) {
      expect(panelVisibility({ active: 0, opened: null, panel })).toBe("hidden");
    }
  });

  it("shows concise state when there is real state", () => {
    expect(panelVisibility({ active: 1, opened: null, panel: "blocker" })).toBe("state");
    expect(panelVisibility({ active: 0, recorded: 2, opened: null, panel: "decision" })).toBe(
      "state",
    );
  });

  it("opens the full path only when a person asked for it", () => {
    expect(panelVisibility({ active: 0, opened: "blocker", panel: "blocker" })).toBe("form");
    expect(panelVisibility({ active: 3, opened: "route", panel: "route" })).toBe("form");
    expect(panelVisibility({ active: 0, opened: "route", panel: "blocker" })).toBe("hidden");
  });

  it("treats state and form as rendered, hidden as nothing on the page", () => {
    expect(isPanelOpen("hidden")).toBe(false);
    expect(isPanelOpen("state")).toBe(true);
    expect(isPanelOpen("form")).toBe(true);
  });

  it("always names a doorway for every capability", () => {
    for (const panel of CONTEXTUAL_PANELS) {
      expect(PANEL_DOORWAY[panel].length).toBeGreaterThan(0);
    }
  });
});
