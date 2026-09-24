/**
 * Smart Import, the server side, proved:
 *
 *  A. A private Google file is refused in words, never half read.
 *  B. A fetched source is bounded by size and by content type.
 *  C. With no provider, a delimited list still imports deterministically.
 *  D. With no provider, prose fails honestly instead of inventing companies.
 *  E. Ungrounded model output never reaches a person.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const runtimeModelCaller = vi.fn();
const readRetrievalPrinciplesAsCaller = vi.fn(async () => [] as unknown[]);

vi.mock("@/lib/organizational-principles.server", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@/lib/organizational-principles.server",
  );
  return {
    ...actual,
    readRetrievalPrinciplesAsCaller: (...args: unknown[]) =>
      readRetrievalPrinciplesAsCaller(...(args as [])),
  };
});

vi.mock("@/lib/intelligence-runtime.server", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@/lib/intelligence-runtime.server",
  );
  return { ...actual, runtimeModelCaller: (...args: unknown[]) => runtimeModelCaller(...args) };
});

const { extractCompanies, fetchSourceText, SourceUnreadableError, deterministicExtraction } =
  await import("./scout-import.server");
const { ProviderNotConfiguredError } = await import("@/lib/intelligence-runtime.server");

const CSV = ["Company,Website", "Northfield Dental,northfielddental.com", "acme.com"].join("\n");

function respond(body: string, init: { status?: number; type?: string } = {}) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "Content-Type": init.type ?? "text/csv" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  runtimeModelCaller.mockReset();
  readRetrievalPrinciplesAsCaller.mockReset();
  readRetrievalPrinciplesAsCaller.mockResolvedValue([]);
});

describe("fetching a source", () => {
  it("refuses a private Google Sheet in plain words", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond("<html>Sign in</html>", { status: 401, type: "text/html" })),
    );
    await expect(
      fetchSourceText("https://docs.google.com/spreadsheets/d/private123/edit"),
    ).rejects.toThrow(/not shared publicly/i);
  });

  it("refuses a Drive link before it ever reaches the network", async () => {
    const call = vi.fn();
    vi.stubGlobal("fetch", call);
    await expect(fetchSourceText("https://drive.google.com/file/d/x/view")).rejects.toBeInstanceOf(
      SourceUnreadableError,
    );
    expect(call).not.toHaveBeenCalled();
  });

  it("refuses a source that is not readable text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond("%PDF-1.7", { type: "application/pdf" })),
    );
    await expect(fetchSourceText("https://example.com/list.pdf")).rejects.toThrow(
      /not a readable text document/i,
    );
  });

  it("refuses a source too large to read in one pass", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond("a".repeat(2_000_001))),
    );
    await expect(fetchSourceText("https://example.com/huge.csv")).rejects.toThrow(/too large/i);
  });

  it("reads a shared Google Sheet through its export address", async () => {
    const call = vi.fn(async (_url: unknown) => respond(CSV));
    vi.stubGlobal("fetch", call);
    const source = await fetchSourceText("https://docs.google.com/spreadsheets/d/abc/edit#gid=0");
    expect(source.text).toContain("Northfield Dental");
    expect(String(call.mock.calls[0]?.[0])).toContain("export?format=csv");
  });
});

describe("extracting companies", () => {
  const input = { token: "t", organizationId: "org-1" };

  it("still reads a delimited list when no provider is configured", async () => {
    runtimeModelCaller.mockRejectedValue(new ProviderNotConfiguredError("none"));
    const outcome = await extractCompanies({ ...input, text: CSV });
    expect(outcome.deterministic).toBe(true);
    expect(outcome.companies.map((company) => company.name)).toContain("Northfield Dental");
  });

  it("returns nothing for prose when no provider is configured, rather than inventing", async () => {
    runtimeModelCaller.mockRejectedValue(new ProviderNotConfiguredError("none"));
    const outcome = await extractCompanies({
      ...input,
      text: "We had a good call with the dental group last week and should follow up soon.",
    });
    expect(outcome.deterministic).toBe(true);
    expect(outcome.companies).toHaveLength(0);
  });

  it("drops a company the model returned that is not in the source", async () => {
    runtimeModelCaller.mockResolvedValue(async () => ({
      raw: JSON.stringify({
        companies: [
          {
            name: "Ghost Dental",
            websiteUrl: "ghost.com",
            websiteConfidence: "observed",
            because: "invented",
            excerpt: "Ghost Dental, ghost.com",
          },
        ],
      }),
      provider: "openai",
      model: "test",
    }));
    const outcome = await extractCompanies({
      ...input,
      text: "Northfield Dental is worth a look. They run three sites.",
    });
    expect(outcome.companies).toHaveLength(0);
    expect(outcome.dropped[0]?.name).toBe("Ghost Dental");
  });

  it("never promotes an unsupported domain to fact", async () => {
    runtimeModelCaller.mockResolvedValue(async () => ({
      raw: JSON.stringify({
        companies: [
          {
            name: "Northfield Dental",
            websiteUrl: "northfielddental.com",
            websiteConfidence: "observed",
            because: "named",
            excerpt: "Northfield Dental is worth a look",
          },
        ],
      }),
      provider: "openai",
      model: "test",
    }));
    const outcome = await extractCompanies({
      ...input,
      text: "Northfield Dental is worth a look. They run three sites.",
    });
    expect(outcome.companies[0]?.websiteConfidence).toBe("inferred");
  });

  it("hands the model the shared retrieval bundle, not only the source string", async () => {
    const call = vi.fn(async () => ({
      raw: JSON.stringify({ companies: [] }),
      provider: "openai",
      model: "test",
    }));
    runtimeModelCaller.mockResolvedValue(call);

    await extractCompanies({
      ...input,
      text: "Northfield Dental is worth a look.",
      known: [{ name: "Northfield Dental", domain: "northfielddental.com" }],
    });

    const sent = (
      call.mock.calls as unknown as { instructions: string; input: string }[][]
    )[0]?.[0];
    const body = JSON.parse(String(sent?.input)) as {
      retrieval: Record<string, unknown>;
      source: string;
    };
    expect(body.retrieval["room"]).toBe("scout");
    /* The canonical company is read as known, never re-inferred. */
    const evidence = body.retrieval["evidence"] as { tier: string; statement: string }[];
    expect(evidence.some((e) => e.tier === "observed" && e.statement.includes("Northfield"))).toBe(
      true,
    );
    /* Unreadable sources stay withheld, never zero. */
    expect(body.retrieval["withheld"]).toBeTruthy();
    /* The source text is still verbatim, so grounding is unchanged. */
    expect(body.source).toContain("Northfield Dental is worth a look.");
    expect(String(sent?.instructions)).toContain("retrieval.humanCorrections");
  });

  it("passes fetched principles into the retrieval compose the model reads", async () => {
    readRetrievalPrinciplesAsCaller.mockResolvedValue([
      {
        id: "p-1",
        organizationId: "org-1",
        principle: "Never infer a domain from a company name.",
        scope: { domain: "sales", contextTags: [] },
        status: "active",
        confidence: 0.8,
        lastValidatedAt: "2026-09-24T00:00:00.000Z",
      },
    ]);
    const call = vi.fn(async () => ({
      raw: JSON.stringify({ companies: [] }),
      provider: "openai",
      model: "test",
    }));
    runtimeModelCaller.mockResolvedValue(call);

    await extractCompanies({ ...input, text: "Northfield Dental is worth a look." });

    const sent = (call.mock.calls as unknown as { input: string }[][])[0]?.[0];
    const body = JSON.parse(String(sent?.input)) as { retrieval: Record<string, unknown> };
    const corrections = body.retrieval["humanCorrections"] as { id: string; lesson: string }[];
    expect(corrections.some((c) => c.id === "p-1" && c.lesson.includes("Never infer"))).toBe(true);
    /* The scope handed to the read is the sourcing scope, nothing wider. */
    expect(readRetrievalPrinciplesAsCaller).toHaveBeenCalledWith("t", "org-1", {
      domain: "sales",
      contextTags: [],
    });
  });
});

describe("the deterministic reader", () => {
  it("reads columns and refuses prose", () => {
    expect(deterministicExtraction(CSV).companies).toHaveLength(2);
    expect(
      deterministicExtraction("We should really follow up with that dental group next week.")
        .companies,
    ).toHaveLength(0);
  });
});
