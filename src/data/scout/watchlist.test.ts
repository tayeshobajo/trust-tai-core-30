import { describe, expect, it } from "vitest";

import {
  approvedRows,
  importFileSupport,
  parseWatchlistImport,
  readWatchlistMarker,
  restageRow,
  stagedCounts,
  watchlistMarkerRow,
  watchlistSourceKey,
} from "./watchlist";

const board = [{ name: "Mental Dental", websiteUrl: "https://mentaldental.com" }];

describe("parseWatchlistImport", () => {
  it("reads name and website from one line", () => {
    const [row] = parseWatchlistImport("Acme Dental, acme.com", []);
    expect(row?.name).toBe("Acme Dental");
    expect(row?.websiteUrl).toBe("https://acme.com");
    expect(row?.state).toBe("new");
    expect(row?.keep).toBe(true);
  });

  it("treats a bare address as both name and website", () => {
    const [row] = parseWatchlistImport("www.northfield.co.uk", []);
    expect(row?.websiteUrl).toBe("https://northfield.co.uk");
    expect(row?.name).toBe("northfield.co.uk");
  });

  it("marks a company already on the board as a duplicate, never saving it", () => {
    const [row] = parseWatchlistImport("Mental Dental, mentaldental.com", board);
    expect(row?.state).toBe("duplicate");
    expect(row?.keep).toBe(false);
  });

  it("marks a repeat inside the same list as a duplicate", () => {
    const rows = parseWatchlistImport("Acme, acme.com\nAcme, acme.com", []);
    expect(rows[0]?.state).toBe("new");
    expect(rows[1]?.state).toBe("duplicate");
  });

  it("reports an unreadable line as unreadable rather than guessing", () => {
    const [row] = parseWatchlistImport("!!!! ???", []);
    expect(row?.state).toBe("unreadable");
    expect(row?.keep).toBe(false);
  });

  it("ignores blank lines", () => {
    expect(parseWatchlistImport("\n\n  \n", [])).toHaveLength(0);
  });

  it("counts staged rows without percentages", () => {
    const rows = parseWatchlistImport("Acme, acme.com\nMental Dental\n???", board);
    expect(stagedCounts(rows)).toEqual({ total: 3, ready: 1, duplicate: 1, unreadable: 1 });
  });
});

describe("restageRow", () => {
  it("clears an unreadable row once a person names the company", () => {
    const rows = parseWatchlistImport("???", []);
    const fixed = restageRow(
      rows[0]!,
      { name: "Northfield", websiteUrl: "northfield.com" },
      [],
      rows,
    );
    expect(fixed.state).toBe("new");
    expect(fixed.websiteUrl).toBe("https://northfield.com");
    expect(approvedRows([fixed])).toHaveLength(1);
  });

  it("still refuses a corrected row that duplicates the board", () => {
    const rows = parseWatchlistImport("???", []);
    const fixed = restageRow(rows[0]!, { name: "Mental Dental", websiteUrl: null }, board, rows);
    expect(fixed.state).toBe("duplicate");
    expect(fixed.keep).toBe(false);
  });
});

describe("watchlist marker", () => {
  it("round-trips a human decision with actor and time", () => {
    const marker = {
      method: "manual" as const,
      by: "user-1",
      byLabel: "Tai",
      at: "2026-09-08T10:00:00.000Z",
      note: "Met at a conference.",
      sourceKey: "k",
    };
    const stored = { scout_watchlist: watchlistMarkerRow(marker) };
    expect(readWatchlistMarker(stored)).toEqual(marker);
  });

  it("returns null when no marker is recorded", () => {
    expect(readWatchlistMarker({})).toBeNull();
    expect(readWatchlistMarker(null)).toBeNull();
  });

  it("gives the same replay key for the same company", () => {
    expect(watchlistSourceKey("org", "https://Acme.com ")).toBe(
      watchlistSourceKey("org", "https://acme.com"),
    );
  });
});

describe("delimited file text", () => {
  it("skips a header row and reads name/website columns", () => {
    const rows = parseWatchlistImport(
      "Company,Website\nNorthfield Dental,northfielddental.com",
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Northfield Dental");
    expect(rows[0]?.websiteUrl).toBe("https://northfielddental.com");
  });

  it("keeps a comma inside a quoted company name", () => {
    const [row] = parseWatchlistImport('"Smith, Jones & Co",smithjones.co.uk', []);
    expect(row?.name).toBe("Smith, Jones & Co");
    expect(row?.state).toBe("new");
  });

  it("reads tab separated text", () => {
    const [row] = parseWatchlistImport("Acme Dental\tacme.com", []);
    expect(row?.name).toBe("Acme Dental");
    expect(row?.websiteUrl).toBe("https://acme.com");
  });

  it("says plainly which files it cannot read", () => {
    expect(importFileSupport("uk-dental-groups.csv").readable).toBe(true);
    expect(importFileSupport("list.TSV").readable).toBe(true);
    const workbook = importFileSupport("companies.xlsx");
    expect(workbook.readable).toBe(false);
    expect(workbook.readable === false && workbook.because).toMatch(/export the sheet as csv/i);
    expect(importFileSupport("logo.png").readable).toBe(false);
  });
});
