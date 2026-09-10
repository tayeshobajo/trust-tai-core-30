/**
 * The bounded project context layer: caps hold, chronology holds,
 * interpretation stays separate from evidence.
 */

import { describe, expect, it } from "vitest";
import {
  inChronology,
  readTrajectory,
  withinBudget,
  type ContextLine,
} from "./comms-context.server";

const lines: ContextLine[] = [
  { source: "client", kind: "evidence", text: "Client: Mental Dental (active)" },
  {
    source: "project",
    kind: "evidence",
    text: "Project Platform: status building, next move student data",
    at: "2026-01-02T00:00:00.000Z",
  },
  {
    source: "communication",
    kind: "evidence",
    text: "You replied from Gmail: Re: Input Items",
    at: "2026-01-05T00:00:00.000Z",
  },
];

describe("withinBudget", () => {
  it("keeps the packet inside its character budget", () => {
    const kept = withinBudget(lines, 40);
    const used = kept.reduce((total, line) => total + line.text.length + 1, 0);
    expect(used).toBeLessThanOrEqual(40);
    expect(kept.length).toBeLessThan(lines.length);
  });

  it("keeps everything when it already fits", () => {
    expect(withinBudget(lines, 2000)).toHaveLength(3);
  });
});

describe("inChronology", () => {
  it("orders the work the way it happened", () => {
    const ordered = inChronology([lines[2]!, lines[1]!]);
    expect(ordered.map((line) => line.at)).toEqual([
      "2026-01-02T00:00:00.000Z",
      "2026-01-05T00:00:00.000Z",
    ]);
  });
});

describe("readTrajectory", () => {
  it("reads direction from the selected evidence", () => {
    const trajectory = readTrajectory(lines);
    expect(trajectory.join(" ")).toContain("Platform");
    expect(trajectory.join(" ")).toContain("Re: Input Items");
  });

  it("says plainly when there is nothing to build on, inventing nothing", () => {
    expect(readTrajectory([]).join(" ")).toContain("thread stands alone");
  });
});
