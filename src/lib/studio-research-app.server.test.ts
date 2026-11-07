import { it, expect, vi, beforeEach } from "vitest";
import { makeStudioApplication } from "./studio-research-app.server";
import { createStudioManualAdapter } from "@/domain/studio-manual-wire";
import { COORDINATOR } from "./studio-research-coordinator-contracts";
const harness = vi.hoisted(() => ({
  request: new Request("https://preview.example/manual", { method: "POST" }),
  application: undefined as undefined | ((r: Request, x: unknown) => Promise<unknown>),
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: () => unknown) => handler,
    inputValidator: (parse: (v: unknown) => unknown) => ({
      handler:
        (handler: (x: { data: unknown }) => unknown) =>
        async ({ data }: { data: unknown }) =>
          handler({ data: parse(data) }),
    }),
  }),
}));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => harness.request }));
vi.mock("@/lib/studio-research-app.server", async (importOriginal) => {
  const m = await importOriginal<typeof import("./studio-research-app.server")>();
  return {
    ...m,
    studioManualApplication: (r: Request, x: unknown) =>
      harness.application ? harness.application(r, x) : m.studioManualApplication(r, x),
  };
});
import { studioManualAction } from "@/data/studio-manual.functions";
const id = "11111111-1111-4111-8111-111111111111",
  org = COORDINATOR.organizationId;
const command = {
  organizationId: org,
  requestId: id,
  topic: "Public example domains",
  approvedUrls: ["https://example.org/article"],
};
function setup() {
  let allowed = true,
    state = "approved",
    decision: string | undefined,
    accepted = false;
  const authorize = vi.fn(async () => {
    if (!allowed) throw Error("private auth error");
    return { user: { id: "user" } };
  });
  const research = {
    version: 1,
    requestId: id,
    topics: [],
    limitations: ["Synthetic boundary fixture"],
  };
  const issuer = {
    approve: vi.fn(async () => ({})),
    read: vi.fn(async () =>
      accepted
        ? { status: "review_ready", result: research, people: [], draft: null }
        : { status: "coordinator_waiting" },
    ),
  };
  const prepare = vi.fn(async () => ({ status: "prepared" }));
  const remote = vi.fn(
    async (
      _r: Request,
      c: { operation: string; requestId: string; review?: { decision: string } },
    ) => {
      if (c.operation === "run") {
        state = "ready";
        accepted = true;
      }
      if (c.operation === "review") {
        state = "reviewed";
        decision = c.review!.decision;
      }
      if (c.operation === "cancel") state = "cancelled";
      return { requestId: c.requestId, state, review: decision ? { decision } : null };
    },
  );
  harness.application = makeStudioApplication(
    { issuer, prepare, remote } as unknown as NonNullable<
      Parameters<typeof makeStudioApplication>[0]
    >,
    authorize as unknown as Parameters<typeof makeStudioApplication>[1],
  );
  const send = (
    data: Parameters<typeof createStudioManualAdapter>[1] extends (x: infer X) => unknown
      ? X
      : never,
  ) => studioManualAction({ data });
  return {
    adapter: createStudioManualAdapter(org, send),
    reload: () => createStudioManualAdapter(org, send),
    issuer,
    prepare,
    remote,
    authorize,
    deny: () => {
      allowed = false;
    },
    unaccept: () => {
      accepted = false;
    },
  };
}
beforeEach(() => {
  harness.application = undefined;
});
it("registered function through browser adapter maps queue/start/reload/review without leaking transport payloads", async () => {
  const f = setup();
  expect((await f.adapter.approve(command)).status).toBe("queued");
  expect((await f.adapter.start(id)).status).toBe("ready");
  expect((await f.reload().read(id)).brief!.research.requestId).toBe(id);
  expect((await f.adapter.review(id, "save")).decision).toBe("save");
  expect((await f.reload().read(id)).decision).toBe("save");
  expect(f.remote.mock.calls.every((x) => !JSON.stringify(x[1]).includes("Bearer"))).toBe(true);
});
it("missing configuration cannot activate from browser flags", async () => {
  const auth = vi.fn(async () => ({ user: { id: "user" } }));
  harness.application = makeStudioApplication(
    undefined,
    auth as unknown as Parameters<typeof makeStudioApplication>[1],
  );
  expect(await studioManualAction({ data: { operation: "check", organizationId: org } })).toEqual({
    status: "unavailable",
    reason: "runtime_not_configured",
  });
  await expect(
    studioManualAction({
      data: { operation: "check", organizationId: org, enabled: true } as never,
    }),
  ).rejects.toThrow();
});
it("registered boundary hides auth errors and makes no writes", async () => {
  const f = setup();
  f.deny();
  await expect(f.adapter.approve(command)).rejects.toThrow("request_unconfirmed");
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.remote).not.toHaveBeenCalled();
});
it("never treats remote ready or cancelled as durable acceptance or verified stop", async () => {
  const f = setup();
  await f.adapter.start(id);
  f.unaccept();
  expect((await f.adapter.read(id)).status).toBe("delivery_uncertain");
  const v = await f.adapter.cancel(id);
  expect(v.status).toBe("result_acceptance_blocked");
  expect(v.executionStop).toBe("unverified");
});
it("rejects organization mismatch before sending", async () => {
  const f = setup();
  await expect(f.adapter.approve({ ...command, organizationId: id })).rejects.toThrow();
  expect(f.authorize).not.toHaveBeenCalled();
});
