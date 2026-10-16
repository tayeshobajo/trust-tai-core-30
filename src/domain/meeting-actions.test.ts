import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  completeAction,
  correlationKeyFor,
  filterActions,
  isOverdue,
  parseMeetingActions,
  reopenAction,
} from "./meeting-actions";

const TODAY = "2026-10-16";

describe("meeting actions staging", () => {
  it("never invents an owner", () => {
    const [item] = parseMeetingActions("- Send the synthetic summary");
    expect(item!.owner).toBeNull();
    expect(item!.status).toBe("proposed");
  });

  it("reads owner and exact due from a bullet", () => {
    const [item] = parseMeetingActions("- Draft agenda @Sam Lee due:2026-10-20");
    expect(item!.owner).toBe("Sam Lee");
    expect(item!.dueCertainty).toBe("exact");
    expect(item!.dueDate).toBe("2026-10-20");
  });

  it("treats spoken timing as uncertain and never overdue", () => {
    const [item] = parseMeetingActions("- Follow up due:next week");
    expect(item!.dueCertainty).toBe("said");
    expect(isOverdue(item!, TODAY)).toBe(false);
  });

  it("marks only past exact dates as overdue, never done ones", () => {
    const items = parseMeetingActions(
      JSON.stringify([
        { statement: "Past", due: "2026-10-01", status: "confirmed" },
        { statement: "Past done", due: "2026-10-01", status: "complete" },
        { statement: "Future", due: "2026-11-01" },
      ]),
    );
    expect(filterActions(items, "overdue", TODAY).map((i) => i.statement)).toEqual(["Past"]);
  });

  it("refuses blocked without a recorded reason", () => {
    const items = parseMeetingActions(
      JSON.stringify([
        { statement: "A", status: "blocked" },
        { statement: "B", status: "blocked", blocked_because: "Waiting on access" },
      ]),
    );
    expect(filterActions(items, "blocked", TODAY).map((i) => i.statement)).toEqual(["B"]);
  });

  it("reopen returns to the status before completion", () => {
    const [item] = parseMeetingActions(JSON.stringify([{ statement: "X", status: "in_progress" }]));
    expect(reopenAction(completeAction(item!)).status).toBe("in_progress");
  });

  it("correlation key is stable across whitespace and case", () => {
    expect(correlationKeyFor("s", "Send  Deck")).toBe(correlationKeyFor("s", "send deck"));
  });

  it("no meeting fixture data ships in src", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/meeting-actions.*\.json$/i.test(name)) hits.push(path);
      }
    };
    walk("src");
    expect(hits).toEqual([]);
    expect(readFileSync("src/domain/meeting-actions.ts", "utf8")).not.toMatch(/localStorage/);
  });
});
