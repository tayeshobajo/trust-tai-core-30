import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  appendObservationLog,
  describeChange,
  diffObservations,
  movementRows,
  readObservationLog,
  type ObservationChange,
} from "./movement";

const row = (key: string, statement: string, source = "https://example.com/a") => ({
  key,
  statement,
  source_url: source,
});

describe("observed evidence delta", () => {
  it("reports nothing when the same evidence was read again", () => {
    const previous = [row("offer", "We help clinics")];
    expect(diffObservations({ previous, incoming: [row("offer", "We help clinics")] })).toEqual([]);
  });

  it("ignores whitespace and case", () => {
    const previous = [row("offer", "We help clinics")];
    expect(diffObservations({ previous, incoming: [row("offer", "  we  HELP clinics ")] })).toEqual(
      [],
    );
  });

  it("treats a first-ever read as coverage, never movement", () => {
    expect(diffObservations({ previous: [], incoming: [row("offer", "We help clinics")] })).toEqual(
      [],
    );
  });

  it("reports an added observation with its statement and page", () => {
    const changes = diffObservations({
      previous: [row("offer", "We help clinics")],
      incoming: [
        row("offer", "We help clinics"),
        row("pricing", "From 400 a month", "https://x/p"),
      ],
    });
    expect(changes).toHaveLength(1);
    expect(changes[0]!.kind).toBe("added");
    expect(changes[0]!.key).toBe("pricing");
    expect(changes[0]!.statement).toBe("From 400 a month");
    expect(changes[0]!.sourceUrl).toBe("https://x/p");
  });

  it("reports a reworded observation with both readings", () => {
    const changes = diffObservations({
      previous: [row("offer", "We help clinics")],
      incoming: [row("offer", "We help dental clinics")],
    });
    expect(changes[0]!.kind).toBe("changed");
    expect(changes[0]!.previousStatement).toBe("We help clinics");
    expect(changes[0]!.statement).toBe("We help dental clinics");
  });

  it("never reports a removal for an area the pass did not reach", () => {
    const changes = diffObservations({
      previous: [row("offer", "We help clinics"), row("team", "Two founders")],
      incoming: [row("offer", "We help clinics")],
    });
    expect(changes).toEqual([]);
  });

  it("reports a removal only when the pass really covered that area", () => {
    const changes = diffObservations({
      previous: [row("offer", "We help clinics"), row("team", "Two founders")],
      incoming: [row("offer", "We help clinics")],
      coveredKeys: ["team"],
    });
    expect(changes).toHaveLength(1);
    expect(changes[0]!.kind).toBe("removed");
    expect(changes[0]!.previousStatement).toBe("Two founders");
  });

  it("separates a page move from a change of fact", () => {
    const changes = diffObservations({
      previous: [row("offer", "We help clinics", "https://x/a")],
      incoming: [row("offer", "We help clinics", "https://x/b")],
    });
    expect(changes[0]!.kind).toBe("source_moved");
  });
});

describe("the stored log", () => {
  it("appends nothing when a read changed nothing", () => {
    const metadata = {};
    expect(appendObservationLog(metadata, { at: "2026-09-08T10:00:00Z", changes: [] })).toEqual([]);
  });

  it("is idempotent when the same read is replayed", () => {
    const change: ObservationChange = {
      kind: "added",
      key: "offer",
      label: null,
      statement: "We help clinics",
      previousStatement: null,
      sourceUrl: null,
      previousSourceUrl: null,
    };
    const entry = { at: "2026-09-08T10:00:00Z", changes: [change] };
    const once = appendObservationLog({}, entry);
    const twice = appendObservationLog({ observation_log: once }, entry);
    expect(twice).toHaveLength(1);
  });

  it("keeps the log bounded and ignores malformed rows", () => {
    const change: ObservationChange = {
      kind: "added",
      key: "offer",
      label: null,
      statement: "x",
      previousStatement: null,
      sourceUrl: null,
      previousSourceUrl: null,
    };
    let log = readObservationLog({ observation_log: [{ nonsense: true }, null, 3] });
    expect(log).toEqual([]);
    for (let i = 0; i < 14; i += 1) {
      log = appendObservationLog(
        { observation_log: log },
        { at: `2026-09-${String(i + 1).padStart(2, "0")}T10:00:00Z`, changes: [change] },
      );
    }
    expect(log).toHaveLength(10);
  });
});

describe("the Movement projection", () => {
  const change = (over: Partial<ObservationChange> = {}): ObservationChange => ({
    kind: "added",
    key: "offer",
    label: null,
    statement: "We help clinics",
    previousStatement: null,
    sourceUrl: "https://x/a",
    previousSourceUrl: null,
    ...over,
  });

  it("is quiet when no company observed a change", () => {
    expect(movementRows([{ subject: "A", log: [] }])).toEqual([]);
  });

  it("shows one row per company, newest observed first", () => {
    const rows = movementRows([
      { subject: "A", log: [{ at: "2026-09-01T10:00:00Z", changes: [change()] }] },
      { subject: "B", log: [{ at: "2026-09-05T10:00:00Z", changes: [change()] }] },
    ]);
    expect(rows.map((entry) => entry.subject)).toEqual(["B", "A"]);
  });

  it("caps the lines shown but keeps the honest count", () => {
    const rows = movementRows([
      {
        subject: "A",
        log: [
          {
            at: "2026-09-05T10:00:00Z",
            changes: [
              change({ key: "a" }),
              change({ key: "b" }),
              change({ key: "c" }),
              change({ key: "d" }),
            ],
          },
        ],
      },
    ]);
    expect(rows[0]!.lines).toHaveLength(3);
    expect(rows[0]!.changeCount).toBe(4);
  });

  it("places companies whose page merely moved after real change", () => {
    const rows = movementRows([
      {
        subject: "moved",
        log: [{ at: "2026-09-09T10:00:00Z", changes: [change({ kind: "source_moved" })] }],
      },
      { subject: "real", log: [{ at: "2026-09-01T10:00:00Z", changes: [change()] }] },
    ]);
    expect(rows.map((entry) => entry.subject)).toEqual(["real", "moved"]);
  });

  it("words each change plainly, with no urgency or score", () => {
    expect(describeChange(change())).toBe("Now says: We help clinics");
    expect(
      describeChange(change({ kind: "changed", label: "Pricing", statement: "From 400" })),
    ).toBe("Pricing now reads: From 400");
    expect(describeChange(change({ kind: "removed", label: "Pricing" }))).toBe(
      "Pricing is no longer stated on the page it was read from",
    );
    expect(describeChange(change({ kind: "source_moved", label: "Pricing" }))).toBe(
      "Pricing says the same thing, on a different page",
    );
  });
});

describe("boundaries", () => {
  it("never reads the fit scoring history", () => {
    const source = readFileSync("src/data/scout/movement.ts", "utf8");
    expect(source).not.toMatch(/research_history|readResearchHistory|computePulse|fit_score/);
  });
});
