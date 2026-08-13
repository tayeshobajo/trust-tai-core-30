import { describe, expect, it } from "vitest";

import {
  companyIconSources,
  companyInitials,
  hostnameOf,
  normalizeThemeColor,
  readCompanyIdentity,
} from "./company-identity";

describe("company identity", () => {
  it("derives hostnames without scheme or www", () => {
    expect(hostnameOf("https://www.TeamSynerg.com/about")).toBe("teamsynerg.com");
    expect(hostnameOf("teamsynerg.com")).toBe("teamsynerg.com");
    expect(hostnameOf("")).toBeNull();
  });

  it("only offers same-site icon paths", () => {
    const sources = companyIconSources("https://teamsynerg.com");
    expect(sources.every((s) => s.startsWith("https://teamsynerg.com/"))).toBe(true);
    expect(sources).toContain("https://teamsynerg.com/favicon.ico");
  });

  it("puts a recorded logo url first", () => {
    const sources = companyIconSources("https://teamsynerg.com", "https://teamsynerg.com/logo.svg");
    expect(sources[0]).toBe("https://teamsynerg.com/logo.svg");
  });

  it("falls back to initials when there is no website", () => {
    expect(companyIconSources("")).toEqual([]);
    expect(companyInitials("Team Synerg")).toBe("TS");
    expect(companyInitials("Northwind")).toBe("NO");
  });

  it("validates colours and rejects invented ones", () => {
    expect(normalizeThemeColor("#1D54C1")).toBe("#1d54c1");
    expect(normalizeThemeColor("#abc")).toBe("#aabbcc");
    expect(normalizeThemeColor("rgb(29, 84, 193)")).toBe("#1d54c1");
    expect(normalizeThemeColor("blue")).toBeNull();
    expect(normalizeThemeColor(undefined)).toBeNull();
  });

  it("reads a theme colour from observed evidence", () => {
    const identity = readCompanyIdentity({
      observed: [{ key: "theme_color", value: "#0a7d55" }],
    });
    expect(identity.themeColor).toBe("#0a7d55");
  });

  it("returns nothing when no real colour exists", () => {
    expect(readCompanyIdentity({ metadata: { fit: {} } })).toEqual({});
  });
});
