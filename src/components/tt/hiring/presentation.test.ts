import { describe, expect, it } from "vitest";
import {
  applicationsByRole,
  candidateRows,
  hiringMetrics,
  type CandidateFilters,
} from "./presentation";
import { STAGES, type Application, type Snapshot } from "@/domain/hiring";
const application = (stage: Application["stage"], i: number): Application => ({
  id: String(i),
  job_id: i % 2 ? "sales" : "builder",
  job_title: i % 2 ? "Digital Sales Intern" : "AI Builder",
  full_name: `Person ${i}`,
  email: `person${i}@example.test`,
  location: "",
  timezone: "",
  linkedin_url: "",
  portfolio_url: "",
  resume_path: "private/test.pdf",
  resume_name: "test.pdf",
  answers: {},
  stage,
  owner_id: null,
  next_action: "",
  review_date: null,
  revision: 4,
  created_at: `2026-11-${String(i + 1).padStart(2, "0")}`,
  talent_pool_consent: false,
});
const data: Snapshot = {
  applications: STAGES.map(application),
  jobs: [],
  messages: [],
  events: [],
};
const filters: CandidateFilters = {
  search: "",
  role: "",
  stage: "",
  attention: false,
  days: "",
  sort: "date",
  direction: "desc",
};
describe("Hiring display selectors", () => {
  it("counts all seven canonical stages, with four active and three terminal applications", () => {
    const m = hiringMetrics(data);
    expect(m.pipeline).toEqual(STAGES.map((stage) => ({ stage, count: 1 })));
    expect([m.total, m.active, m.inactive, m.interview, m.offer, m.hired]).toEqual([
      7, 4, 3, 1, 1, 1,
    ]);
  });
  it("uses actual job IDs for role totals without inventing zero-count roles", () => {
    expect(applicationsByRole(data).map((g) => [g.id, g.count])).toEqual([
      ["builder", 4],
      ["sales", 3],
    ]);
    expect(applicationsByRole({ ...data, applications: [] })).toEqual([]);
  });
  it("combines search, role, canonical stage and attention filters without mutating data", () => {
    expect(
      candidateRows(
        data.applications,
        { ...filters, search: "PERSON1@", role: "sales", stage: "reviewing", attention: true },
        "2026-11-12",
      ).map((a) => a.id),
    ).toEqual(["1"]);
    expect(data.applications.map((a) => a.id)).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
  });
  it("sorts applied date both directions and enforces the selected date range", () => {
    expect(candidateRows(data.applications, filters, "2026-11-12").map((a) => a.id)).toEqual([
      "6",
      "5",
      "4",
      "3",
      "2",
      "1",
      "0",
    ]);
    expect(
      candidateRows(data.applications, { ...filters, direction: "asc" }, "2026-11-12")[0]?.id,
    ).toBe("0");
    expect(
      candidateRows(data.applications, { ...filters, days: "30" }, "2026-12-06").map((a) => a.id),
    ).toEqual(["6", "5"]);
  });
});
