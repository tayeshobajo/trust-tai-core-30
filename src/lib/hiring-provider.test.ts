import { describe, it, expect, vi } from "vitest";
import { sendHiringQA } from "./hiring-provider.server";
const input = {
  base: "https://provider.invalid",
  headers: {},
  id: "ledger",
  revision: 2,
  recipient: "delivered@resend.dev",
  subject: "QA",
  body: "Synthetic",
};
describe("Hiring provider boundaries", () => {
  it("never calls provider for real applicants", async () => {
    const f = vi.fn();
    expect((await sendHiringQA({ ...input, recipient: "person@example.com" }, f)).state).toBe(
      "failed",
    );
    expect(f).not.toHaveBeenCalled();
  });
  it("records acceptance as sent, never delivered, with stable idempotency", async () => {
    const f = vi.fn().mockResolvedValue(Response.json({ id: "provider-id" }));
    expect(await sendHiringQA(input, f)).toEqual({ state: "sent", id: "provider-id", code: null });
    expect(f.mock.calls[0]![1].headers["Idempotency-Key"]).toBe("hiring/ledger/2");
  });
  it.each([409, 500])("does not assume a %s response means no email exists", async (status) => {
    expect(
      (await sendHiringQA(input, vi.fn().mockResolvedValue(new Response("", { status })))).state,
    ).toBe("unknown");
  });
  it("marks explicit rejection failed", async () => {
    expect(
      (await sendHiringQA(input, vi.fn().mockResolvedValue(new Response("", { status: 422 }))))
        .state,
    ).toBe("failed");
  });
  it("keeps a lost response uncertain", async () => {
    expect((await sendHiringQA(input, vi.fn().mockRejectedValue(new Error("timeout")))).state).toBe(
      "unknown",
    );
  });
  it("does not invent a receipt for an empty success", async () => {
    expect((await sendHiringQA(input, vi.fn().mockResolvedValue(Response.json({})))).state).toBe(
      "unknown",
    );
  });
});
