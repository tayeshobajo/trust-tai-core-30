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
