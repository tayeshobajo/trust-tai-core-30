import { describe, expect, it, vi } from "vitest";

import {
  EnrichmentNotConfigured,
  ProviderFailure,
  enrichWorkEmail,
  enrichmentProviders,
  enrichmentStatus,
  searchPeople,
} from "./contact-enrichment.server";

const CONFIGURED = { LOVABLE_API_KEY: "lov", APOLLO_API_KEY: "secret-apollo-value", CLAY_API_KEY: "clay" };


function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("configuration", () => {
  it("is not connected when this app runtime has no key", () => {
    const status = enrichmentStatus({ LOVABLE_API_KEY: "lov" });
    expect(status.connected).toBe(false);
    expect(status.apolloConfigured).toBe(false);
    expect(status.clayConfigured).toBe(false);
    expect(status.order).toEqual([]);
  });

  it("counts Apollo as configured on its own key alone", () => {
    const status = enrichmentStatus({ APOLLO_API_KEY: "secret-apollo-value" });
    expect(status.apolloConfigured).toBe(true);
    expect(status.connected).toBe(true);
    expect(status.order).toEqual(["apollo"]);
  });

  it("still needs a Lovable key when Apollo is routed through the gateway", () => {
    const status = enrichmentStatus({
      APOLLO_API_KEY: "secret-apollo-value",
      APOLLO_VIA_CONNECTOR_GATEWAY: "true",
    });
    expect(status.apolloConfigured).toBe(false);
  });


  it("prefers Apollo, then Clay, and keeps automatic enrichment off by default", () => {
    const status = enrichmentStatus(CONFIGURED);
    expect(status.order).toEqual(["apollo", "clay"]);
    expect(status.automaticEnrichment).toBe(false);
  });

  it("honours a configured provider order", () => {
    const providers = enrichmentProviders(
      { ...CONFIGURED, SCOUT_ENRICHMENT_ORDER: "clay,apollo" },
      fetch,
    );
    expect(providers.map((provider) => provider.id)).toEqual(["clay", "apollo"]);
  });

  it("refuses to search when nothing is connected", async () => {
    await expect(
      searchPeople({ companyName: "Northwind", roleFamilies: [], limit: 4 }, {}, fetch),
    ).rejects.toBeInstanceOf(EnrichmentNotConfigured);
  });
});

describe("Apollo search", () => {
  it("returns people without claiming an address", async () => {
    const impl = vi.fn(async () =>
      jsonResponse({
        people: [
          {
            id: "apollo-1",
            name: "Dana Reid",
            title: "Chief Operating Officer",
            linkedin_url: "https://linkedin.com/in/dana",
            headline: "Runs service operations at Northwind",
            organization: { name: "Northwind Services", primary_domain: "northwind.com" },
          },
        ],
      }),
    );
    const result = await searchPeople(
      { companyName: "Northwind Services", domain: "northwind.com", roleFamilies: ["Operations"], limit: 4 },
      CONFIGURED,
      impl as unknown as typeof fetch,
    );
    expect(result.provider).toBe("apollo");
    expect(result.people[0]?.fullName).toBe("Dana Reid");
    expect(result.people[0]?.email).toBeUndefined();
    const [url, init] = impl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toContain("https://api.apollo.io/api/v1/mixed_people/api_search");
    expect(String(url)).toContain("person_titles");
    const sent = init.headers as Record<string, string>;
    // Apollo's own scheme, and the key is never a query parameter.
    expect(sent["X-Api-Key"]).toBe("secret-apollo-value");
    expect(String(url)).not.toContain("secret-apollo-value");
  });

  it("passes seniority bands when the opportunity implies them", async () => {
    const impl = vi.fn(async () => jsonResponse({ people: [] }));
    await searchPeople(
      { companyName: "Northwind", roleFamilies: ["Operations"], seniorities: ["owner"], limit: 4 },
      { APOLLO_API_KEY: "secret-apollo-value" },
      impl as unknown as typeof fetch,
    );
    expect(String((impl.mock.calls[0] as unknown as [URL])[0])).toContain("person_seniorities");
  });

  it("routes through the gateway only when the workspace says so", async () => {
    const impl = vi.fn(async () => jsonResponse({ people: [] }));
    await searchPeople(
      { companyName: "Northwind", roleFamilies: [], limit: 4 },
      { ...CONFIGURED, APOLLO_VIA_CONNECTOR_GATEWAY: "true" },
      impl as unknown as typeof fetch,
    );
    expect(String((impl.mock.calls[0] as unknown as [URL])[0])).toContain(
      "connector-gateway.lovable.dev/apollo",
    );
  });

});

describe("Apollo enrichment", () => {
  it("reports verified only when Apollo says verified", async () => {
    const verified = await enrichWorkEmail(
      { fullName: "Dana Reid", companyName: "Northwind", domain: "northwind.com" },
      CONFIGURED,
      (async () =>
        jsonResponse({
          matches: [{ email: "dana@northwind.com", email_status: "verified" }],
        })) as unknown as typeof fetch,
    );
    expect(verified.email).toBe("dana@northwind.com");
    expect(verified.verified).toBe(true);
    expect(verified.attempts).toEqual(["apollo"]);

    const unverified = await enrichWorkEmail(
      { fullName: "Dana Reid", companyName: "Northwind" },
      CONFIGURED,
      (async () => jsonResponse({ matches: [{ email: "dana@northwind.com" }] })) as unknown as typeof fetch,
    );
    expect(unverified.verified).toBe(false);
    expect(unverified.because).toContain("without a verification state");
  });

  it("never asks for a phone number", async () => {
    const impl = vi.fn(async () => jsonResponse({ matches: [] }));
    await enrichWorkEmail(
      { fullName: "Dana Reid", companyName: "Northwind" },
      CONFIGURED,
      impl as unknown as typeof fetch,
    );
    const [, init] = impl.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(init.body)).toContain('"reveal_phone_number":false');
  });
});

describe("failure policy", () => {
  it("falls back to Clay only after a retryable failure", async () => {
    const calls: string[] = [];
    const impl = vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("apollo.io")) return jsonResponse({ error: "upstream" }, 503);
      return jsonResponse({ results: [{ outputs: { email: "dana@northwind.com" } }] });
    });
    const result = await enrichWorkEmail(
      { fullName: "Dana Reid", companyName: "Northwind" },
      { ...CONFIGURED, CLAY_EMAIL_ROUTINE_ID: "function:t_1" },
      impl as unknown as typeof fetch,
    );
    expect(result.provider).toBe("clay");
    expect(result.attempts).toEqual(["apollo", "clay"]);
    expect(calls).toHaveLength(2);
  });

  it("stops on an account failure instead of spending again", async () => {
    const impl = vi.fn(async () => jsonResponse({ error: "insufficient credits" }, 402));
    await expect(
      enrichWorkEmail(
        { fullName: "Dana Reid", companyName: "Northwind" },
        { ...CONFIGURED, CLAY_EMAIL_ROUTINE_ID: "function:t_1" },
        impl as unknown as typeof fetch,
      ),
    ).rejects.toBeInstanceOf(ProviderFailure);
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it("says Clay email enrichment is unconfigured rather than pretending", async () => {
    await expect(
      enrichWorkEmail(
        { fullName: "Dana Reid", companyName: "Northwind" },
        { LOVABLE_API_KEY: "lov", CLAY_API_KEY: "clay" },
        (async () => jsonResponse({})) as unknown as typeof fetch,
      ),
    ).rejects.toBeInstanceOf(EnrichmentNotConfigured);
  });
});
