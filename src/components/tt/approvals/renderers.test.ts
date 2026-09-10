/**
 * The registry is the room's guarantee of coherence.
 *
 * Every approval type must have a reviewer and a way home. If a type is added
 * without either, this fails rather than shipping a screen that shows nothing
 * or a decision that goes nowhere.
 */

import { describe, expect, it } from "vitest";

import { APPROVAL_TYPE_LABEL, type ApprovalType } from "@/domain/approvals";
import { registeredDownstreamTypes } from "@/data/approvals/downstream";
import { registeredRendererTypes } from "./renderers";

const DECLARED = Object.keys(APPROVAL_TYPE_LABEL) as ApprovalType[];

describe("the renderer registry", () => {
  it("has a reviewer for every declared approval type", () => {
    expect(registeredRendererTypes().sort()).toEqual(DECLARED.sort());
  });

  it("has a downstream path for every declared approval type", () => {
    expect(registeredDownstreamTypes().sort()).toEqual(DECLARED.sort());
  });
});
