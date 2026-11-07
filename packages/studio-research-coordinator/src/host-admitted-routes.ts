import { definePlugin, type PluginApiRequestInput } from "@paperclipai/plugin-sdk";
import { createHash } from "node:crypto";
import { z } from "zod";
import { COORDINATOR } from "../../../src/lib/studio-research-coordinator-contracts";
import {
  makeRouteHandler,
  ROUTES,
  type RouteEnvelope,
} from "../../../src/lib/studio-research-route-transport.server";
const admissionSchema = z
  .object({
    version: z.literal(1),
    admissionId: z.string().uuid(),
    pluginKey: z.literal("trusttai.studio-research-coordinator"),
    companyId: z.literal(COORDINATOR.companyId),
    projectId: z.literal(COORDINATOR.projectId),
    agentId: z.literal(COORDINATOR.agentId),
    requestId: z.string().uuid(),
    issueId: z.string().uuid(),
    operation: z.enum(["run", "read", "cancel", "review", "reconcile"]),
    bodyDigest: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.number().int().nonnegative(),
  })
  .strict();
export type HostAdmission = z.infer<typeof admissionSchema>;
type Dependencies = Omit<Parameters<typeof makeRouteHandler>[0], "receiver" | "authenticate">;
type HostExtension = { studioResearch?: { revalidate(context: HostAdmission): Promise<unknown> } };
/** New host extension, not part of stock 2026.1012.0 SDK. No default composition/activation. */
export function makeHostAdmittedRoutePlugin(d?: Dependencies) {
  let host: HostExtension["studioResearch"];
  return definePlugin({
    async setup(ctx) {
      host = (ctx as unknown as HostExtension).studioResearch;
    },
    async onHealth() {
      return { status: "degraded", message: "Local host-auth candidate; live runtime disabled." };
    },
    async onApiRequest(input: PluginApiRequestInput) {
      const headers = { "Cache-Control": "no-store" };
      if (!d || !host) return { status: 503, headers, body: { error: "runtime_unavailable" } };
      try {
        const a = admissionSchema.parse(
          (input as PluginApiRequestInput & { studioAdmission?: unknown }).studioAdmission,
        );
        const path = `/issues/${a.issueId}/research/${a.requestId}/${a.operation}`;
        if (
          input.companyId !== a.companyId ||
          input.method !== "POST" ||
          input.path !== path ||
          input.routeKey !== `signed-${a.operation}` ||
          input.params["issueId"] !== a.issueId ||
          input.params["requestId"] !== a.requestId ||
          Object.keys(input.query).length ||
          a.bodyDigest !== createHash("sha256").update(JSON.stringify(input.body)).digest("hex")
        )
          throw Error("binding_invalid");
        const current = async (e: RouteEnvelope) => {
          if (
            e.sender !== "studio" ||
            e.requestId !== a.requestId ||
            e.issueId !== a.issueId ||
            e.operation !== a.operation ||
            e.companyId !== a.companyId ||
            e.projectId !== a.projectId ||
            e.agentId !== a.agentId ||
            a.expiresAt <= d.now() ||
            a.expiresAt - d.now() > 60000
          )
            throw Error("binding_invalid");
          const returned = admissionSchema.parse(await host!.revalidate(a));
          if (JSON.stringify(returned) !== JSON.stringify(a) || a.expiresAt <= d.now())
            throw Error("host_revalidation_failed");
        };
        const handler = makeRouteHandler({
          ...d,
          receiver: "coordinator",
          authenticate: async (_r, e) => current(e),
          authorizeCurrent: async (e) => {
            // Check original key after the remote Studio access check, including after nonce claim.
            await d.authorizeCurrent(e);
            await current(e);
          },
        });
        const response = await handler(
          new Request(ROUTES.paperclip + path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input.body),
          }),
        );
        return { status: response.status, headers, body: await response.json() };
      } catch {
        return { status: 403, headers, body: { error: "route_rejected" } };
      }
    },
  });
}
