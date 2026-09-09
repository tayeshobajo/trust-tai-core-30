/**
 * ZenMode reply ingestion — wire-contract, signature and idempotency tests.
 *
 * These exist because the first implementation trusted a wire contract that
 * ZenMode does not actually send. Two fatal shape bugs are pinned here:
 *   1. the payload is enveloped as {event, data, timestamp} — the fields are
 *      under `data`, not at the top level;
 *   2. `lead_id` and `campaign_id` arrive as JSON NUMBERS, not strings.
 * Either one rejects every real reply, so both get a regression test.
 */

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  mapLeadReplied,
  refOf,
  unwrapZenModeEnvelope,
  verifyZenModeSignature,
  zenModeReplyDedupeRef,
  type ZenModeLeadRepliedPayload,
} from "@/lib/zenmode-reply-ingest.server";

const ORG = "11111111-1111-1111-1111-111111111111";
const SECRET = "zm_webhook_secret_for_tests";

/** A `lead.replied` body exactly as the ZenMode docs describe it. */
function envelopeFixture() {
  return {
    event: "lead.replied",
    data: {
      lead_id: 37110,
      campaign_id: 42,
      name: "Omar Molina",
      linkedin_url: "https://www.linkedin.com/in/example",
      replied_at: "2026-07-20T15:12:40.000Z",
      reply_text: "Thanks for reaching out, but I'm not interested.",
      reply_subject: null,
    },
    timestamp: "2026-07-20T15:12:41.000Z",
  };
}

describe("refOf", () => {
  it("stringifies the numeric ids ZenMode actually sends", () => {
    expect(refOf(37110)).toBe("37110");
    expect(refOf(42)).toBe("42");
  });

  it("still accepts string ids and trims them", () => {
    expect(refOf("  task_m1abc  ")).toBe("task_m1abc");
  });

  it("fails closed on missing or non-finite ids", () => {
    expect(refOf(null)).toBe("");
    expect(refOf(undefined)).toBe("");
    expect(refOf("   ")).toBe("");
    expect(refOf(Number.NaN)).toBe("");
  });
});

describe("unwrapZenModeEnvelope", () => {
  it("reads the fields from `data`, not the envelope top level", () => {
    const inner = unwrapZenModeEnvelope<Record<string, unknown>>(envelopeFixture());
    expect(inner["lead_id"]).toBe(37110);
    expect(inner["replied_at"]).toBe("2026-07-20T15:12:40.000Z");
    // The regression: the envelope itself has no lead_id at all.
    expect((envelopeFixture() as Record<string, unknown>)["lead_id"]).toBeUndefined();
  });

  it("passes a bare (un-enveloped) payload straight through", () => {
    const bare = { lead_id: 7, replied_at: "2026-09-09T00:00:00.000Z" };
    expect(unwrapZenModeEnvelope<Record<string, unknown>>(bare)).toEqual(bare);
  });
});

describe("verifyZenModeSignature", () => {
  const raw = JSON.stringify(envelopeFixture());
  const good = createHmac("sha256", SECRET).update(raw, "utf8").digest("hex");

  it("accepts a correct hex HMAC of the RAW body", () => {
    expect(verifyZenModeSignature(raw, good, SECRET)).toBe(true);
  });

  it("accepts a sha256= prefixed header", () => {
    expect(verifyZenModeSignature(raw, `sha256=${good}`, SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const tampered = raw.replace("not interested", "very interested");
    expect(verifyZenModeSignature(tampered, good, SECRET)).toBe(false);
  });

  it("rejects a wrong secret, a missing header and a malformed digest", () => {
    expect(verifyZenModeSignature(raw, good, "other-secret")).toBe(false);
    expect(verifyZenModeSignature(raw, null, SECRET)).toBe(false);
    expect(verifyZenModeSignature(raw, "not-hex!!", SECRET)).toBe(false);
    expect(verifyZenModeSignature(raw, good, null)).toBe(false);
  });
});

describe("zenModeReplyDedupeRef", () => {
  it("keys on lead_id + replied_at, tolerating a numeric lead_id", () => {
    expect(
      zenModeReplyDedupeRef({ lead_id: 37110, replied_at: "2026-07-20T15:12:40.000Z" }),
    ).toBe("37110:2026-07-20T15:12:40.000Z");
  });

  it("is stable across redelivery of the identical payload", () => {
    const payload = { lead_id: 37110, replied_at: "2026-07-20T15:12:40.000Z" };
    expect(zenModeReplyDedupeRef(payload)).toBe(zenModeReplyDedupeRef({ ...payload }));
  });

  it("separates two different replies from the same lead", () => {
    const first = zenModeReplyDedupeRef({ lead_id: 37110, replied_at: "2026-07-20T15:12:40.000Z" });
    const second = zenModeReplyDedupeRef({ lead_id: 37110, replied_at: "2026-07-21T09:00:00.000Z" });
    expect(first).not.toBe(second);
  });
});

describe("mapLeadReplied", () => {
  const payload = envelopeFixture().data as unknown as ZenModeLeadRepliedPayload;

  it("maps the real numeric-id payload onto the shared landing contract", () => {
    const observed = mapLeadReplied(payload, ORG);
    expect(observed.organizationId).toBe(ORG);
    expect(observed.source).toBe("zenmode");
    expect(observed.externalThreadRef).toBe("37110");
    expect(observed.externalMessageRef).toBe("37110:2026-07-20T15:12:40.000Z");
    expect(observed.senderLinkedinUrl).toBe("https://www.linkedin.com/in/example");
    expect(observed.senderName).toBe("Omar Molina");
    expect(observed.body).toBe("Thanks for reaching out, but I'm not interested.");
    expect(observed.observedAt).toBe("2026-07-20T15:12:40.000Z");
  });

  it("carries transport ids as provenance only, normalized to strings", () => {
    const observed = mapLeadReplied(payload, ORG);
    expect(observed.payload).toMatchObject({
      transport: "zenmode",
      lead_id: "37110",
      campaign_id: "42",
    });
  });

  it("falls back to the subject when reply_text is null", () => {
    const observed = mapLeadReplied(
      { ...payload, reply_text: null, reply_subject: "Quick question about outreach" },
      ORG,
    );
    expect(observed.body).toBe("Quick question about outreach");
  });

  it("still records a reply when both text fields are null", () => {
    const observed = mapLeadReplied({ ...payload, reply_text: null, reply_subject: null }, ORG);
    expect(observed.body).toBe("(reply received; ZenMode provided no text)");
    expect(observed.payload).toMatchObject({ reply_text: null, reply_subject: null });
  });

  it("omits a blank sender url rather than inventing a route", () => {
    const observed = mapLeadReplied({ ...payload, linkedin_url: "   " }, ORG);
    expect(observed.senderLinkedinUrl).toBeUndefined();
  });

  it("carries a null campaign_id through without stringifying it", () => {
    const observed = mapLeadReplied({ ...payload, campaign_id: null }, ORG);
    expect(observed.payload).toMatchObject({ campaign_id: null });
  });
});
