import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), result: { data: [] as unknown[], error: null as unknown }, chain: {} as Record<string, any> }));
vi.mock("@/integrations/trust-tai/supabase", () => ({ supabase: { auth: { getUser: mocks.getUser }, from: mocks.from } }));
import { readOutreachToday, outreachKey } from "./outreach-today-live";
beforeEach(() => {
  vi.clearAllMocks(); mocks.result = {data:[],error:null};
  for (const method of ["select","eq","gte","lt","order"]) mocks.chain[method] = vi.fn(() => mocks.chain);
  mocks.chain["limit"] = vi.fn(async () => mocks.result);
  mocks.from.mockReturnValue(mocks.chain);
  mocks.getUser.mockResolvedValue({data:{user:{id:"user"}},error:null});
});
it("reads metadata only with organization, direction and Chicago interval filters", async () => {
  await readOutreachToday("org","user","2026-10-02");
  expect(mocks.chain["select"]).toHaveBeenCalledWith(expect.not.stringContaining("body"));
  expect(mocks.chain["eq"]).toHaveBeenCalledWith("organization_id","org");
  expect(mocks.chain["eq"]).toHaveBeenCalledWith("direction","outbound");
  expect(mocks.chain["gte"]).toHaveBeenCalledWith("occurred_at","2026-10-02T05:00:00.000Z");
  expect(mocks.getUser).toHaveBeenCalledTimes(2);
});
it("does not query when identity mismatches", async () => {
  mocks.getUser.mockResolvedValue({data:{user:{id:"other"}},error:null});
  await expect(readOutreachToday("org","user","2026-10-02")).rejects.toThrow();
  expect(mocks.from).not.toHaveBeenCalled();
});
it("rejects changed identity after read", async () => {
  mocks.getUser.mockResolvedValueOnce({data:{user:{id:"user"}},error:null}).mockResolvedValueOnce({data:{user:{id:"other"}},error:null});
  await expect(readOutreachToday("org","user","2026-10-02")).rejects.toThrow();
});
it("keeps read failures as errors", async () => {
  mocks.result.error = {message:"denied"};
  await expect(readOutreachToday("org","user","2026-10-02")).rejects.toThrow();
});
it("flags truncation and partitions caches", async () => {
  mocks.result.data = Array(201).fill(null);
  expect((await readOutreachToday("org","user","2026-10-02")).truncated).toBe(true);
  expect(outreachKey("org","user","2026-10-02")).not.toEqual(outreachKey("org","other","2026-10-02"));
});
