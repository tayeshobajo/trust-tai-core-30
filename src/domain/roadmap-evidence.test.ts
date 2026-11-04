import { describe, expect, it } from "vitest";
import {
  deduplicateMessages,
  evidenceHolds,
  messagePlainText,
  observedSends,
  projectEvidence,
  reviewManifestSchema,
  type MessageEvidence,
} from "./roadmap-evidence";

import { sha256 } from "./sha256";

import { message, manifest, native } from "./roadmap-evidence.fixtures";

describe("identity and state boundaries", () => {
  it("does not bind by name or by a supplied canonical ID", () => {
    const input = structuredClone(manifest);
    input.rows[0]!.canonical_cmd_record_id = native.id;
    const rows = projectEvidence([native], "org", input);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.binding).toBe("pending");
    expect(observedSends(rows[0]!)).toBe(0);
    expect(observedSends(rows[1]!)).toBe(0);
  });
  it("merges only one explicit, scoped, reviewed binding and preserves canonical next action", () => {
    const records = projectEvidence([native], "org", manifest, [
      {
        slug: "qa-company",
        roadmapId: native.id,
        organizationId: "org",
        reviewedBy: "reviewer",
        reviewedAt: "2026-10-20T00:00:00Z",
      },
    ]);
    expect(records).toHaveLength(1);
    expect(records[0]!.binding).toBe("reviewed");
    expect(records[0]!.nextAction).toBe("Next action unknown");
  });
  it("does not expose records from another organization or accept duplicate decisions", () => {
    expect(projectEvidence([native], "other")).toEqual([]);
    const b = {
      slug: "qa-company",
      roadmapId: native.id,
      organizationId: "org",
      reviewedBy: "reviewer",
      reviewedAt: "2026-10-20T00:00:00Z",
    };
    expect(projectEvidence([native], "org", manifest, [b, b])).toHaveLength(2);
    expect(
      projectEvidence([native], "org", manifest, [{ ...b, organizationId: "other" }]),
    ).toHaveLength(2);
  });
  it("preserves recipient and footer holds without inferring dates", () => {
    const m = structuredClone(manifest);
    m.rows[0]!.recipient.verification_status = "held_unverified_named_direct";
    m.rows[0]!.recipient.disposition = "Direct address missing";
    const row = projectEvidence([], "org", m)[0]!;
    expect(evidenceHolds(row)).toEqual([
      "Canonical identity needs review",
      "Direct address missing",
      "Footer held",
    ]);
    expect(row.followUp).toBeNull();
  });
});

describe("message provenance", () => {
  it("deduplicates the same RFC message across mailboxes and preserves both sources", () => {
    const second = {
      ...message,
      mailbox: "other@example.test",
      provider_message_id: "m2",
      source_url: "https://mail.google.com/mail/u/?authuser=other%40example.test#sent/m2",
    };
    const rows = deduplicateMessages([message, second]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sources).toHaveLength(2);
    expect(rows[0]!.mailboxes).toHaveLength(2);
    expect(rows[0]!.conflict).toBe(false);
  });
  it("never deduplicates unrelated identical subjects/bodies or mailbox-scoped IDs", () => {
    expect(
      deduplicateMessages([
        { ...message, rfc_message_id: undefined },
        { ...message, rfc_message_id: undefined, mailbox: "other@example.test" },
      ]),
    ).toHaveLength(2);
  });
  it.each(["body_exact", "type", "sent_at"] as const)(
    "holds contradictory %s for the same message",
    (field) => {
      const second = {
        ...message,
        [field]:
          field === "type"
            ? "email_received"
            : field === "sent_at"
              ? "2026-10-19T23:40:50Z"
              : "changed",
      } as MessageEvidence;
      const observations = deduplicateMessages([message, second]);
      expect(observations).toHaveLength(2);
      expect(observations.every((m) => m.conflict)).toBe(true);
      expect(
        observedSends({ ...projectEvidence([], "org", manifest)[0]!, messages: observations }),
      ).toBe(0);
    },
  );
  it("holds a body with a mismatched digest", () => {
    expect(deduplicateMessages([{ ...message, body_sha256: sha256("wrong") }])[0]!.conflict).toBe(
      true,
    );
  });
  it("does not turn received messages into sends", () => {
    const rows = projectEvidence([], "org", manifest);
    rows[0]!.messages = deduplicateMessages([
      { ...message, type: "email_received", mailbox: "tai@example.test" },
    ]);
    expect(observedSends(rows[0]!)).toBe(0);
  });
});

describe("untrusted manifest validation", () => {
  it("accepts the read-only contract", () => {
    expect(reviewManifestSchema.parse(manifest).rows).toHaveLength(1);
  });
  it("rejects active source URLs and duplicate identities", () => {
    const m = structuredClone(manifest);
    m.rows[0]!.public_roadmap_url = "javascript:alert(1)";
    expect(reviewManifestSchema.safeParse(m).success).toBe(false);
    expect(
      reviewManifestSchema.safeParse({ ...manifest, rows: [...manifest.rows, ...manifest.rows] })
        .success,
    ).toBe(false);
  });
  it("requires explicit mailbox provenance for received evidence", () => {
    const m = structuredClone(manifest);
    m.rows[0]!.interactions = [{ ...message, type: "email_received" }];
    expect(reviewManifestSchema.safeParse(m).success).toBe(false);
  });
  it("extracts inert text, retaining exact source separately", () => {
    const body =
      '<p>Hello &amp; welcome</p><script>alert(1)</script><img src="https://tracker.test/pixel"><p><a href="https://example.test">Read</a></p>';
    expect(messagePlainText(body, "text/html")).toBe(
      "Hello & welcome\nRead (https://example.test)",
    );
    expect(messagePlainText("<literal>", "text/plain")).toBe("<literal>");
  });
});

import {
  partialInteractionSchema,
  savedDrafts,
  roadmapSendVerified,
  type PartialInteractionHistory,
} from "./roadmap-evidence";
import { publicRoadmapObservation } from "@/data/roadmap-publication-observation";
const historical: PartialInteractionHistory = {
  status: "partial_known_client_interactions",
  coverage: "QA partial only",
  interactions: [
    {
      client_slug: "qa-company",
      account: message.from,
      message_id: message.provider_message_id,
      thread_id: message.provider_thread_id,
      direction: "sent",
      date_utc: "2026-10-19T23:39:50+00:00",
      from: message.from,
      to: message.to.join(", "),
      cc: "",
      subject: message.subject,
      body_text: "Sanitized QA representation",
      source_url: "https://mail.google.com/mail/u/?authuser=tai%40example.test#all/m1",
      content_safety: "Plain text only, sanitized by reviewer",
    },
  ],
};
it("reconciles public identity by exact slug/URL without binding a canonical name match", () => {
  const pub = {
    checkedAt: "2026-10-20",
    sourceUrl: "https://trusttai.com/clients",
    entries: [
      { slug: "qa-company", name: "QA company", url: manifest.rows[0]!.public_roadmap_url },
    ],
  };
  const records = projectEvidence([native], "org", manifest, [], pub);
  expect(records).toHaveLength(2);
  expect(records[0]!.publication).toBeUndefined();
  expect(records[1]!.publication?.slug).toBe("qa-company");
  expect(publicRoadmapObservation.entries).toHaveLength(43);
  expect(new Set(publicRoadmapObservation.entries.map((r) => r.slug)).size).toBe(43);
  expect(new Set(publicRoadmapObservation.entries.map((r) => r.url)).size).toBe(43);
  expect(publicRoadmapObservation.checkedAt).toBe("2026-11-03T21:43:23Z");
});
it("deduplicates identical provider identity across exact HTML and reviewer-sanitized representations", () => {
  const m = structuredClone(manifest);
  m.rows[0]!.interactions = [
    { ...message, body_format: "text/html", body_exact: "<p>Original QA HTML</p>" },
  ];
  const record = projectEvidence(
    [],
    "org",
    m,
    [],
    undefined,
    partialInteractionSchema.parse(historical),
  )[0]!;
  expect(record.messages).toHaveLength(1);
  expect(observedSends(record)).toBe(1);
  expect(record.messages[0]!.sources).toHaveLength(2);
  expect(record.messages[0]!.alternateText?.[0]!.text).toBe("Sanitized QA representation");
});
it("holds mismatched historical direction and retains separate received messages", () => {
  const m = structuredClone(manifest);
  m.rows[0]!.interactions = [message];
  const h = structuredClone(historical);
  h.interactions[0]!.direction = "received";
  const record = projectEvidence([], "org", m, [], undefined, h)[0]!;
  expect(record.messages).toHaveLength(2);
  expect(record.messages.every((x) => x.conflict)).toBe(true);
  expect(observedSends(record)).toBe(0);
  h.interactions[0]!.message_id = "reply";
  const resolved = projectEvidence([], "org", m, [], undefined, h)[0]!;
  expect(resolved.messages).toHaveLength(2);
  expect(observedSends(resolved)).toBe(1);
});
it("actual Gmail drafts remain separate from messages and never count as sends", () => {
  const raw = structuredClone(manifest);
  raw.rows[0]!.prepared_message!.mailbox_draft_created = true;
  raw.rows[0]!.prepared_message!.to = [];
  raw.rows[0]!.interactions = [
    {
      type: "email_draft_saved",
      provider: "gmail",
      provider_draft_id: "d1",
      provider_message_id: "draft-m1",
      provider_thread_id: "draft-t1",
      from: message.from,
      to: [],
      subject: "QA prepared subject",
      body_plain_text_content_only: "UNSENT QA BODY",
      draft_only: true,
      sent_at: null,
      saved_message_timestamp: "2026-10-20T10:59:06-05:00",
      verified_at: "2026-10-20T16:00:45Z",
      source_url: "https://mail.google.com/mail/u/0/#drafts",
      verification: { body_matches: true, to_matches: true, from_matches: true, draft_only: true },
    },
  ];
  const record = projectEvidence([], "org", reviewManifestSchema.parse(raw))[0]!;
  expect(savedDrafts(record)).toHaveLength(1);
  expect(record.messages).toHaveLength(0);
  expect(observedSends(record)).toBe(0);
});

it("retains a team outbound copy without promoting it to an authorized-account send", () => {
  const h = structuredClone(historical);
  h.interactions[0]!.direction = "team_outbound_copy";
  const record = projectEvidence(
    [],
    "org",
    manifest,
    [],
    undefined,
    partialInteractionSchema.parse(h),
  )[0]!;
  record.coverage = {
    slug: "qa-company",
    url: manifest.rows[0]!.public_roadmap_url,
    status: "verified_roadmap_sent",
    gmail_history_complete: false,
    coverage_note: "QA deliberately mismatched claim",
    publication_checked_at: "2026-10-20T16:00:00Z",
    verified_sent_message_ids: [message.provider_message_id],
  };
  expect(record.messages[0]!.message.type).toBe("email_team_outbound_copy");
  expect(observedSends(record)).toBe(0);
  expect(roadmapSendVerified(record)).toBe(false);
});
it("fails closed on unknown historical direction instead of labeling it received", () => {
  const h = structuredClone(historical);
  expect(
    partialInteractionSchema.safeParse({
      ...h,
      interactions: [{ ...h.interactions[0], direction: "unknown" }],
    }).success,
  ).toBe(false);
});

it("blocks a proposed binding while a published contact identity conflict remains unresolved", () => {
  const publication = {
    checkedAt: "2026-10-20T16:26:46Z",
    sourceUrl: "https://trusttai.com/clients",
    entries: [
      {
        slug: "qa-company",
        name: "QA company",
        url: manifest.rows[0]!.public_roadmap_url,
        identityHold: "Identity conflict: greeting disagrees with correspondence",
      },
    ],
  };
  const records = projectEvidence(
    [native],
    "org",
    manifest,
    [
      {
        slug: "qa-company",
        roadmapId: native.id,
        organizationId: "org",
        reviewedBy: "QA",
        reviewedAt: "2026-10-20T16:00:00Z",
      },
    ],
    publication,
  );
  expect(records).toHaveLength(2);
  const source = records.find((r) => r.publication)!;
  expect(source.binding).toBe("pending");
  expect(evidenceHolds(source)).toContain(publication.entries[0]!.identityHold);
});

it("can apply a unique approved public-only binding without requiring a selected-batch draft", () => {
  const publication = {
    checkedAt: "2026-10-20T17:00:00Z",
    sourceUrl: "https://trusttai.com/clients",
    entries: [
      { slug: "qa-company", name: "QA company", url: "https://trusttai.com/clients/qa-company" },
    ],
  };
  const binding = {
    slug: "qa-company",
    roadmapId: native.id,
    organizationId: "org",
    reviewedBy: "QA reviewer",
    reviewedAt: "2026-10-20T17:00:00Z",
  };
  expect(projectEvidence([native], "org", undefined, [], publication)).toHaveLength(2);
  const records = projectEvidence([native], "org", undefined, [binding], publication);
  expect(records).toHaveLength(1);
  expect(records[0]!.binding).toBe("reviewed");
  expect(records[0]!.publication?.slug).toBe("qa-company");
  expect(records[0]!.native?.id).toBe(native.id);
  expect(projectEvidence([native], "org", undefined, [binding, binding], publication)).toHaveLength(
    2,
  );
});

it("supersedes draft state with a verified send while keeping its bounce distinct", () => {
  const input = structuredClone(manifest);
  input.rows[0]!.interactions = [
    {
      type: "email_draft_state_verified",
      provider: "gmail",
      provider_draft_id: "d1",
      provider_message_id: "draft-1",
      provider_thread_id: "t1",
      from: "tai@example.test",
      to: ["person@example.test"],
      subject: "Warm revision",
      body_exact: "Warm latest draft",
      body_format: "text/plain",
      draft_only: true,
      message_timestamp: "2026-10-20T17:00:00Z",
      verified_at: "2026-10-20T17:01:00Z",
      source_url: "https://mail.google.com/mail/u/0/#drafts",
    },
    { ...message, provider_draft_id: "d1" },
    {
      type: "email_delivery_failed",
      provider_message_id: "bounce1",
      provider_thread_id: "t1",
      occurred_at: "2026-10-20T17:19:48Z",
      smtp_status: "550 5.1.1",
      reason: "Recipient does not exist",
      source_url: "https://mail.google.com/mail/u/0/#all/bounce1",
    },
  ];
  const record = projectEvidence([], "org", reviewManifestSchema.parse(input))[0]!;
  expect(savedDrafts(record)).toHaveLength(0);
  expect(observedSends(record)).toBe(1);
  expect(record.messages).toHaveLength(1);
  expect(evidenceHolds(record).some((s) => s.includes("550 5.1.1"))).toBe(true);
});
it("shows only the latest verified warm draft revision and does not count it as a message", () => {
  const input = structuredClone(manifest);
  const draft = {
    type: "email_draft_state_verified" as const,
    provider: "gmail" as const,
    provider_draft_id: "d1",
    provider_message_id: "draft-1",
    provider_thread_id: "t1",
    from: "tai@example.test",
    to: [],
    subject: "Warm revision",
    body_exact: "Old revision",
    body_format: "text/plain" as const,
    draft_only: true as const,
    message_timestamp: "2026-10-20T17:00:00Z",
    verified_at: "2026-10-20T17:01:00Z",
    source_url: "https://mail.google.com/mail/u/0/#drafts",
  };
  input.rows[0]!.interactions = [
    draft,
    { ...draft, body_exact: "New warm revision", verified_at: "2026-10-20T17:02:00Z" },
  ];
  const record = projectEvidence([], "org", reviewManifestSchema.parse(input))[0]!;
  expect(savedDrafts(record)).toHaveLength(1);
  expect(savedDrafts(record)[0]?.body_plain_text_content_only).toBe("New warm revision");
  expect(record.messages).toHaveLength(0);
});
