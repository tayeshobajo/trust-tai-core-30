import { expect, it } from "vitest";
import { attachLinkedIn, conversationEvents, linkedInApproximate } from "./roadmap-conversation";
import { linkedInEvidenceSchema, projectEvidence } from "./roadmap-evidence";
import { manifest, message } from "./roadmap-evidence.fixtures";
const sent = {
  slug: "qa-company",
  recipient: "QA recipient",
  profile_url: "https://www.linkedin.com/in/qa/",
  subject: "QA subject",
  body: "Synthetic sent body",
  status: "sent_ui_verified" as const,
  observed_send_time_utc_approx: "2026-10-20T18:09:00Z",
  receipt: "Synthetic UI receipt",
};
const reply = {
  ...sent,
  body: "Synthetic reply body",
  status: "received_ui_verified" as const,
  observed_at: "2026-10-21T09:00:00Z",
  timestamp_precision: "exact" as const,
};
it("retains multiple LinkedIn events, collapses exact duplicates and preserves differing copies", () => {
  const record = projectEvidence([], "org", manifest)[0]!;
  const enriched = attachLinkedIn(record, {
    updated_at: "2026-10-21T09:00:00Z",
    records: [sent, reply, sent, { ...sent, body: "Conflicting copy retained" }],
  });
  expect(enriched.linkedInEvents).toHaveLength(3);
  expect(enriched.linkedInEvents![0]!.status).toBe("received_ui_verified");
  expect(enriched.linkedIn?.status).toBe("sent_ui_verified");
  expect(record.linkedInEvents).toBeUndefined();
});
it("orders both channels and excludes prepared copy from latest activity", () => {
  const input = structuredClone(manifest);
  input.rows[0]!.interactions = [{ ...message, sent_at: "2026-10-20T20:00:00Z" }];
  const record = attachLinkedIn(projectEvidence([], "org", input)[0]!, {
    updated_at: "2026-10-21T09:00:00Z",
    records: [sent, reply],
  });
  expect(conversationEvents(record).map((e) => e.channel)).toEqual([
    "linkedin",
    "email",
    "linkedin",
  ]);
  expect(linkedInApproximate(sent)).toBe(true);
  expect(linkedInApproximate(reply)).toBe(false);
  expect(conversationEvents(projectEvidence([], "org", manifest)[0]!)).toEqual([]);
});
it("does not bind another client or treat an inbound-only history as a sent receipt", () => {
  const record = projectEvidence([], "org", manifest)[0]!;
  const enriched = attachLinkedIn(record, {
    updated_at: "2026-10-21T09:00:00Z",
    records: [reply, { ...sent, slug: "other" }],
  });
  expect(enriched.linkedIn).toBeUndefined();
  expect(enriched.linkedInEvents).toHaveLength(1);
});
it("requires an observed receive timestamp and keeps the legacy sent snapshot valid", () => {
  expect(
    linkedInEvidenceSchema.safeParse({ updated_at: "2026-10-21T09:00:00Z", records: [sent] })
      .success,
  ).toBe(true);
  expect(
    linkedInEvidenceSchema.safeParse({
      updated_at: "2026-10-21T09:00:00Z",
      records: [{ ...sent, status: "received_ui_verified" }],
    }).success,
  ).toBe(false);
});
