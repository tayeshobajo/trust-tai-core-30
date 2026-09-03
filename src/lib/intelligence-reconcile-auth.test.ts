import { describe, expect, it } from "vitest";
import {
  authorizeReconcileRequest,
  constantTimeEquals,
  loadReconcileSecret,
} from "./intelligence-reconcile-auth.server";

function client(result: { data?: unknown; error?: unknown } | Error) {
  return {
    from(table: string) {
      expect(table).toBe("intelligence_reconcile_config");
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => {
          if (result instanceof Error) throw result;
          return { data: result.data ?? null, error: result.error ?? null };
        },
      };
      return chain;
    },
  };
}

describe("constantTimeEquals", () => {
  it("matches identical strings and rejects everything else", () => {
    expect(constantTimeEquals("abc123", "abc123")).toBe(true);
    expect(constantTimeEquals("abc123", "abc124")).toBe(false);
    expect(constantTimeEquals("abc123", "abc12")).toBe(false);
    expect(constantTimeEquals("", "")).toBe(true);
  });
});

describe("loadReconcileSecret", () => {
  it("returns the stored secret", async () => {
    expect(await loadReconcileSecret(client({ data: { secret: "s3cret-value" } }))).toBe(
      "s3cret-value",
    );
  });

  it("treats a missing row, an empty secret, an error, and a throw as not configured", async () => {
    expect(await loadReconcileSecret(client({ data: null }))).toBeNull();
    expect(await loadReconcileSecret(client({ data: { secret: "   " } }))).toBeNull();
    expect(await loadReconcileSecret(client({ error: { message: "denied" } }))).toBeNull();
    expect(await loadReconcileSecret(client(new Error("network")))).toBeNull();
  });
});

describe("authorizeReconcileRequest", () => {
  it("fails closed with 503 when the config row is missing", async () => {
    const result = await authorizeReconcileRequest(client({ data: null }), "anything");
    expect(result).toEqual({
      ok: false,
      status: 503,
      error: "Reconciliation is not configured on this deployment.",
    });
  });

  it("refuses a wrong or absent secret with 401", async () => {
    const configured = client({ data: { secret: "correct-horse" } });
    expect(await authorizeReconcileRequest(configured, "wrong-horse")).toEqual({
      ok: false,
      status: 401,
      error: "Not allowed.",
    });
    expect(
      await authorizeReconcileRequest(client({ data: { secret: "correct-horse" } }), null),
    ).toEqual({ ok: false, status: 401, error: "Not allowed." });
  });

  it("allows the valid secret", async () => {
    expect(
      await authorizeReconcileRequest(
        client({ data: { secret: "correct-horse" } }),
        "correct-horse",
      ),
    ).toEqual({ ok: true });
  });

  it("never returns the secret to the caller", async () => {
    const result = await authorizeReconcileRequest(
      client({ data: { secret: "correct-horse" } }),
      "no",
    );
    expect(JSON.stringify(result)).not.toContain("correct-horse");
  });
});
