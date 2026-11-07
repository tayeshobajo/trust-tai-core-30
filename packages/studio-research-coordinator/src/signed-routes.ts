import { definePlugin, type PluginApiRequestInput } from "@paperclipai/plugin-sdk";
import { COORDINATOR } from "../../../src/lib/studio-research-coordinator-contracts";
import { ROUTES } from "../../../src/lib/studio-research-route-transport.server";
/** SDK actor company is an additional check, never scoped bridge proof. Handler must verify bridge + signed route + current authority. */
export function makeSignedRoutePlugin(handler?: (request: Request) => Promise<Response>) {
  return definePlugin({
    async setup() {},
    async onHealth() {
      return {
        status: "degraded",
        message: "Offline integration candidate; production runtime disabled.",
      };
    },
    async onApiRequest(input: PluginApiRequestInput) {
      const headers = { "Cache-Control": "no-store" };
      if (!handler) return { status: 503, headers, body: { error: "runtime_unavailable" } };
      if (
        input.companyId !== COORDINATOR.companyId ||
        input.method !== "POST" ||
        Object.keys(input.query).length
      )
        return { status: 403, headers, body: { error: "route_rejected" } };
      const operation = input.routeKey.replace(/^signed-/, "");
      if (
        !["run", "read", "cancel", "review", "reconcile"].includes(operation) ||
        input.routeKey !== `signed-${operation}`
      )
        return { status: 404, headers, body: { error: "route_unavailable" } };
      const id = input.params["requestId"],
        issue = input.params["issueId"];
      if (!id || !issue || !/^\w[\w-]{35}$/.test(id) || !/^\w[\w-]{35}$/.test(issue))
        return { status: 400, headers, body: { error: "binding_invalid" } };
      const auth = input.headers["authorization"] ?? input.headers["Authorization"];
      if (!auth) return { status: 403, headers, body: { error: "scoped_auth_not_forwarded" } };
      const request = new Request(
        `${ROUTES.paperclip}/issues/${issue}/research/${id}/${operation}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: auth },
          body: JSON.stringify(input.body),
        },
      );
      const result = await handler(request);
      return { status: result.status, headers, body: await result.json() };
    },
  });
}
