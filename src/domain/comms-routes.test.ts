/**
 * The route rules, pinned.
 *
 * What may be saved as a route (minimal email shape, a LinkedIn host that is
 * really LinkedIn), how a route patch merges into existing metadata without
 * clobbering what it did not touch, and the one place `reached_out` is ever
 * decided.
 */

import { describe, expect, it } from "vitest";

import {
  EMAIL_CONFIRMED_KEY,
  LINKEDIN_CONFIRMED_KEY,
  LINKEDIN_URL_KEY,
  manualLinkedinMessageId,
  readEmailConfirmed,
  readEmailExplicitlyUnconfirmed,
  readLinkedinRoute,
  routePatch,
  stageAfterManualSend,
  validateLinkedinUrl,
  validateRouteEmail,
} from "./comms-routes";

describe("route email validation", () => {
  it("accepts a plain address and an empty field", () => {
    expect(validateRouteEmail("ada@northbeam.example")).toBeNull();
    expect(validateRouteEmail("   ")).toBeNull();
  });

  it("refuses something that cannot be an address", () => {
    expect(validateRouteEmail("not-an-email")).toMatch(/email/i);
    expect(validateRouteEmail("ada@nodot")).toMatch(/email/i);
    expect(validateRouteEmail("two words@x.com")).toMatch(/email/i);
  });
});

describe("linkedin url validation", () => {
  it("accepts linkedin.com and its subdomains over http(s)", () => {
    expect(validateLinkedinUrl("https://www.linkedin.com/in/ada")).toBeNull();
    expect(validateLinkedinUrl("https://linkedin.com/in/ada")).toBeNull();
    expect(validateLinkedinUrl("http://uk.linkedin.com/in/ada")).toBeNull();
    expect(validateLinkedinUrl("")).toBeNull();
  });

  it("refuses non-linkedin hosts, including lookalikes", () => {
    expect(validateLinkedinUrl("https://notlinkedin.com/in/ada")).toMatch(/linkedin\.com/);
    // The linkedin.com here is a PATH on evil.com, not the host.
    expect(validateLinkedinUrl("https://evil.com/linkedin.com/in/x")).toMatch(/linkedin\.com/);
    expect(validateLinkedinUrl("https://linkedin.com.evil.com/in/x")).toMatch(/linkedin\.com/);
    expect(validateLinkedinUrl("ftp://linkedin.com/in/x")).toMatch(/https/);
    expect(validateLinkedinUrl("linkedin.com/in/ada")).toMatch(/web address/i);
  });
});

describe("route patch", () => {
  it("merges into existing metadata without clobbering other keys", () => {
    const existing = {
      scout_handoff: { prospect_id: "prospect-1", intent: "introduce" },
      intent: "client_care",
    };
    const patch = routePatch(existing, {
      linkedinUrl: "https://www.linkedin.com/in/ada",
      linkedinConfirmed: true,
    });
    expect(patch.email).toBeUndefined();
    expect(patch.metadata["scout_handoff"]).toEqual({
      prospect_id: "prospect-1",
      intent: "introduce",
    });
    expect(patch.metadata["intent"]).toBe("client_care");
    expect(patch.metadata[LINKEDIN_URL_KEY]).toBe("https://www.linkedin.com/in/ada");
    expect(patch.metadata[LINKEDIN_CONFIRMED_KEY]).toBe(true);
  });

  it("stores an unconfirmed field as explicitly unconfirmed, never implied", () => {
    const patch = routePatch({}, { email: "Ada@Northbeam.example" });
    expect(patch.email).toBe("ada@northbeam.example");
    expect(patch.metadata[EMAIL_CONFIRMED_KEY]).toBe(false);
  });

  it("leaves a blank field entirely alone", () => {
    const existing = { [LINKEDIN_URL_KEY]: "https://linkedin.com/in/ada" };
    const patch = routePatch(existing, { email: "ada@northbeam.example", emailConfirmed: true });
    expect(patch.metadata[LINKEDIN_URL_KEY]).toBe("https://linkedin.com/in/ada");
    expect(patch.email).toBe("ada@northbeam.example");
  });
});

describe("email confirmation reading", () => {
  it("blocks only an explicit false: absence is a legacy address that keeps sending", () => {
    expect(readEmailExplicitlyUnconfirmed({ [EMAIL_CONFIRMED_KEY]: false })).toBe(true);
    // No mark at all: the address predates the route editor.
    expect(readEmailExplicitlyUnconfirmed({})).toBe(false);
    expect(readEmailExplicitlyUnconfirmed(null)).toBe(false);
    expect(readEmailExplicitlyUnconfirmed(undefined)).toBe(false);
    // Confirmed, or any non-false junk value, never blocks.
    expect(readEmailExplicitlyUnconfirmed({ [EMAIL_CONFIRMED_KEY]: true })).toBe(false);
    expect(readEmailExplicitlyUnconfirmed({ [EMAIL_CONFIRMED_KEY]: "false" })).toBe(false);
  });

  it("confirming later clears a previous explicit false", () => {
    const unconfirmed = routePatch({}, { email: "ada@northbeam.example" });
    expect(readEmailExplicitlyUnconfirmed(unconfirmed.metadata)).toBe(true);

    const confirmed = routePatch(unconfirmed.metadata, {
      email: "ada@northbeam.example",
      emailConfirmed: true,
    });
    expect(confirmed.metadata[EMAIL_CONFIRMED_KEY]).toBe(true);
    expect(readEmailExplicitlyUnconfirmed(confirmed.metadata)).toBe(false);
    expect(readEmailConfirmed(confirmed.metadata)).toBe(true);
  });
});

describe("linkedin route reading", () => {
  it("reads url and confirmation, and answers null when none is stored", () => {
    expect(readLinkedinRoute({})).toBeNull();
    expect(readLinkedinRoute(null)).toBeNull();
    expect(readLinkedinRoute({ [LINKEDIN_URL_KEY]: "https://linkedin.com/in/ada" })).toEqual({
      url: "https://linkedin.com/in/ada",
      confirmed: false,
    });
    expect(
      readLinkedinRoute({
        [LINKEDIN_URL_KEY]: "https://linkedin.com/in/ada",
        [LINKEDIN_CONFIRMED_KEY]: true,
      }),
    ).toEqual({ url: "https://linkedin.com/in/ada", confirmed: true });
  });
});

describe("manual send rules", () => {
  it("derives one deterministic id per draft", () => {
    expect(manualLinkedinMessageId("draft-1")).toBe(manualLinkedinMessageId("draft-1"));
    expect(manualLinkedinMessageId("draft-1")).not.toBe(manualLinkedinMessageId("draft-2"));
  });

  it("moves the stage forward only, never back", () => {
    expect(stageAfterManualSend("new")).toBe("reached_out");
    expect(stageAfterManualSend("ready_to_reach")).toBe("reached_out");
    expect(stageAfterManualSend("in_conversation")).toBeNull();
    expect(stageAfterManualSend("client")).toBeNull();
    expect(stageAfterManualSend("nurture")).toBeNull();
  });
});
