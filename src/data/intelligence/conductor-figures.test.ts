/**
 * Recorded figures and the learning loop.
 *
 * What is under test is honesty rather than arithmetic: an old bank balance
 * must stop being a bank balance, a corrected number must beat the record it
 * contradicts, and a rejected suggestion must go quiet without disappearing
 * forever.
 */

import { describe, expect, it } from "vitest";

import {
  CORRECTION_SUPPRESSION_DAYS,
  FIGURE_EXPIRY_DAYS,
  FIGURE_STALE_DAYS,
  type BusinessFigure,
  type ConductorCorrection,
} from "@/domain/conductor";
import {
  currentFigure,
  deriveRunway,
  figureAgeDays,
  readFigure,
  readFigures,
} from "@/data/intelligence/conductor/figures";
import {
  figuresWithCorrections,
  isSuppressed,
  learningState,
} from "@/data/intelligence/conductor/learning";

const ORG = "org-1";
const NOW = "2026-03-01T12:00:00.000Z";
const DAY = 86_400_000;

function daysAgo(days: number): string {
  return new Date(Date.parse(NOW) - days * DAY).toISOString();
}

function figure(
  overrides: Partial<BusinessFigure> & Pick<BusinessFigure, "key" | "value">,
): BusinessFigure {
  return {
    id: `figure-${overrides.key}-${overrides.asOf ?? "now"}`,
    organizationId: ORG,
    basis: "decided",
    asOf: daysAgo(1),
    recordedBy: { id: "user-1", label: "Tai" },
    recordedAt: daysAgo(1),
    ...overrides,
  };
}

function correction(
  overrides: Partial<ConductorCorrection> & Pick<ConductorCorrection, "kind">,
): ConductorCorrection {
  return {
    id: `correction-${overrides.kind}-${overrides.at ?? "now"}`,
    organizationId: ORG,
    note: "Because I know the real number.",
    correctedBy: { id: "user-1", label: "Tai" },
    at: daysAgo(1),
    ...overrides,
  };
}

describe("figure freshness", () => {
  it("counts age from the date the figure was true, not when it was typed", () => {
    const row = figure({ key: "cash_on_hand", value: 100, asOf: daysAgo(10), recordedAt: NOW });
    expect(figureAgeDays(row, NOW)).toBe(10);
  });

  it("keeps a stale figure usable but never lets it read healthy", () => {
    const row = figure({ key: "receivables", value: 8000, asOf: daysAgo(FIGURE_STALE_DAYS + 5) });
    const reading = readFigure([row], "receivables", NOW);
    expect(reading?.value).toBe(8000);
    expect(reading?.stale).toBe(true);
    expect(reading?.standing).toBe("watch");
    expect(reading?.because).toMatch(/confirmed/i);
  });

  it("treats an expired figure as no figure at all", () => {
    const row = figure({ key: "cash_on_hand", value: 100, asOf: daysAgo(FIGURE_EXPIRY_DAYS + 1) });
    expect(currentFigure([row], "cash_on_hand", NOW)).toBeUndefined();
    expect(readFigure([row], "cash_on_hand", NOW)).toBeUndefined();
  });

  it("prefers the freshest recording of the same key", () => {
    const older = figure({ key: "monthly_burn", value: 30_000, asOf: daysAgo(30) });
    const newer = figure({ key: "monthly_burn", value: 24_000, asOf: daysAgo(2) });
    expect(currentFigure([older, newer], "monthly_burn", NOW)?.value).toBe(24_000);
  });
});

describe("runway", () => {
  it("divides cash by burn and calls the result inferred, not observed", () => {
    const rows = [
      figure({ key: "cash_on_hand", value: 120_000 }),
      figure({ key: "monthly_burn", value: 24_000 }),
    ];
    const runway = deriveRunway(rows, NOW);
    expect(runway?.value).toBe(5);
    expect(runway?.basis).toBe("inferred");
    expect(runway?.standing).toBe("watch");
    expect(runway?.because).toContain("120000");
  });

  it("flags under three months as at risk", () => {
    const rows = [
      figure({ key: "cash_on_hand", value: 40_000 }),
      figure({ key: "monthly_burn", value: 20_000 }),
    ];
    expect(deriveRunway(rows, NOW)?.standing).toBe("at_risk");
  });

  it("refuses to invent infinite runway when burn is missing or zero", () => {
    const cashOnly = [figure({ key: "cash_on_hand", value: 120_000 })];
    expect(deriveRunway(cashOnly, NOW)).toBeUndefined();
    expect(
      deriveRunway([...cashOnly, figure({ key: "monthly_burn", value: 0 })], NOW),
    ).toBeUndefined();
  });

  it("leads the readings with runway when it can be derived", () => {
    const rows = [
      figure({ key: "cash_on_hand", value: 120_000 }),
      figure({ key: "monthly_burn", value: 24_000 }),
      figure({ key: "close_rate", value: 30 }),
    ];
    const readings = readFigures(rows, NOW);
    expect(readings[0]?.key).toBe("cash_runway");
    expect(readings.map((row) => row.key)).toContain("close_rate");
  });
});

describe("learning from corrections", () => {
  it("turns a corrected number into a decided figure that outranks the record", () => {
    const learning = learningState(
      ORG,
      [
        correction({
          kind: "wrong_figure",
          figure: { key: "monthly_burn", value: 18_000, asOf: daysAgo(1) },
          note: "We cut two contractors.",
        }),
      ],
      NOW,
    );

    const standing = figure({ key: "monthly_burn", value: 24_000 });
    const merged = figuresWithCorrections([standing], learning);
    const chosen = currentFigure(merged, "monthly_burn", NOW);
    expect(chosen?.value).toBe(18_000);
    expect(chosen?.basis).toBe("decided");
    expect(chosen?.recordedBy.label).toBe("Tai");
  });

  it("holds a rejected suggestion quiet, then lets it return", () => {
    const fresh = learningState(
      ORG,
      [correction({ kind: "not_useful", subjectKey: "improve-1", at: daysAgo(2) })],
      NOW,
    );
    expect(isSuppressed(fresh, "improve-1")).toBe(true);

    const expired = learningState(
      ORG,
      [
        correction({
          kind: "not_useful",
          subjectKey: "improve-1",
          at: daysAgo(CORRECTION_SUPPRESSION_DAYS + 1),
        }),
      ],
      NOW,
    );
    expect(isSuppressed(expired, "improve-1")).toBe(false);
  });

  it("never reads another organization's corrections", () => {
    const learning = learningState(
      ORG,
      [
        correction({
          kind: "not_useful",
          subjectKey: "improve-1",
          organizationId: "org-2",
        }),
      ],
      NOW,
    );
    expect(learning.suppressed).toHaveLength(0);
    expect(learning.considered).toHaveLength(0);
  });

  it("keeps a name and a reason on every suppression", () => {
    const learning = learningState(
      ORG,
      [
        correction({
          kind: "already_handled",
          subjectKey: "action-9",
          note: "Called them on Friday.",
        }),
      ],
      NOW,
    );
    expect(learning.suppressed[0]?.because).toBe("Tai: Called them on Friday.");
    expect(learning.suppressed[0]?.until).toBeTruthy();
  });
});
