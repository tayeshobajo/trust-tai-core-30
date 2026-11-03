import { afterEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/integrations/trust-tai/supabase", () => ({ supabase: { auth } }));
import { canonicalEvidenceReader } from "./roadmap-evidence-read";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
const session = (id: string) => ({
  data: { session: { user: { id }, access_token: "test-session" } },
  error: null,
});
const body = {
  canonical: { id: "r", organization_id: "o", status: "draft", updated_at: "2026-10-20T12:00:00Z" },
  evidence: {
    state: "privacy_integration_pending",
    coverage: "unknown",
    sentCount: null,
    interactions: null,
    mailboxSources: null,
  },
};
it("uses existing session and no-store then verifies identity before returning", async () => {
  auth.getSession.mockResolvedValue(session("u"));
  const fetcher = vi.fn().mockResolvedValue(Response.json(body));
  vi.stubGlobal("fetch", fetcher);
  expect(await canonicalEvidenceReader("u")("o", "r")).toEqual(body);
  expect(fetcher.mock.calls[0]?.[1]).toEqual({
    headers: { Authorization: "Bearer test-session" },
    cache: "no-store",
  });
});
it("discards a response after account switching", async () => {
  auth.getSession.mockResolvedValueOnce(session("u")).mockResolvedValueOnce(session("other"));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
  await expect(canonicalEvidenceReader("u")("o", "r")).rejects.toThrow("Session changed");
});
it("rejects mismatched organization and never accepts returned mailbox content", async () => {
  auth.getSession.mockResolvedValue(session("u"));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
  await expect(canonicalEvidenceReader("u")("other-org", "r")).rejects.toThrow("identity mismatch");
});
