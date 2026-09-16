import { describe, expect, it } from "vitest";

import {
  canAdvance,
  canChangePath,
  handoffKey,
  idsSurvive,
  isHandoffComplete,
  itemReadiness,
  JOURNEY,
  nextStage,
  stageContract,
  validateHandoff,
  type JourneyHandoff,
} from "@/domain/agency-journey";
import {
  FIXTURE_ITEM,
  fixtureEvidence,
  fixtureHandoff,
  fixtureSubjectAt,
} from "@/data/fixtures/agency-journey-fixture";

describe("journey shape", () => {
  it("runs source to care with one ordinary path", () => {
    expect(JOURNEY.map((entry) => entry.stage)).toEqual([
      "source",
      "qualify",
      "discovery",
      "roadmap",
      "proposal",
      "agreement",
      "delivery",
      "care",
    ]);
    expect(nextStage("care")).toBeUndefined();
    expect(canAdvance("roadmap", "proposal")).toBe(true);
    expect(canAdvance("source", "delivery")).toBe(false);
  });

  it("allows lost, deferred and reopened, and nothing else", () => {
    expect(canChangePath("active", "lost")).toBe(true);
    expect(canChangePath("active", "deferred")).toBe(true);
    expect(canChangePath("lost", "reopened")).toBe(true);
    expect(canChangePath("deferred", "reopened")).toBe(true);
    expect(canChangePath("lost", "deferred")).toBe(false);
    expect(canChangePath("active", "active")).toBe(false);
  });

  it("names one owning room per stage", () => {
    expect(stageContract("delivery").owningApp).toBe("projects");
    expect(stageContract("agreement").owningApp).toBe("clients");
  });
});

describe("identity survival", () => {
  it("accepts added ids and refuses lost ones", () => {
    const before = fixtureSubjectAt("qualify");
    expect(idsSurvive(before, fixtureSubjectAt("discovery")).ok).toBe(true);

    const rewritten = { ...fixtureSubjectAt("discovery"), prospectId: "fixture-prospect-9999" };
    const read = idsSurvive(before, rewritten);
    expect(read.ok).toBe(false);
    expect(read.lost).toContain("prospectId");
  });

  it("refuses a changed source reference", () => {
    const before = fixtureSubjectAt("qualify");
    const after = { ...fixtureSubjectAt("discovery"), sourceRef: "fixture:other" };
    expect(idsSurvive(before, after).lost).toContain("sourceRef");
  });
});

describe("handoff keys", () => {
  it("is the same for a repeated attempt", () => {
    const one = fixtureHandoff("qualify", "discovery", { owningApp: "comms" });
    const two = fixtureHandoff("qualify", "discovery", {
      owningApp: "comms",
      receiptRef: "fixture://receipt/0002",
    });
    expect(handoffKey(one)).toBe(handoffKey(two));
  });

  it("differs per step and per company", () => {
    const a = fixtureHandoff("qualify", "discovery", { owningApp: "comms" });
    const b = fixtureHandoff("discovery", "roadmap", { owningApp: "roadmap" });
    expect(handoffKey(a)).not.toBe(handoffKey(b));

    const other = {
      ...a,
      subject: { ...a.subject, prospectId: "fixture-prospect-0002" },
    };
    expect(handoffKey(other)).not.toBe(handoffKey(a));
  });
});

describe("handoff validation", () => {
  const ready = (): JourneyHandoff =>
    fixtureHandoff("discovery", "roadmap", { owningApp: "roadmap" });

  it("accepts a confirmed handoff to the owning room", () => {
    const read = validateHandoff(ready());
    expect(read.ok).toBe(true);
    expect(read.progress).toBe("complete");
    expect(isHandoffComplete(ready())).toBe(true);
  });

  it("reports a prepared handoff as not complete", () => {
    const handoff: JourneyHandoff = { ...ready(), state: "prepared" };
    delete handoff.receiptRef;
    const read = validateHandoff(handoff);
    expect(read.ok).toBe(true);
    expect(read.progress).toBe("prepared, not written");
    expect(isHandoffComplete(handoff)).toBe(false);
  });

  it("refuses a confirmation with no receiving record", () => {
    const handoff: JourneyHandoff = { ...ready() };
    delete handoff.receiptRef;
    const read = validateHandoff(handoff);
    expect(read.ok).toBe(false);
    expect(read.because).toMatch(/has not returned a record/);
  });

  it("refuses a write by a room that does not own the stage", () => {
    const read = validateHandoff({ ...ready(), owningApp: "scout" });
    expect(read.blocking[0]).toMatch(/Only roadmap may write/);
  });

  it("refuses a handoff with no evidence and no company", () => {
    const { prospectId: _p, clientId: _c, ...subject } = ready().subject;
    const read = validateHandoff({ ...ready(), evidence: [], subject });
    expect(read.blocking).toContain("The handoff carries no company id.");
    expect(read.blocking).toContain("Nothing on record supports this handoff yet.");
  });

  it("requires a person for agreement and delivery", () => {
    const read = validateHandoff(
      fixtureHandoff("proposal", "agreement", { owningApp: "clients" }),
    );
    expect(read.ok).toBe(false);
    expect(read.because).toMatch(/needs a person to decide it/);

    const decided = validateHandoff(
      fixtureHandoff("proposal", "agreement", {
        owningApp: "clients",
        decidedBy: "fixture-user-0001",
        decidedAt: "2026-02-01T09:00:00.000Z",
      }),
    );
    expect(decided.ok).toBe(true);
  });

  it("refuses a due date with no authorised decision", () => {
    const read = validateHandoff({ ...ready(), dueAt: "2026-03-01T09:00:00.000Z" });
    expect(read.blocking).toContain("A due date can only come from an authorised decision.");
  });
});

describe("active items", () => {
  it("shows an unassigned owner rather than hiding it", () => {
    const read = itemReadiness(FIXTURE_ITEM);
    expect(read.ownerState).toBe("unassigned");
    expect(read.ownerLabel).toBe("Unassigned");
    expect(read.contractBreaks).toEqual([]);
  });

  it("flags an item with neither next action nor blocking reason", () => {
    const { nextAction: _n, ...item } = FIXTURE_ITEM;
    const read = itemReadiness(item);
    expect(read.contractBreaks).toContain("No next action and no blocking reason.");
    expect(read.nextAction).toBe("No next action recorded");
  });

  it("flags a due date nobody decided, and accepts a decided one", () => {
    const unauthorised = itemReadiness({ ...FIXTURE_ITEM, dueAt: "2026-04-01T09:00:00.000Z" });
    expect(unauthorised.contractBreaks).toContain(
      "This due date was not set by an authorised decision.",
    );

    const authorised = itemReadiness({
      ...FIXTURE_ITEM,
      dueAt: "2026-04-01T09:00:00.000Z",
      dueDecidedBy: "fixture-user-0001",
    });
    expect(authorised.contractBreaks).toEqual([]);
  });

  it("keeps a blocked item honest", () => {
    const { nextAction: _next, ...open } = FIXTURE_ITEM;
    const read = itemReadiness({
      ...open,
      blockedBecause: "Waiting on the synthetic contact to confirm scope.",
      evidence: [fixtureEvidence("Synthetic note")],
    });
    expect(read.blockedBecause).toMatch(/Waiting on/);
    expect(read.contractBreaks).toEqual([]);
  });
});
