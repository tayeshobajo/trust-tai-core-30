import { describe, expect, it, vi } from "vitest";
import { readStudioAudience, type AudienceDeps } from "./studio-audience.server";
import { describeCount, pageAudience, parseAudienceFeed } from "@/domain/studio-audience";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const sub = (i: number, status: string) => ({ email: `p${i}@x.test`, status, source: "site", confirmed_at: null, created_at: "2026-01-02T00:00:00Z", provider_sync_state: "synced" });

function deps(over: Partial<AudienceDeps> = {}, body: unknown = { subscribers: [sub(1, "confirmed")], counts: { pending: 0, confirmed: 1, unsubscribed: 0, total: 1 } }, status = 200) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  const d: AudienceDeps = {
    env: (n) => ({ STUDIO_AUDIENCE_TOKEN: "t", STUDIO_AUDIENCE_ORGANIZATION_ID: ORG } as Record<string, string>)[n],
    identify: async () => ({ userId: "u" }),
    membership: async () => ({ status: "active", role: "owner" }),
    fetch: fetch as unknown as typeof globalThis.fetch,
    now: () => new Date("2026-09-24T00:00:00Z"),
    ...over,
  };
  return { d, fetch };
}
const run = (d: AudienceDeps, organizationId = ORG, filter: "all" | "pending" = "all") =>
  readStudioAudience({ token: "tok", organizationId, filter, page: 1 }, d);

describe("studio audience authority (checked before fetch)", () => {
  it("denies signed-out", async () => { const { d, fetch } = deps({ identify: async () => null }); expect(await run(d)).toEqual({ ok: false, failure: "not_signed_in" }); expect(fetch).not.toHaveBeenCalled(); });
  it("denies non-active membership", async () => { const { d, fetch } = deps({ membership: async () => ({ status: "invited", role: "owner" }) }); expect(await run(d)).toEqual({ ok: false, failure: "not_member" }); expect(fetch).not.toHaveBeenCalled(); });
  it("denies view-only members", async () => { const { d, fetch } = deps({ membership: async () => ({ status: "active", role: "member" }) }); expect(await run(d)).toEqual({ ok: false, failure: "not_authorized" }); expect(fetch).not.toHaveBeenCalled(); });
  it("denies an owner of another workspace", async () => { const { d, fetch } = deps(); expect(await run(d, OTHER)).toEqual({ ok: false, failure: "wrong_workspace" }); expect(fetch).not.toHaveBeenCalled(); });
  it("fails closed when no workspace is bound", async () => { const { d, fetch } = deps({ env: (n) => (n === "STUDIO_AUDIENCE_TOKEN" ? "t" : undefined) }); expect(await run(d)).toEqual({ ok: false, failure: "not_configured" }); expect(fetch).not.toHaveBeenCalled(); });
  it("sends the token only as a header and passes the filter", async () => {
    const { d, fetch } = deps();
    await run(d, ORG, "pending");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://trusttai.com/api/public/newsletter/subscribers?status=pending");
    expect((init.headers as Record<string, string>)["x-studio-token"]).toBe("t");
  });
});

describe("upstream failures are never zero", () => {
  it.each([[401, "source_rejected"], [503, "source_unavailable"], [404, "source_not_published"], [500, "source_error"]])("%i", async (s, f) => {
    const { d } = deps({}, {}, s as number);
    expect(await run(d)).toEqual({ ok: false, failure: f });
  });
  it("bad shape", async () => { const { d } = deps({}, { nope: 1 }); expect(await run(d)).toEqual({ ok: false, failure: "source_shape" }); });
  it("network error", async () => { const { d } = deps({ fetch: (async () => { throw new Error("x"); }) as never }); expect(await run(d)).toEqual({ ok: false, failure: "source_error" }); });
});

describe("counts, filter and pagination", () => {
  it("caps are labelled as floors", () => {
    const feed = parseAudienceFeed({ subscribers: Array.from({ length: 1000 }, (_, i) => sub(i, "confirmed")), counts: { total: 1000, confirmed: 1000 } });
    expect(feed.likelyCapped).toBe(true);
    expect(describeCount(feed.counts.total, feed.scope, feed.likelyCapped)).toBe("1,000+");
    expect(describeCount(feed.counts.pending, feed.scope, feed.likelyCapped)).toBe("Unknown");
  });
  it("revised contract counts are exact", () => {
    const feed = parseAudienceFeed({ subscribers: Array.from({ length: 1000 }, (_, i) => sub(i, "pending")), counts: { total: 4200 }, counts_scope: "all" });
    expect(describeCount(feed.counts.total, feed.scope, feed.likelyCapped)).toBe("4,200");
  });
  it("pages count every matching row and filter", () => {
    const feed = parseAudienceFeed({ subscribers: [...Array.from({ length: 30 }, (_, i) => sub(i, "confirmed")), sub(99, "pending")], counts: {} });
    const p = pageAudience(feed.subscribers, "confirmed", 2);
    expect(p).toMatchObject({ matching: 30, pageCount: 2, page: 2 });
    expect(p.rows).toHaveLength(5);
    expect(pageAudience(feed.subscribers, "pending", 9).rows[0]!.email).toBe("p99@x.test");
  });
  it("bad timestamps become unknown", () => {
    expect(parseAudienceFeed({ subscribers: [{ ...sub(1, "x"), created_at: "nope" }] }).subscribers[0]).toMatchObject({ createdAt: null, status: "unknown" });
  });
});
