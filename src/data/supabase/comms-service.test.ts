/**
 * Integration tests for the live Comms persistence layer.
 *
 * These run the real service, the real row mappers, the real contact matcher
 * and the real activity writer against an in-memory Supabase stand-in, so they
 * check the behaviour that matters against the provisioned schema: what is
 * written, which person it points at, what history it leaves, and what the
 * queue does with it afterwards.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { bucketFor } from "@/data/comms-queue";
import { reasonsToReconnect } from "@/data/comms-reminders";
import { checkVoice } from "@/data/voice-policy";
import type { HandoffDraft } from "@/domain/comms-handoff";

import { createFakeSupabase } from "./fake-supabase";

const db = createFakeSupabase();

vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: {
    from: (table: string) => db.from(table),
  },
}));

const { commsService } = await import("./comms-service");
const { receiveScoutHandoff } = await import("./comms-handoff-receiver");

const CONTEXT = { organizationId: "org-1", userId: "user-1" };

beforeEach(() => {
  for (const key of Object.keys(db.tables)) db.tables[key] = [];
});

function handoffDraft(overrides: Partial<HandoffDraft> = {}): HandoffDraft {
  const at = new Date().toISOString();
  return {
    prospectId: "prospect-1",
    companyName: "Northbeam Studio",
    websiteUrl: "https://northbeam.example",
    contact: {
      personId: "person-1",
      fullName: "Ada Rowe",
      roleTitle: "Founder",
      email: "ada@northbeam.example",
      emailStatus: "verified",
      confidence: "human_confirmed",
      why: "Founder listed on the site.",
      reachable: true,
    } as NonNullable<HandoffDraft["contact"]>,
    targets: [
      {
        rank: "primary",
        personId: "person-1",
        fullName: "Ada Rowe",
        roleTitle: "Founder",
        email: "ada@northbeam.example",
        emailStatus: "verified",
        confidence: "human_confirmed",
        why: "Founder listed on the site.",
        reachable: true,
      } as HandoffDraft["targets"][number],
    ],
    intent: "introduce",
    intentBecause: "They are rebuilding their booking flow this quarter.",
    requiredContext: [
      {
        label: "Booking flow",
        value: "Their booking page loads in 6s on mobile.",
        tier: "fact",
        evidence: [{ label: "northbeam.example/book", kind: "page" }],
      },
      {
        label: "Opportunity",
        value: "A faster booking path is the clearest first piece of work.",
        tier: "inference",
        evidence: [{ label: "Computed from page timings", kind: "computed" }],
      },
      {
        label: "Angle",
        value: "Lead with the booking flow, not a capabilities pitch.",
        tier: "decision",
        evidence: [{ label: "Chosen by a person", kind: "human" }],
      },
    ],
    confidence: {
      level: "medium",
      because: "Two read signals.",
      evidence: [{ label: "northbeam.example/book", kind: "page" }],
    } as HandoffDraft["confidence"],
    blockers: [],
    ready: true,
    generatedAt: at,
    ...overrides,
  } as HandoffDraft;
}

describe("conference capture", () => {
  it("creates one shared contact and one relationship that points at it", async () => {
    const relationship = await commsService.create(
      {
        fullName: "Ada Rowe",
        email: "Ada@Northbeam.example",
        metWhere: "Nashville Tech Council breakfast",
        note: "Rebuilding their booking flow before spring",
        source: "in_person",
      },
      CONTEXT,
    );

    expect(db.tables["contacts"]).toHaveLength(1);
    expect(db.tables["comms_relationships"]).toHaveLength(1);
    const contact = db.tables["contacts"]![0]!;
    expect(contact["full_name"]).toBe("Ada Rowe");
    expect(contact["email"]).toBe("ada@northbeam.example");
    expect(db.tables["comms_relationships"]![0]!["contact_id"]).toBe(contact["id"]);
    expect(relationship.metWhere).toBe("Nashville Tech Council breakfast");
  });

  it("keeps the human note as a decided memory, never an inference", async () => {
    const relationship = await commsService.create(
      { fullName: "Ada Rowe", note: "Wants help before spring", source: "in_person" },
      CONTEXT,
    );
    expect(relationship.inferred).toHaveLength(0);
    expect(relationship.decided[0]?.value).toBe("Wants help before spring");
    expect(relationship.decided[0]?.evidence[0]?.kind).toBe("human");
  });

  it("records provenance in the activity stream", async () => {
    await commsService.create({ fullName: "Ada Rowe", source: "in_person" }, CONTEXT);
    const activity = db.tables["activities"]![0]!;
    expect(activity["organization_id"]).toBe("org-1");
    expect(String(activity["summary"])).toContain("Ada Rowe");
  });

  it("does not duplicate a person already on record", async () => {
    await commsService.create(
      { fullName: "Ada Rowe", email: "ada@northbeam.example", source: "in_person" },
      CONTEXT,
    );
    await commsService.create(
      { fullName: "Ada Rowe", email: "ada@northbeam.example", source: "manual" },
      CONTEXT,
    );
    expect(db.tables["contacts"]).toHaveLength(1);
    expect(db.tables["comms_relationships"]).toHaveLength(2);
    const [first, second] = db.tables["comms_relationships"]!;
    expect(first!["contact_id"]).toBe(second!["contact_id"]);
  });

  it("matches on name when no email was captured", async () => {
    await commsService.create({ fullName: "Ada Rowe", source: "in_person" }, CONTEXT);
    await commsService.create({ fullName: "ada rowe", source: "manual" }, CONTEXT);
    expect(db.tables["contacts"]).toHaveLength(1);
  });

  it("refuses a relationship with no name", async () => {
    await expect(
      commsService.create({ fullName: "   ", source: "manual" }, CONTEXT),
    ).rejects.toThrow(/name/i);
  });
});

describe("scout handoff", () => {
  it("opens a relationship carrying company, contact, and separated memory", async () => {
    const relationship = await receiveScoutHandoff(handoffDraft(), CONTEXT);
    expect(relationship.companyName).toBe("Northbeam Studio");
    expect(relationship.fullName).toBe("Ada Rowe");
    expect(relationship.prospectId).toBe("prospect-1");
    expect(relationship.stage).toBe("ready_to_reach");
    expect(relationship.observed.map((item) => item.label)).toContain("Booking flow");
    expect(relationship.inferred.map((item) => item.label)).toContain("Opportunity");
    expect(relationship.decided.map((item) => item.label)).toContain("Angle");
  });

  it("carries the why-now as a human decision with its own evidence", async () => {
    const relationship = await receiveScoutHandoff(handoffDraft(), CONTEXT);
    const why = relationship.decided.find((item) => item.label === "Why we are reaching out");
    expect(why?.value).toContain("booking flow");
    expect(why?.evidence[0]?.kind).toBe("human");
  });

  it("is idempotent per prospect", async () => {
    const first = await receiveScoutHandoff(handoffDraft(), CONTEXT);
    const second = await receiveScoutHandoff(handoffDraft(), CONTEXT);
    expect(second.id).toBe(first.id);
    expect(db.tables["comms_relationships"]).toHaveLength(1);
  });

  it("keeps evidence links from the brief", async () => {
    const relationship = await receiveScoutHandoff(handoffDraft(), CONTEXT);
    const fact = relationship.observed.find((item) => item.label === "Booking flow");
    expect(fact?.evidence[0]?.label).toBe("northbeam.example/book");
  });
});

describe("touch logging", () => {
  it("moves last touch, clears the response clock, and logs history", async () => {
    const relationship = await commsService.create(
      { fullName: "Ada Rowe", source: "in_person" },
      CONTEXT,
    );
    await commsService.logTouch(
      { relationship, channel: "email", direction: "outbound", summary: "Sent the booking note." },
      CONTEXT,
    );

    const row = db.tables["comms_relationships"]![0]!;
    expect(row["last_touch_at"]).toBeTruthy();
    expect(row["response_due_at"]).toBeNull();
    expect(db.tables["comms_touches"]).toHaveLength(1);
    expect(db.tables["activities"]!.some((entry) => String(entry["summary"]).includes("Wrote to"))).toBe(
      true,
    );
  });

  it("an inbound touch opens a response clock and puts the person in the reply bucket", async () => {
    const relationship = await commsService.create(
      { fullName: "Ada Rowe", source: "in_person" },
      CONTEXT,
    );
    await commsService.logTouch(
      { relationship, channel: "email", direction: "inbound", summary: "She replied." },
      CONTEXT,
    );
    const [updated] = await commsService.list("org-1");
    expect(updated?.responseDueAt).toBeTruthy();
    expect(bucketFor(updated!)).toBe("waiting_on_you");
  });

  it("a logged touch takes the person out of the uncontacted bucket", async () => {
    const relationship = await commsService.create(
      { fullName: "Ada Rowe", source: "in_person" },
      CONTEXT,
    );
    expect(bucketFor(relationship)).toBe("no_contact_yet");
    await commsService.logTouch(
      { relationship, channel: "call", direction: "outbound", summary: "Called her." },
      CONTEXT,
    );
    const [updated] = await commsService.list("org-1");
    expect(bucketFor(updated!)).not.toBe("no_contact_yet");
  });

  it("a stage change is recorded as a human decision", async () => {
    const relationship = await commsService.create(
      { fullName: "Ada Rowe", source: "in_person" },
      CONTEXT,
    );
    const updated = await commsService.update(relationship.id, { stage: "in_conversation" }, CONTEXT);
    expect(updated.stage).toBe("in_conversation");
    expect(
      db.tables["activities"]!.some((entry) => String(entry["summary"]).includes("moved to")),
    ).toBe(true);
  });
});

describe("reminders", () => {
  it("saves only reasons that carry evidence", async () => {
    const relationship = await commsService.create(
      {
        fullName: "Ada Rowe",
        source: "in_person",
        decided: [
          {
            label: "Commitment",
            value: "We said we would send the booking teardown.",
            tier: "decided",
            evidence: [{ label: "Agreed in person", kind: "human" }],
            at: new Date().toISOString(),
          },
        ],
      },
      CONTEXT,
    );

    const reasons = reasonsToReconnect(relationship);
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) expect(reason.evidence.length).toBeGreaterThan(0);

    const saved = await commsService.saveReminder(
      {
        relationship,
        reasonCode: reasons[0]!.reasonCode,
        reasonText: reasons[0]!.reasonText,
        evidence: reasons[0]!.evidence,
      },
      CONTEXT,
    );
    expect(saved.reasonText).toContain("booking teardown");
    expect(saved.state).toBe("pending");
  });

  it("produces no reason when nothing true has happened", async () => {
    const relationship = await commsService.create(
      { fullName: "Quiet Person", source: "manual" },
      CONTEXT,
    );
    expect(reasonsToReconnect(relationship)).toHaveLength(0);
  });

  it("lists only pending reminders for the organization", async () => {
    const relationship = await commsService.create(
      { fullName: "Ada Rowe", source: "in_person" },
      CONTEXT,
    );
    const reminder = await commsService.saveReminder(
      {
        relationship,
        reasonCode: "commitment_made",
        reasonText: "We owe her the teardown.",
        evidence: [{ label: "Agreed in person", kind: "human" }],
      },
      CONTEXT,
    );
    expect(await commsService.listReminders("org-1")).toHaveLength(1);
    await commsService.setReminderState(reminder, "acted", CONTEXT);
    expect(await commsService.listReminders("org-1")).toHaveLength(0);
  });
});

describe("drafts never send themselves", () => {
  it("stores a draft in review state with its evidence", async () => {
    const relationship = await commsService.create(
      { fullName: "Ada Rowe", source: "in_person" },
      CONTEXT,
    );
    const draft = await commsService.saveDraft(
      {
        relationship,
        register: "warm_intro",
        intent: "Introduce",
        subject: "Your booking flow",
        body: "Short note.\n\nTrust,\nTai",
        reviewState: "needs_human_review",
        rationale: { violations: [] },
        evidence: [{ label: "northbeam.example/book", kind: "page" }],
      },
      CONTEXT,
    );
    expect(draft.reviewState).toBe("needs_human_review");
    expect(draft.evidence).toHaveLength(1);

    const sent = await commsService.setDraftState(draft, "sent", relationship, CONTEXT);
    expect(sent.reviewState).toBe("sent");
    expect(
      db.tables["activities"]!.some((entry) => String(entry["summary"]).includes("marked sent")),
    ).toBe(true);
  });

  it("blocks fabricated familiarity, invented promises, filler, and em dashes", () => {
    const verdict = checkVoice(
      "As always, great catching up — I guarantee we will double your bookings and leverage our bandwidth.",
      { register: "warm_intro" },
    );
    const rules = verdict.violations.map((entry) => entry.ruleId);
    expect(rules).toContain("no_fabricated_familiarity");
    expect(rules).toContain("no_unconfirmed_promise");
    expect(rules).toContain("no_corporate_filler");
    expect(rules).toContain("no_em_dash");
    expect(verdict.passes).toBe(false);
  });
});
