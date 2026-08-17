import { describe, expect, it } from "vitest";

import {
  EMPTY_FILTERS,
  filterCandidates,
  pageNumbers,
  paginate,
  profileOptions,
} from "./scout-table";
import type { ProspectCandidate } from "@/domain/scout";

function candidate(
  name: string,
  score: number,
  extra: Partial<ProspectCandidate> = {},
): ProspectCandidate {
  return {
    prospect: {
      id: name,
      organizationId: "org",
      name,
      domain: `${name.toLowerCase()}.com`,
      websiteUrl: `https://${name.toLowerCase()}.com`,
      status: "discovered",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    signals: [],
    fit: { whyItFits: "", recommendation: "" },
    source: { kind: "live_website", label: "Public website" },
    evaluation: {
      light: score >= 80 ? "green" : "yellow",
      score,
      scoreable: true,
      reasons: [],
      strongestSignal: "",
    },
    lastCheckedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  } as ProspectCandidate;
}

describe("filterCandidates", () => {
  const rows = [
    candidate("Alpha", 90, { profile: { industry: "IT", location: "Nashville", size: "11–50" } }),
    candidate("Beta", 65, { profile: { industry: "Legal", location: "Austin", size: "1–10" } }),
  ];

  it("matches on search term", () => {
    expect(filterCandidates(rows, { ...EMPTY_FILTERS, search: "alph" })).toHaveLength(1);
  });

  it("filters by industry and score band", () => {
    expect(filterCandidates(rows, { ...EMPTY_FILTERS, industry: "Legal" })[0]?.prospect.name).toBe(
      "Beta",
    );
    expect(filterCandidates(rows, { ...EMPTY_FILTERS, score: "high" })).toHaveLength(1);
  });

  it("lists only values present on the board", () => {
    expect(profileOptions(rows, "location")).toEqual(["Austin", "Nashville"]);
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 23 }, (_, i) => i + 1);

  it("bounds the visible rows and reports the range", () => {
    const view = paginate(items, 2, 10);
    expect(view.rows).toHaveLength(10);
    expect([view.from, view.to, view.pageCount]).toEqual([11, 20, 3]);
  });

  it("clamps an out-of-range page", () => {
    expect(paginate(items, 99, 10).page).toBe(3);
  });

  it("handles an empty board", () => {
    expect(paginate([], 1, 10)).toMatchObject({ total: 0, from: 0, to: 0, pageCount: 1 });
  });

  it("elides long page runs", () => {
    expect(pageNumbers(5, 20)).toEqual([1, null, 4, 5, 6, null, 20]);
    expect(pageNumbers(2, 4)).toEqual([1, 2, 3, 4]);
  });
});
