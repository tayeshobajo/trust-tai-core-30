import { describe, expect, it } from "vitest";

import { validatedBrand } from "@/data/roadmap-brand";

describe("validatedBrand", () => {
  it("returns nothing when the subject has no identity on record", () => {
    expect(validatedBrand(null)).toBeNull();
    expect(validatedBrand({})).toBeNull();
  });

  it("keeps a readable brand colour and an https logo", () => {
    const brand = validatedBrand({ themeColor: "#1d54c1", logoUrl: "https://acme.com/logo.svg" });
    expect(brand?.accent).toBe("#1d54c1");
    expect(brand?.logoUrl).toBe("https://acme.com/logo.svg");
  });

  it("drops a logo that is not served over https", () => {
    expect(validatedBrand({ logoUrl: "http://acme.com/logo.png" })).toBeNull();
  });

  it("drops a colour that cannot be read on paper", () => {
    expect(validatedBrand({ themeColor: "#fefefe" })?.accent).toBeUndefined();
  });
});
