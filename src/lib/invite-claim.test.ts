import { afterEach, describe, expect, it, vi } from "vitest";

import { claimInvitation, isQuietClaimOutcome } from "@/lib/invite-claim";

const getSession = vi.fn();

vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: { auth: { getSession: () => getSession() } },
}));

function signedIn() {
  getSession.mockResolvedValue({ data: { session: { access_token: "token-abc" } } });
}

afterEach(() => {
  vi.restoreAllMocks();
  getSession.mockReset();
});

describe("claimInvitation", () => {
  it("refuses without a session and never calls the endpoint", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await claimInvitation("inv_1");

    expect(result).toMatchObject({ ok: false, outcome: "no_session" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends the invitation id when the link carried one", async () => {
    signedIn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, outcome: "accept", because: "In." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await claimInvitation("inv_1");

    expect(result.ok).toBe(true);
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ invitationId: "inv_1" });
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer token-abc");
  });

  it("claims by signed-in identity when the link carried no id", async () => {
    signedIn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, outcome: "accept", because: "In." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await claimInvitation();

    expect(result.ok).toBe(true);
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({});
  });

  it("carries the refusal through instead of inventing access", async () => {
    signedIn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, outcome: "wrong_account", because: "Different address." }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await claimInvitation("inv_1");

    expect(result).toEqual({
      ok: false,
      outcome: "wrong_account",
      because: "Different address.",
    });
  });

  it("fails closed when the request cannot be made", async () => {
    signedIn();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    const result = await claimInvitation();

    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("unknown");
  });
});

describe("isQuietClaimOutcome", () => {
  it("stays quiet when there is simply nothing waiting", () => {
    expect(isQuietClaimOutcome("unknown")).toBe(true);
    expect(isQuietClaimOutcome("no_session")).toBe(true);
    expect(isQuietClaimOutcome("wrong_account")).toBe(false);
  });
});
