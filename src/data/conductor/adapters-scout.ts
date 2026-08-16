/**
 * Scout execution adapters (Conductor V3).
 *
 * Scout owns sourcing truth. These adapters cross exactly two existing Scout
 * service calls and nothing else:
 *
 *   - `scoutService.discover` — one sourcing pass for an approved brief.
 *   - `scoutService.feedback` — one calibration row for a human fit correction.
 *
 * Not adapted, deliberately: contacting a prospect (external, always a person
 * in Comms), changing the ICP (targeting truth a person owns), and the Comms
 * handoff (needs a named contact only Scout's board can assemble). Those stay
 * in the capability registry as unsupported, with the reason attached.
 */

import { scoutService } from "@/data/supabase/scout-service";
import type { RoomAdapter } from "@/domain/conductor-control";
import { adapterReceipt, requireText, roomVerdict } from "./adapter-kit";

/** Start one sourcing pass from an approved plain-English brief. */
export const scoutDiscoveryAdapter: RoomAdapter = {
  id: "adapter:scout.discovery",
  room: "scout",
  operations: ["scout.start_discovery_run"],
  boundary: "scoutService.discover — one sourcing pass against the active ICP",
  supports(operation) {
    return this.operations.includes(operation);
  },
  canRoute(action, access) {
    const refused = roomVerdict(this, action, access);
    if (refused) return refused;
    if (!requireText(action.payload, "brief")) {
      return {
        routable: false,
        because:
          "Scout can run a sourcing pass, but this action carries no approved brief. Write the brief in Scout.",
        refusal: "missing_input",
      };
    }
    return { routable: true, because: "Scout will run one sourcing pass against the active ICP." };
  },
  async prepare(action) {
    const brief = requireText(action.payload, "brief");
    if (!brief) return { ready: false, because: "An approved search brief is required." };
    const limit = Number(action.payload?.["limit"] ?? 0);
    return {
      ready: true,
      because: "Scout will source against this brief and save only what it can verify.",
      payload: { brief, ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}) },
    };
  },
  async route(action, context) {
    const prepared = await this.prepare(action, context);
    if (!prepared.ready) {
      return adapterReceipt({
        action,
        adapter: this,
        context,
        status: "refused",
        resultingState: "approved",
        failure: prepared.because,
      });
    }
    try {
      const outcome = await scoutService.discover({
        organizationId: context.organizationId,
        query: String(prepared.payload!["brief"]),
        ...(prepared.payload!["limit"] ? { limit: Number(prepared.payload!["limit"]) } : {}),
      });
      if (!outcome.runId) {
        return adapterReceipt({
          action,
          adapter: this,
          context,
          status: "failed",
          resultingState: "failed",
          failure: "Scout did not record a discovery run for this brief.",
        });
      }
      return adapterReceipt({
        action,
        adapter: this,
        context,
        status: "routed",
        resultingState: "routed",
        result: {
          reference: outcome.runId,
          label: `Scout ran one sourcing pass and saved ${outcome.saved} companies`,
        },
      });
    } catch (error) {
      return adapterReceipt({
        action,
        adapter: this,
        context,
        status: "failed",
        resultingState: "failed",
        failure: (error as Error).message,
      });
    }
  },
  async readStatus(action) {
    return action.status;
  },
};

/** Record a human fit correction as calibration. Never rewrites the ICP. */
export const scoutFeedbackAdapter: RoomAdapter = {
  id: "adapter:scout.feedback",
  room: "scout",
  operations: ["scout.record_fit_correction"],
  boundary: "scoutService.feedback — one calibration row, no ICP rewrite",
  supports(operation) {
    return this.operations.includes(operation);
  },
  canRoute(action, access) {
    const refused = roomVerdict(this, action, access);
    if (refused) return refused;
    if (!requireText(action.payload, "prospectId") || !requireText(action.payload, "humanFit")) {
      return {
        routable: false,
        because:
          "Scout can record a fit correction, but this action names no company and no human verdict.",
        refusal: "missing_input",
      };
    }
    return { routable: true, because: "Scout will record the correction as calibration." };
  },
  async prepare(action) {
    const prospectId = requireText(action.payload, "prospectId");
    const humanFit = requireText(action.payload, "humanFit");
    if (!prospectId || !humanFit) {
      return { ready: false, because: "A company reference and a human verdict are required." };
    }
    if (!["green", "yellow", "red", "neutral"].includes(humanFit)) {
      return { ready: false, because: `"${humanFit}" is not a fit verdict Scout understands.` };
    }
    return {
      ready: true,
      because: "Scout will store this as calibration for later runs.",
      payload: {
        prospectId,
        humanFit,
        ...(requireText(action.payload, "reason")
          ? { reason: requireText(action.payload, "reason")! }
          : {}),
      },
    };
  },
  async route(action, context) {
    const prepared = await this.prepare(action, context);
    if (!prepared.ready) {
      return adapterReceipt({
        action,
        adapter: this,
        context,
        status: "refused",
        resultingState: "approved",
        failure: prepared.because,
      });
    }
    try {
      await scoutService.feedback({
        organizationId: context.organizationId,
        userId: context.actor.id,
        prospectId: String(prepared.payload!["prospectId"]),
        decision: "fit_override",
        humanFit: prepared.payload!["humanFit"] as "green" | "yellow" | "red" | "neutral",
        ...(prepared.payload!["reason"] ? { reason: String(prepared.payload!["reason"]) } : {}),
      });
      return adapterReceipt({
        action,
        adapter: this,
        context,
        status: "routed",
        resultingState: "routed",
        result: {
          reference: String(prepared.payload!["prospectId"]),
          label: "Scout recorded the fit correction as calibration",
        },
      });
    } catch (error) {
      return adapterReceipt({
        action,
        adapter: this,
        context,
        status: "failed",
        resultingState: "failed",
        failure: (error as Error).message,
      });
    }
  },
  async readStatus(action) {
    return action.status;
  },
};

export const SCOUT_ADAPTERS: RoomAdapter[] = [scoutDiscoveryAdapter, scoutFeedbackAdapter];
