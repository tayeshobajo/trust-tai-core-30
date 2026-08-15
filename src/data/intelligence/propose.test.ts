/**
 * The action proposal workflow is a permission boundary, so it is tested as
 * one: bounded, reversible, routed to the owning room, and never available
 * without a person's explicit authorisation.
 */

import { describe, expect, it } from "vitest";

import { actionsForRead, proposeActions } from "./engine/propose";
import { MAX_ACTION_PROPOSALS, type Recommendation } from "@/domain/intelligence-engine";

function recommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: "rec:hyp:reply_debt",
    kind: "move",
    theme: "follow_through",
    headline: "Clear the replies you owe",
    rationale: "Two relationships are past a date a person set.",
    hypothesisRefs: ["hyp:reply_debt"],
    observationRefs: ["obs:reply_debt"],
    confidence: "high",
    effort: "small",
    expectedSignal: "No relationship is past a date recorded in Comms.",
    expectedSignalKind: "reply_debt",
    destination: { appId: "comms", label: "Open Comms", route: "/modules/comms" },
    sourceApps: ["comms", "steward"],
    patternKey: "engine:rec:hyp:reply_debt",
    order: 92,
    at: "2026-08-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("action proposals", () => {
  it("always requires human authorization", () => {
    for (const action of proposeActions(recommendation())) {
      expect(action.requiresApproval).toBe(true);
    }
  });

  it("only ever proposes reversible work", () => {
    const all = [
      "rec:hyp:idle_capacity",
      "rec:hyp:thin_pipeline",
      "rec:hyp:delivery_slipping",
      "rec:hyp:promises_slipping",
      "rec:hyp:reply_debt",
      "rec:hyp:client_drift",
      "rec:hyp:structural_friction",
      "rec:hyp:unworked_opportunity",
    ].flatMap((id) => proposeActions(recommendation({ id })));

    expect(all.length).toBeGreaterThan(0);
    for (const action of all) expect(action.reversible).toBe(true);
  });

  it("states what it will do and what it will not do", () => {
    for (const action of proposeActions(recommendation())) {
      expect(action.willDo.length).toBeGreaterThan(0);
      expect(action.willNotDo.length).toBeGreaterThan(0);
    }
  });

  it("routes to the room that owns the change, never to the engine", () => {
    const [action] = proposeActions(recommendation());
    expect(action?.appId).toBe("comms");
    expect(action?.route.startsWith("/modules/")).toBe(true);
    expect(action?.operation.startsWith("comms.")).toBe(true);
  });

  it("offers no action for a single-room hunch", () => {
    expect(proposeActions(recommendation({ confidence: "low" }))).toEqual([]);
    expect(proposeActions(recommendation({ confidence: "unknown" }))).toEqual([]);
  });

  it("offers no action for a recommendation with no known operation", () => {
    expect(proposeActions(recommendation({ id: "rec:hyp:inbound_pull" }))).toEqual([]);
  });

  it("never exceeds the cap per recommendation", () => {
    expect(proposeActions(recommendation()).length).toBeLessThanOrEqual(MAX_ACTION_PROPOSALS);
  });

  it("is deterministic and pure", () => {
    expect(proposeActions(recommendation())).toEqual(proposeActions(recommendation()));
  });

  it("keys actions by recommendation and omits recommendations with none", () => {
    const map = actionsForRead([
      recommendation(),
      recommendation({ id: "rec:hyp:inbound_pull" }),
      recommendation({ id: "rec:hyp:client_drift", confidence: "moderate" }),
    ]);
    expect(Object.keys(map).sort()).toEqual(["rec:hyp:client_drift", "rec:hyp:reply_debt"]);
  });

  it("carries the expected signal forward so the outcome can be read later", () => {
    const [action] = proposeActions(recommendation());
    expect(action?.payload["expectedSignal"]).toBe(
      "No relationship is past a date recorded in Comms.",
    );
    expect(action?.payload["patternKey"]).toBe("engine:rec:hyp:reply_debt");
  });
});
