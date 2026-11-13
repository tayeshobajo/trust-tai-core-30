import { STUDIO_TRIAL_REQUEST_ID, STUDIO_TRIAL_SOURCE } from "@/domain/studio-research-trial";
import { TRIAL_POLICY_SHA256 } from "./studio-research-trial.server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { LINUX_PREVIEW_POLICY_SHA256, COORDINATOR } from "./studio-research-coordinator-contracts";
import { ROUTES } from "./studio-research-route-transport.server";

const h = vi.hoisted(() => ({
  request: undefined as Request | undefined,
  application: vi.fn(),
  receiptHandler: vi.fn(),
  assemble: vi.fn(),
}));
vi.mock("./studio-research-studio-assembly.server", () => ({
  assembleLinuxPreviewStudio: h.assemble,
}));
vi.mock("./studio-research-preview-startup.server", async (original) => {
  const m = await original<typeof import("./studio-research-preview-startup.server")>();
  return { ...m, loadStudioPreviewAssembly: vi.fn(m.loadStudioPreviewAssembly) };
});
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: () => unknown) => handler,
    inputValidator: (parse: (x: unknown) => unknown) => ({
      handler:
        (fn: (x: { data: unknown }) => unknown) =>
        ({ data }: { data: unknown }) =>
          fn({ data: parse(data) }),
    }),
  }),
}));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => h.request, setResponseHeader: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
import { loadStudioPreviewAssembly } from "./studio-research-preview-startup.server";
import { studioManualApplication, studioReceiptApplication } from "./studio-research-app.server";
import { studioManualAction, studioManualOriginDiagnostic } from "@/data/studio-manual.functions";
import { Route } from "@/routes/api.studio.research.coordinator.$requestId.$operation";

const production = new URL(ROUTES.studio).origin;
const rejectedPreview = "https://id-preview--65944e34-ede5-4757-befb-870e1ff97444.lovable.app";
const input = { organizationId: COORDINATOR.organizationId, operation: "check" };
const callbackPath =
  "/api/studio/research/coordinator/11111111-1111-4111-8111-111111111111/authority";
const pair = generateKeyPairSync("ed25519");
const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
beforeEach(() => {
  vi.clearAllMocks();
  // Complete, syntactically valid runtime config must never override deployment rejection.
  vi.stubEnv(
    "STUDIO_RESEARCH_PREVIEW_CONFIG",
    JSON.stringify({
      version: 2,
      mode: "linux-public-preview",
      enabled: true,
      policyDigest: LINUX_PREVIEW_POLICY_SHA256,
      trial: {policyDigest: TRIAL_POLICY_SHA256, requestId: STUDIO_TRIAL_REQUEST_ID, subjectId: "11111111-1111-4111-8111-111111111111", source: STUDIO_TRIAL_SOURCE, notBefore: 0, expiresAt: 3600000},
      coordinatorPublicKeyPem: publicPem,
    }),
  );
  vi.stubEnv("STUDIO_RESEARCH_SIGNING_PRIVATE_KEY", privatePem);
  vi.stubEnv("TRUST_TAI_SUPABASE_SERVICE_KEY", "synthetic-service-key");
  vi.stubEnv("PAPERCLIP_STUDIO_BRIDGE_KEY", "pcp_synthetic");
  h.application.mockResolvedValue({ status: "available" });
  h.receiptHandler.mockImplementation(async () => new Response("synthetic-handler"));
  h.assemble.mockReturnValue({ application: h.application, receiptHandler: h.receiptHandler });
});
afterEach(() => vi.unstubAllEnvs());

it.each([
  rejectedPreview,
  "https://trusttai-os-foundation.lovable.app",
  "https://preview--trusttai-os-foundation.lovable.app",
  "https://other.lovable.app",
  `${production}.attacker.example`,
  production.replace("https:", "http:"),
  `${production}:444`,
  `${production}.`,
  "http://localhost:3000",
])(
  "rejects both real entrypoints at %s before assembly despite complete secrets and forged headers",
  async (origin) => {
    const headers = {
      Origin: production,
      Host: new URL(production).host,
      "X-Forwarded-Host": new URL(production).host,
      "X-Forwarded-Proto": "https",
      Forwarded: `proto=https;host=${new URL(production).host}`,
    };
    const manual = new Request(`${origin}/_serverFn/manual`, { method: "POST", headers });
    const callback = new Request(origin + callbackPath, { method: "POST", headers });
    expect(await studioManualApplication(manual, input)).toEqual({
      status: "unavailable",
      reason: "runtime_not_configured",
    });
    const result = await studioReceiptApplication(callback);
    expect(result.status).toBe(503);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(await result.json()).toEqual({ error: "runtime_unavailable" });
    expect(loadStudioPreviewAssembly).not.toHaveBeenCalled();
    expect(h.assemble).not.toHaveBeenCalled();
    expect(h.application).not.toHaveBeenCalled();
    expect(h.receiptHandler).not.toHaveBeenCalled();
  },
);
it.each([
  "/relative",
  "not a URL",
  `${production}/manual#fragment`,
  `${production.replace("https://", "https://user:pass@")}/manual`,
])("fails closed for malformed or noncanonical input %s", async (url) => {
  // Structural Request doubles exercise parser rejection, including URLs native Request disallows.
  const request = { url } as Request;
  expect((await studioManualApplication(request, input)).status).toBe("unavailable");
  expect((await studioReceiptApplication(request)).status).toBe(503);
  expect(loadStudioPreviewAssembly).not.toHaveBeenCalled();
});
it("passes the original canonical production requests to existing authenticated/signed handlers", async () => {
  const manual = new Request(`${production}:443/_serverFn/manual`, {
    method: "POST",
    headers: { Origin: rejectedPreview, "X-Forwarded-Host": new URL(rejectedPreview).host },
  });
  const callback = new Request(production + callbackPath, { method: "POST" });
  expect(await studioManualApplication(manual, input)).toEqual({ status: "available" });
  expect(await (await studioReceiptApplication(callback)).text()).toBe("synthetic-handler");
  expect(loadStudioPreviewAssembly).toHaveBeenCalledTimes(2);
  expect(h.assemble).toHaveBeenCalledTimes(2);
  expect(h.application).toHaveBeenCalledWith(manual, input);
  expect(h.receiptHandler).toHaveBeenCalledWith(callback);
});
it("registered server function and callback route reach the guard", async () => {
  h.request = new Request(`${rejectedPreview}/_serverFn/manual`, { method: "POST" });
  expect(await studioManualAction({ data: input as never })).toEqual({
    status: "unavailable",
    reason: "runtime_not_configured",
  });
  const route = Route as unknown as {
    options: { server: { handlers: { POST: (x: { request: Request }) => Promise<Response> } } };
  };
  expect((await route.options.server.handlers.POST({ request: h.request })).status).toBe(503);
  expect(loadStudioPreviewAssembly).not.toHaveBeenCalled();
});

it("installed TanStack request storage preserves canonical URL despite forwarding headers", async () => {
  const { requestHandler, getRequest } = await import("@tanstack/start-server-core");
  const handler = requestHandler(async (incoming) => {
    const stored = getRequest();
    expect(stored).toBe(incoming);
    return Response.json(await studioManualApplication(stored, input));
  });
  const request = new Request(`${rejectedPreview}/_serverFn/manual`, {
    method: "POST",
    headers: {
      Host: new URL(production).host,
      Origin: production,
      "X-Forwarded-Host": new URL(production).host,
      "X-Forwarded-Proto": "https",
      Forwarded: `proto=https;host=${new URL(production).host}`,
    },
  });
  const response = await handler(request, {});
  expect(await response.json()).toEqual({
    status: "unavailable",
    reason: "runtime_not_configured",
  });
  expect(loadStudioPreviewAssembly).not.toHaveBeenCalled();
});

it.each([
  [rejectedPreview, "preview"],
  [production, "production"],
  ["https://other.lovable.app", "other"],
])("both inert diagnostic entrypoints classify %s without loading runtime", async (origin, classification) => {
  const { setResponseHeader } = await import("@tanstack/react-start/server");
  const route = Route as unknown as {
    options: { server: { handlers: { GET: (x: { request: Request }) => Response } } };
  };
  for (const headers of [{}, {
    Origin: production,
    Host: new URL(production).host,
    "X-Forwarded-Host": "cmd.trusttai.com",
    "X-Forwarded-Proto": "http",
    Forwarded: "proto=http;host=cmd.trusttai.com",
  }]) {
    h.request = new Request(origin + callbackPath, { headers });
    const expected = { build: "studio-preview-origin-check-v1", origin: classification };
    expect(await studioManualOriginDiagnostic()).toEqual(expected);
    expect(setResponseHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    const response = route.options.server.handlers.GET({ request: h.request });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(expected);
    expect(h.request.bodyUsed).toBe(false);
  }
  expect(loadStudioPreviewAssembly).not.toHaveBeenCalled();
  expect(h.assemble).not.toHaveBeenCalled();
  expect(h.application).not.toHaveBeenCalled();
  expect(h.receiptHandler).not.toHaveBeenCalled();
});

it("production without configuration or caller credentials stays closed at real entrypoints", async () => {
  vi.stubEnv("STUDIO_RESEARCH_PREVIEW_CONFIG", "");
  vi.stubEnv("STUDIO_RESEARCH_SIGNING_PRIVATE_KEY", "");
  vi.stubEnv("TRUST_TAI_SUPABASE_SERVICE_KEY", "");
  vi.stubEnv("PAPERCLIP_STUDIO_BRIDGE_KEY", "");
  h.request = new Request(`${production}/_serverFn/manual`, { method: "POST" });
  await expect(studioManualApplication(h.request, input)).rejects.toMatchObject({ status: 401 });
  expect(await studioManualAction({ data: input as never })).toEqual({
    status: "unavailable", reason: "request_unconfirmed",
  });
  const route = Route as unknown as {
    options: { server: { handlers: { POST: (x: { request: Request }) => Promise<Response> } } };
  };
  const response = await route.options.server.handlers.POST({
    request: new Request(production + callbackPath, { method: "POST", body: "{}" }),
  });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "runtime_unavailable" });
  expect(h.assemble).not.toHaveBeenCalled();
  expect(h.application).not.toHaveBeenCalled();
  expect(h.receiptHandler).not.toHaveBeenCalled();
});
