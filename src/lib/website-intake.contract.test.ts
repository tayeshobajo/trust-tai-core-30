import { describe, expect, it } from "vitest";

import {
  IntakeBody,
  EventsBody,
  normalizeStructured,
  signIntake,
  verifyIntakeSignature,
} from "./website-intake.server";

const SECRET = "test-secret";
const NOW = new Date("2026-08-20T10:00:00.000Z");
const TS = String(Math.floor(NOW.getTime() / 1000));

const body = JSON.stringify({ submission_id: "sub_1" });

describe("website receiver authentication", () => {
  it("accepts a correctly signed request", () => {
    const signature = signIntake(SECRET, TS, body);
    expect(
      verifyIntakeSignature({ secret: SECRET, signature, timestamp: TS, rawBody: body, now: NOW }),
    ).toEqual({ ok: true });
  });

  it("rejects a wrong signature", () => {
    const result = verifyIntakeSignature({
      secret: SECRET,
      signature: signIntake("other-secret", TS, body),
      timestamp: TS,
      rawBody: body,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a tampered body", () => {
    const signature = signIntake(SECRET, TS, body);
    const result = verifyIntakeSignature({
      secret: SECRET,
      signature,
      timestamp: TS,
      rawBody: JSON.stringify({ submission_id: "sub_2" }),
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a replayed timestamp", () => {
    const oldTs = String(Math.floor(NOW.getTime() / 1000) - 3600);
    const result = verifyIntakeSignature({
      secret: SECRET,
      signature: signIntake(SECRET, oldTs, body),
      timestamp: oldTs,
      rawBody: body,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("rejects an unsigned request", () => {
    expect(
      verifyIntakeSignature({ secret: SECRET, signature: null, timestamp: null, rawBody: body }),
    ).toEqual({ ok: false, reason: "missing_signature" });
  });

  it("fails closed when no secret is configured", () => {
    expect(
      verifyIntakeSignature({
        secret: undefined,
        signature: "sha256=x",
        timestamp: TS,
        rawBody: body,
      }),
    ).toEqual({ ok: false, reason: "not_configured" });
  });
});

describe("intake payload contract", () => {
  const valid = {
    source_app: "website",
    source_channel: "website",
    source_type: "roadmap_intake",
    submission_id: "sub_1",
    submitted_at: "2026-08-20T09:50:00.000Z",
    started_at: "2026-08-20T09:40:00.000Z",
    attribution: { landing_path: "/roadmap", utm: { source: "linkedin" } },
    person: { name: "Sam", email: "sam@elevate-ortho.com" },
    company: { name: "Elevate Orthodontics", website: "https://elevate-ortho.com" },
    verbatim: [
      {
        question_id: "q1",
        question_text: "What do you want to be true in a year?",
        answer_text: "Three  clinics, one system.",
        modality: "voice",
      },
    ],
    structured: { pains: ["Manual scheduling"] },
    signals: { frame: "growth", completeness: 0.8 },
    consent: { marketing_opt_in: true },
  };

  it("accepts a complete submission and preserves verbatim exactly", () => {
    const parsed = IntakeBody.parse(valid);
    expect(parsed.verbatim[0]!.answer_text).toBe("Three  clinics, one system.");
    expect(parsed.verbatim[0]!.modality).toBe("voice");
  });

  it("rejects a foreign source app", () => {
    expect(IntakeBody.safeParse({ ...valid, source_app: "portal" }).success).toBe(false);
  });

  it("rejects a submission with no idempotency key", () => {
    expect(IntakeBody.safeParse({ ...valid, submission_id: "" }).success).toBe(false);
  });

  it("normalises structured lists without inventing content", () => {
    const structured = normalizeStructured(IntakeBody.parse(valid).structured);
    expect(structured.pains).toEqual(["Manual scheduling"]);
    expect(structured.goals).toEqual([]);
  });
});

describe("event payload contract", () => {
  it("requires at least one event and a dedupe key", () => {
    expect(
      EventsBody.safeParse({
        source_app: "website",
        events: [{ event_name: "page_view", event_key: "s1:pv:1", occurred_at: "2026-08-20T09:00:00Z" }],
      }).success,
    ).toBe(true);
    expect(EventsBody.safeParse({ source_app: "website", events: [] }).success).toBe(false);
  });
});
