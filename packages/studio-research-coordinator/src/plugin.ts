import { definePlugin, type PluginApiRequestInput } from "@paperclipai/plugin-sdk";
import { COORDINATOR } from "../../../src/lib/studio-research-coordinator-contracts";
import type { createCoordinator } from "../../../src/lib/studio-research-coordinator.server";
type Coordinator = ReturnType<typeof createCoordinator>;
/** Binding and authority adapters are injected by reviewed server code, never configuration/body. */
export function makePlugin(
  coordinator?: Coordinator,
  binding?: (requestId: string) => Promise<{ issueId: string } | null>,
) {
  return definePlugin({
    async setup() {
      /* No subscriptions, schedules, tools, credentials or file creation. */
    },
    async onHealth() {
      return {
        status: "degraded",
        message: "Local candidate: live execution and authority adapters are not connected.",
      };
    },
    async onApiRequest(input: PluginApiRequestInput) {
      const headers = { "Cache-Control": "no-store" };
      try {
        if (
          input.companyId !== COORDINATOR.companyId ||
          input.actor.actorType !== "agent" ||
          input.actor.agentId !== COORDINATOR.agentId
        )
          return { status: 403, headers, body: { error: "not_authorized" } };
        if (!coordinator || !binding)
          return { status: 503, headers, body: { error: "coordinator_unavailable" } };
        const id = input.params["requestId"],
          issueId = input.params["issueId"];
        if (!id || !issueId || Object.keys(input.query).length)
          return { status: 400, headers, body: { error: "request_invalid" } };
        if ((await binding(id))?.issueId !== issueId)
          return { status: 403, headers, body: { error: "not_authorized" } };
        if (input.routeKey === "read" && input.method === "GET")
          return { status: 200, headers, body: await coordinator.read(input, id) };
        if (input.method !== "POST")
          return { status: 405, headers, body: { error: "method_not_allowed" } };
        if (input.routeKey === "review")
          return { status: 200, headers, body: await coordinator.review(input, id, input.body) };
        if (
          input.body !== null &&
          (typeof input.body !== "object" ||
            Array.isArray(input.body) ||
            Object.keys(input.body).length)
        )
          return { status: 400, headers, body: { error: "request_invalid" } };
        if (input.routeKey === "run")
          return { status: 200, headers, body: await coordinator.run(input, id) };
        if (input.routeKey === "cancel")
          return { status: 200, headers, body: await coordinator.cancel(input, id) };
        return { status: 404, headers, body: { error: "route_unavailable" } };
      } catch {
        return { status: 403, headers, body: { error: "request_rejected" } };
      }
    },
  });
}
