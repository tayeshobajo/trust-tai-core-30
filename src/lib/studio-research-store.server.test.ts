import { expect, it, vi } from "vitest";
import { createResearchStore } from "./studio-research-store.server";
const org = "11111111-1111-4111-8111-111111111111",
  requestId = "22222222-2222-4222-8222-222222222222",
  id = "33333333-3333-4333-8333-333333333333";
const company = "44444444-4444-4444-8444-444444444444",
  agent = "55555555-5555-4555-8555-555555555555";
const input = { organizationId: org, requestId, topic: "Public source topic" };
function fixture() {
  let row: any = null;
  const calls: any[] = [];
  const fetcher = vi.fn(async (url: any, init: any) => {
    calls.push({ url, init });
    const query = new URL(url).searchParams;
    if (init.method === "POST") {
      if (row) return new Response("duplicate", { status: 409 });
      row = {
        id,
        ...JSON.parse(init.body),
        state: "dispatching",
        issue_id: null,
        result: null,
        result_comment_id: null,
      };
      return Response.json([row]);
    }
    if (
      query.get("organization_id") !== `eq.${org}` ||
      query.get("request_id") !== `eq.${requestId}`
    )
      return Response.json([]);
    if (init.method === "PATCH") {
      if (query.get("state") !== `eq.${row.state}`) return Response.json([]);
      row = { ...row, ...JSON.parse(init.body) };
      return Response.json([row]);
    }
    return Response.json(row ? [row] : []);
  });
  return { fetcher, calls };
}
it("concurrent reservations yield one owner and replay keeps the durable claim", async () => {
  const f = fixture();
  const store = createResearchStore(id, "fixture", f.fetcher);
  const results = await Promise.all([
    store.reserve(input, company, agent),
    store.reserve(input, company, agent),
  ]);
  expect(results.map((r) => r.kind).sort()).toEqual(["claimed", "existing"]);
  expect((await store.reserve({ ...input, topic: "Different topic" }, company, agent)).kind).toBe(
    "conflict",
  );
});
it("org-scoped CAS cannot attach a second issue or reclaim an uncertain dispatch", async () => {
  const f = fixture(),
    store = createResearchStore(id, "fixture", f.fetcher);
  const result = await store.reserve(input, company, agent);
  if (result.kind !== "claimed") throw Error();
  await store.markUncertain(result.run);
  await expect(store.attachIssue(result.run, id)).rejects.toThrow();
  expect((await store.reserve(input, company, agent)).kind).toBe("existing");
  expect(await store.readRun(company, requestId)).toBeNull();
});
it("storage failure is not interpreted as a new claim and POST is never retried", async () => {
  const fetcher = vi.fn(async () => {
    throw Error("lost response");
  });
  const store = createResearchStore(id, "fixture", fetcher);
  await expect(store.reserve(input, company, agent)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("opaque service key is sent only as apikey to the fixed backend", async () => {
  const f = fixture();
  await createResearchStore(id, "sb_secret_fixture", f.fetcher).reserve(input, company, agent);
  expect(f.calls[0].url).toMatch(
    /^https:\/\/okydosoacqdnursmmenf.supabase.co\/rest\/v1\/studio_research_requests/,
  );
  expect(f.calls[0].init.headers.Authorization).toBeUndefined();
  expect(f.calls[0].init.redirect).toBe("manual");
});

it("rejects all same-origin and cross-origin redirects without reading headers or retrying", async () => {
  for (const target of [
    "https://okydosoacqdnursmmenf.supabase.co/other",
    "https://example.invalid/other",
  ]) {
    for (let status = 300; status <= 399; status++) {
      const fetcher = vi.fn(async (_url: any, init: any) => {
        expect(init.redirect).toBe("manual");
        const response = new Response(null, { status, headers: { Location: target } });
        return new Proxy(response, {
          get(value, prop) {
            if (prop === "headers" || prop === "body" || prop === "ok")
              throw Error("Must not inspect redirect");
            return Reflect.get(value, prop, value);
          },
        });
      });
      const store = createResearchStore(id, "fixture", fetcher);
      await expect(store.list(org)).rejects.toThrow("Research storage redirect rejected.");
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  }
});
it("does not retry a redirected storage write", async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 307 }));
  await expect(
    createResearchStore(id, "fixture", fetcher).reserve(input, company, agent),
  ).rejects.toThrow("Research storage redirect rejected.");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
