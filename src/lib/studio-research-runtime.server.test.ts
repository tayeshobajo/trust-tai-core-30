import { beforeEach, afterEach, it, expect, vi } from "vitest";
const f = vi.hoisted(() => ({
  allow: true,
  slug: "trust-tai",
  status: "paused",
  readAgent: vi.fn(),
  createIssue: vi.fn(),
  reserve: vi.fn(),
}));
vi.mock("./studio-research-access.server", () => ({
  authorizeStudioResearch: async () => {
    if (!f.allow) throw Error("no access");
    const q: any = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: { slug: f.slug }, error: null }),
    };
    return { user: { id: "user" }, client: { from: () => q } };
  },
}));
vi.mock("./studio-research-transport.server.mjs", () => ({
  createStudioTransport: () => ({
    readAgent: f.readAgent,
    createIssue: f.createIssue,
    readIssue: vi.fn(),
  }),
}));
vi.mock("./studio-research-store.server", () => ({
  createResearchStore: () => ({ reserve: f.reserve }),
}));
import {
  researchConnection,
  researchAction,
  studioBinding,
} from "./studio-research-runtime.server";
const req = new Request("https://preview.test/");
const org = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.clearAllMocks();
  f.allow = true;
  f.slug = "trust-tai";
  f.status = "paused";
  vi.stubEnv("PAPERCLIP_STUDIO_BRIDGE_KEY", "fixture");
  vi.stubEnv("PAPERCLIP_STUDIO_ORGANIZATION_ID", org);
  vi.stubEnv("PAPERCLIP_STUDIO_RESEARCH_ENABLED", "false");
  f.readAgent.mockImplementation(async () => ({
    id: studioBinding.agentId,
    companyId: studioBinding.companyId,
    status: f.status,
  }));
});
afterEach(() => vi.unstubAllEnvs());
it("does not contact Paperclip before authorization", async () => {
  f.allow = false;
  await expect(researchConnection(req, org)).rejects.toThrow();
  expect(f.readAgent).not.toHaveBeenCalled();
});
it("rejects an unbound workspace before touching the credential transport", async () => {
  f.slug = "other";
  await expect(researchConnection(req, org)).rejects.toThrow();
  expect(f.readAgent).not.toHaveBeenCalled();
});
it("verifies identity without waking a paused worker", async () => {
  expect(await researchConnection(req, org)).toEqual({
    status: "verified",
    agentStatus: "paused",
    dispatchEnabled: false,
  });
  expect(f.createIssue).not.toHaveBeenCalled();
});
it("fails closed when key is missing", async () => {
  vi.stubEnv("PAPERCLIP_STUDIO_BRIDGE_KEY", "");
  expect(await researchConnection(req, org)).toEqual({ status: "secret_missing" });
  expect(f.readAgent).not.toHaveBeenCalled();
});
it("never returns transport error details", async () => {
  f.readAgent.mockRejectedValue(Error("sensitive upstream response"));
  expect(await researchConnection(req, org)).toEqual({ status: "identity_unverified" });
});
it("disabled dispatch performs no agent request or durable claim", async () => {
  expect(
    await researchAction(
      req,
      { organizationId: org, requestId: org, topic: "Public topic" },
      "start",
    ),
  ).toEqual({ status: "blocked", reason: "not_configured" });
  expect(f.readAgent).not.toHaveBeenCalled();
  expect(f.reserve).not.toHaveBeenCalled();
});
it("paused agent refuses dispatch even if server gate is enabled", async () => {
  vi.stubEnv("PAPERCLIP_STUDIO_RESEARCH_ENABLED", "true");
  expect(
    await researchAction(
      req,
      { organizationId: org, requestId: org, topic: "Public topic" },
      "start",
    ),
  ).toEqual({ status: "blocked", reason: "agent_unavailable" });
  expect(f.reserve).not.toHaveBeenCalled();
  expect(f.createIssue).not.toHaveBeenCalled();
});

it("requires explicit exact organization binding", async () => {
  vi.stubEnv("PAPERCLIP_STUDIO_ORGANIZATION_ID", "");
  await expect(researchConnection(req, org)).rejects.toThrow();
  expect(f.readAgent).not.toHaveBeenCalled();
});

it.each([
  ["", "binding_missing"],
  ["22222222-2222-4222-8222-222222222222", "binding_mismatch"],
])("categorizes binding failures without exposing IDs: %s", async (binding, category) => {
  vi.stubEnv("PAPERCLIP_STUDIO_ORGANIZATION_ID", binding);
  await expect(researchConnection(req, org)).rejects.toMatchObject({ category });
  expect(f.readAgent).not.toHaveBeenCalled();
  expect(f.reserve).not.toHaveBeenCalled();
});
it("categorizes workspace and unexpected access failures without upstream details", async () => {
  f.slug = "other";
  await expect(researchConnection(req, org)).rejects.toMatchObject({
    category: "workspace_mismatch",
  });
  f.allow = false;
  await expect(researchConnection(req, org)).rejects.toMatchObject({
    category: "access_check_failed",
  });
  expect(f.readAgent).not.toHaveBeenCalled();
});
