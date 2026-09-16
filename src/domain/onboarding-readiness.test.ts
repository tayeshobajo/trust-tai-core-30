import { describe, expect, it } from "vitest";

import type { AgreementRecord, PaymentRecord } from "./agreement-state";
import {
  CHECKLIST_ORDER,
  commercialPrerequisites,
  onboardingReadiness,
  openProjectsWorkspace,
  recordAccessNeed,
  type ChecklistItem,
  type ChecklistState,
} from "./onboarding-readiness";

const AT = "2026-03-10T09:00:00.000Z";

function checklist(overrides: Partial<Record<string, Partial<ChecklistItem>>> = {}): ChecklistState {
  return {
    clientRef: "fixture-client-01",
    items: CHECKLIST_ORDER.map((key) => ({
      key,
      met: true,
      detail: `${key} recorded`,
      ...(overrides[key] ?? {}),
    })) as ChecklistItem[],
  };
}

const accepted: AgreementRecord = {
  clientRef: "fixture-client-01",
  stage: "client_accepted",
  evidence: { kind: "human_attested", by: "person-1", at: AT, note: "Signed copy received" },
  changedBy: "person-1",
  changedAt: AT,
};

const invoiced: PaymentRecord = {
  clientRef: "fixture-client-01",
  stage: "invoiced",
  evidence: { kind: "reference", system: "Invoicing", reference: "INV-7", observedAt: AT },
  changedBy: "person-1",
  changedAt: AT,
};

describe("onboarding checklist", () => {
  it("covers scope, commercials, access, people, kickoff and the first milestone", () => {
    expect(CHECKLIST_ORDER).toEqual([
      "scope_confirmed",
      "commercial_prerequisites",
      "access_needs",
      "responsible_people",
      "kickoff",
      "first_milestone",
    ]);
  });

  it("records where a credential is kept, and refuses the credential itself", () => {
    const good = recordAccessNeed({
      store: "Team password manager",
      itemRef: "fixture/analytics-login",
      requestedBy: "person-1",
    });
    expect(good.accepted).toBe(true);

    const bad = recordAccessNeed({
      store: "Team password manager",
      itemRef: "fixture/analytics-login",
      requestedBy: "person-1",
      note: "password: hunter2",
    });
    expect(bad.accepted).toBe(false);
    expect(bad.accepted === false && bad.because).toContain("Do not put a credential here");
  });

  it("blocks when the client has not accepted", () => {
    const blocking = commercialPrerequisites({
      agreement: { ...accepted, stage: "sent" },
      payment: invoiced,
    });
    expect(blocking[0]).toContain("has not accepted");
  });

  it("does not treat an unreadable payment status as settled", () => {
    const blocking = commercialPrerequisites({
      agreement: accepted,
      payment: { ...invoiced, stage: "unknown" },
    });
    expect(blocking.join(" ")).toContain("could not be read");
  });

  it("shows a missing prerequisite as blocking", () => {
    const readiness = onboardingReadiness(checklist({ kickoff: { met: false } }));
    expect(readiness.ready).toBe(false);
    expect(readiness.blocking[0]).toContain("Kickoff is not met");
  });

  it("lets an owner pass an item with a written exception, and names it", () => {
    const readiness = onboardingReadiness(
      checklist({
        first_milestone: {
          met: false,
          exception: { by: "person-1", role: "owner", reason: "Agreed at kickoff instead", at: AT },
        },
      }),
    );
    expect(readiness.ready).toBe(true);
    expect(readiness.passedOnException[0]).toContain("Agreed at kickoff instead");
  });

  it("refuses an exception from someone who is not an owner or admin", () => {
    const readiness = onboardingReadiness(
      checklist({
        first_milestone: {
          met: false,
          exception: { by: "person-2", role: "member", reason: "Will sort later", at: AT },
        },
      }),
    );
    expect(readiness.ready).toBe(false);
  });
});

describe("opening the Projects workspace", () => {
  it("opens exactly one workspace and returns the first one after that", () => {
    const state = checklist();
    const readiness = onboardingReadiness(state);
    const first = openProjectsWorkspace({
      state,
      readiness,
      by: "person-1",
      at: AT,
      sources: ["fixture:roadmap/v1", "fixture:proposal/v1"],
    });
    if (!first.opened) throw new Error("expected open");
    expect(first.alreadyOpen).toBe(false);

    const second = openProjectsWorkspace({
      state,
      readiness,
      by: "person-1",
      at: "2026-03-11T09:00:00.000Z",
      sources: [],
      existing: [first.handoff],
    });
    expect(second.opened && second.alreadyOpen).toBe(true);
    expect(second.opened && second.handoff.key).toBe(first.handoff.key);
    expect(second.opened && second.handoff.sources).toEqual([
      "fixture:roadmap/v1",
      "fixture:proposal/v1",
    ]);
  });

  it("opens nothing while a prerequisite is in the way", () => {
    const state = checklist({ access_needs: { met: false } });
    const outcome = openProjectsWorkspace({
      state,
      readiness: onboardingReadiness(state),
      by: "person-1",
      at: AT,
      sources: [],
    });
    expect(outcome.opened).toBe(false);
    expect(outcome.opened === false && outcome.because.join(" ")).toContain("Access we need");
  });
});

describe("synthetic cases: accepted, declined, payment missing, scope change", () => {
  const sources = ["fixture:roadmap/v1"];

  it("accepted and invoiced: the workspace opens", () => {
    const state = checklist();
    expect(commercialPrerequisites({ agreement: accepted, payment: invoiced })).toEqual([]);
    const outcome = openProjectsWorkspace({
      state,
      readiness: onboardingReadiness(state),
      by: "person-1",
      at: AT,
      sources,
    });
    expect(outcome.opened).toBe(true);
  });

  it("declined: nothing opens and the reason is plain", () => {
    const declined: AgreementRecord = {
      ...accepted,
      stage: "declined",
      evidence: { kind: "human_attested", by: "person-1", at: AT, note: "Client went elsewhere" },
    };
    const blocking = commercialPrerequisites({ agreement: declined, payment: invoiced });
    const state = checklist({ commercial_prerequisites: { met: false, detail: blocking[0] ?? "" } });
    const outcome = openProjectsWorkspace({
      state,
      readiness: onboardingReadiness(state),
      by: "person-1",
      at: AT,
      sources,
    });
    expect(outcome.opened).toBe(false);
  });

  it("payment missing: the state stays unavailable and the start is blocked", () => {
    const blocking = commercialPrerequisites({
      agreement: accepted,
      payment: { ...invoiced, stage: "unknown", evidence: null },
    });
    expect(blocking.join(" ")).toContain("not treated as settled");
    const state = checklist({ commercial_prerequisites: { met: false, detail: blocking[0] ?? "" } });
    expect(onboardingReadiness(state).ready).toBe(false);
  });

  it("scope change: confirmed scope falls back to unmet and blocks the start again", () => {
    const state = checklist({ scope_confirmed: { met: false, detail: "Scope changed after acceptance" } });
    const readiness = onboardingReadiness(state);
    expect(readiness.ready).toBe(false);
    expect(readiness.blocking[0]).toContain("Confirmed scope");
    const outcome = openProjectsWorkspace({
      state,
      readiness,
      by: "person-1",
      at: AT,
      sources,
    });
    expect(outcome.opened).toBe(false);
  });
});
