/**
 * Projects: take back an unanswered ask to Ops or Studio.
 *
 * A routed request is Projects' own ask, so withdrawing it is Projects' own
 * act. This adapter crosses exactly one boundary, `projectsService.withdrawRoute`
 *, and it never touches Ops or Studio: it cannot accept work for them, cannot
 * chase them, and cannot claim they were told anything. It records that this
 * house has stopped waiting, and from then on the ledger refuses acceptance.
 *
 * Fails closed. No route key, no reason, an already-accepted route or a route
 * belonging to another organization all refuse before anything is written.
 */

import { projectsService } from "@/data/supabase/projects-service";
import { adapterReceipt, requireText, roomVerdict } from "./adapter-kit";
import type { AdapterPreparation, RoomAdapter } from "@/domain/conductor-control";

export const projectsRouteAdapter: RoomAdapter = {
  id: "adapter:projects.route",
  room: "projects",
  operations: ["projects.withdraw_route"],
  boundary: "projectsService.withdrawRoute, withdraws this house's own request only",
  supports(operation) {
    return this.operations.includes(operation);
  },
  canRoute(action, access) {
    const refused = roomVerdict(this, action, access);
    if (refused) return refused;
    const routeKey = requireText(action.payload, "routeKey");
    const because = requireText(action.payload, "because");
    if (!routeKey || !because) {
      return {
        routable: false,
        because:
          "Projects can take an ask back, but this action names no routed request and no reason for withdrawing it.",
        refusal: "missing_input",
      };
    }
    return {
      routable: true,
      because: "Projects will withdraw its own ask. Ops and Studio are not changed.",
    };
  },
  async prepare(action): Promise<AdapterPreparation> {
    const routeKey = requireText(action.payload, "routeKey");
    const because = requireText(action.payload, "because");
    if (!routeKey || !because) {
      return {
        ready: false,
        because: "A routed request and a reason for taking it back are both required.",
      };
    }
    return {
      ready: true,
      because: "Projects will record the withdrawal against this request.",
      payload: { routeKey, because },
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
    const routeKey = String(prepared.payload!["routeKey"]);
    try {
      const ledger = await projectsService.routeLedger(context.organizationId);
      const entry = ledger.find((row) => row.key === routeKey);
      if (!entry) {
        return adapterReceipt({
          action,
          adapter: this,
          context,
          status: "refused",
          resultingState: "approved",
          failure: "That routed request is not in this organization's ledger.",
        });
      }
      if (entry.status === "accepted") {
        return adapterReceipt({
          action,
          adapter: this,
          context,
          status: "refused",
          resultingState: "approved",
          failure:
            "The receiving room has already accepted this. Talk to them rather than withdrawing it.",
        });
      }
      if (!context.access) {
        return adapterReceipt({
          action,
          adapter: this,
          context,
          status: "refused",
          resultingState: "approved",
          failure: "No access was carried with this routing, so Projects cannot verify authority.",
        });
      }
      await projectsService.withdrawRoute(
        entry,
        String(prepared.payload!["because"]),
        {
          organizationId: context.organizationId,
          userId: context.actor.id,
          ...(context.actor.label ? { userLabel: context.actor.label } : {}),
        },
        context.access,
      );
      return adapterReceipt({
        action,
        adapter: this,
        context,
        status: "routed",
        resultingState: "routed",
        result: { reference: entry.key, label: `Ask withdrawn on ${entry.projectName}` },
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
    /* The ledger owns what happens next; nothing is inferred here. */
    return action.status;
  },
};
