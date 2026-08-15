import { describe, expect, it } from "vitest";

import { accessContext } from "./access";
import { canAuthorizeAction } from "./action-authority";

const proposal = (appId: string, operation: string) => ({ appId, operation });

function access(role: string, active = true) {
  return accessContext({ userId: "u1", organizationId: "o1", role, active });
}

describe("who may authorise a bounded action", () => {
  it("refuses when nobody is looking", () => {
    expect(canAuthorizeAction(null, proposal("comms", "comms.draft_reply")).allowed).toBe(false);
  });

  it("refuses an inactive membership", () => {
    expect(
      canAuthorizeAction(access("owner", false), proposal("comms", "comms.draft_reply")).allowed,
    ).toBe(false);
  });

  it("lets a viewer see but never approve", () => {
    expect(
      canAuthorizeAction(access("viewer"), proposal("scout", "scout.route_to_comms")).allowed,
    ).toBe(false);
  });

  it("lets client support approve Comms but not Scout", () => {
    const support = access("client_support");
    expect(canAuthorizeAction(support, proposal("comms", "comms.draft_reply")).allowed).toBe(true);
    expect(canAuthorizeAction(support, proposal("scout", "scout.route_to_comms")).allowed).toBe(
      false,
    );
  });

  it("treats sequencing build order as a leadership decision", () => {
    const step = proposal("roadmap", "roadmap.sequence_capability");
    expect(canAuthorizeAction(access("member"), step).allowed).toBe(false);
    expect(canAuthorizeAction(access("leadership"), step).allowed).toBe(true);
    expect(canAuthorizeAction(access("owner"), step).allowed).toBe(true);
  });

  it("fails closed for an unmapped room", () => {
    expect(canAuthorizeAction(access("member"), proposal("atlas", "atlas.do")).allowed).toBe(false);
    expect(canAuthorizeAction(access("admin"), proposal("atlas", "atlas.do")).allowed).toBe(true);
  });

  it("always explains itself", () => {
    expect(
      canAuthorizeAction(access("viewer"), proposal("projects", "projects.record_blocker")).because
        .length,
    ).toBeGreaterThan(0);
  });
});
