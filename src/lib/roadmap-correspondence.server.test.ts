import { expect, it } from "vitest";
import {
  digest,
  eventKey,
  manifestDigest,
  ingestCorrespondence,
  readCorrespondencePage,
  type Correspondence,
  type CorrespondenceStore,
  type Principal,
  type StoredEvent,
} from "./roadmap-correspondence.server";
const org = "00000000-0000-4000-8000-000000000001",
  roadmap = "00000000-0000-4000-8000-000000000002",
  relationship = "00000000-0000-4000-8000-000000000003",
  user = "00000000-0000-4000-8000-000000000004";
const now = new Date("2026-11-03T12:00:00Z");
const event: Correspondence = {
  organizationId: org,
  roadmapId: roadmap,
  relationshipId: relationship,
  roadmapRevision: "2026-11-03T00:00:00Z",
  relationshipRevision: "2026-11-03T00:00:00Z",
  channel: "email",
  kind: "sent",
  sourceAccountRef: "synthetic-account",
  sourceEventId: "synthetic-message",
  identityKind: "provider_id",
  sourceUrl: "https://mail.google.com/mail/u/0/#all/synthetic-message",
  occurredAt: "2026-11-02T10:00:00Z",
  timestampPrecision: "exact",
  verifiedAt: "2026-11-03T09:00:00Z",
  subject: "Synthetic roadmap",
  bodyText: "SYNTHETIC: Please review the roadmap milestone.",
  bodyRepresentation: "reviewed_redacted_excerpt",
  review: {
    reviewerId: user,
    reviewedAt: "2026-11-03T10:00:00Z",
    relevance: "roadmap_correspondence",
    identity: "verified",
    audience: "authorized_roadmap_team",
    unrelatedContentExcluded: true,
    quotedHistoryExcluded: true,
    secretsExcluded: true,
    attachmentsExcluded: true,
    sourceRef: "synthetic-review",
  },
};
function fixture(events: Correspondence[] = [event]) {
  const state = {
    principal: {
      userId: user,
      organizationId: org,
      role: "member",
      override: "work",
      membershipActive: true,
      organizationEnabled: true,
    } as Principal,
    mapping: {
      organizationId: org,
      roadmapId: roadmap,
      relationshipId: relationship,
      roadmapRevision: event.roadmapRevision,
      relationshipRevision: event.relationshipRevision,
      identityHold: false,
      archived: false,
    },
    approval: {
      id: "approval",
      organizationId: org,
      importerId: user,
      expiresAt: "2026-11-04T00:00:00Z",
      revoked: false,
      manifestDigest: manifestDigest(events),
      approvedEventDigests: events.map(digest),
    },
    rows: [] as StoredEvent[],
  };
  const store: CorrespondenceStore = {
    transaction: async (work) => {
      const pending: StoredEvent[] = [];
      const result = await work({
        principal: async () => state.principal,
        mapping: async () => state.mapping,
        approval: async () => state.approval,
        existing: async (key) => state.rows.find((r) => r.key === key) ?? null,
        insert: async (row) => {
          pending.push(row);
        },
      });
      state.rows.push(...pending);
      return result;
    },
    readPage: async (_org, _roadmap, after, limit) => ({
      principal: state.principal,
      mapping: state.mapping,
      rows: state.rows
        .filter((r) => !after || r.key > after)
        .sort((a, b) => a.key.localeCompare(b.key))
        .slice(0, limit),
      coverage: "partial",
      asOf: "2026-11-03T10:00:00Z",
    }),
  };
  return { state, store };
}
it("dry runs contain no bodies and never write; exact retry is idempotent", async () => {
  const { store, state } = fixture();
  const plan = await ingestCorrespondence(store, [event], "approval", now);
  expect(plan.insertCount).toBe(1);
  expect(JSON.stringify(plan)).not.toContain(event.bodyText);
  expect(state.rows).toHaveLength(0);
  await ingestCorrespondence(store, [event], "approval", now, false);
  expect((await ingestCorrespondence(store, [event], "approval", now, false)).duplicateCount).toBe(
    1,
  );
  expect(state.rows).toHaveLength(1);
});
it.each([
  { membershipActive: false },
  { organizationEnabled: false },
  { role: "unknown" },
  { override: "hidden" },
  { organizationId: relationship },
  { role: "viewer" },
])("rejects unauthorized ingestion %o", async (patch) => {
  const { store, state } = fixture();
  Object.assign(state.principal, patch);
  await expect(ingestCorrespondence(store, [event], "approval", now, false)).rejects.toThrow(
    "access_denied",
  );
  expect(state.rows).toHaveLength(0);
});
it.each([
  { revoked: true },
  { expiresAt: "2026-11-01T00:00:00Z" },
  { importerId: relationship },
  { approvedEventDigests: [] },
  { manifestDigest: "changed" },
])("rejects unapproved batch %o", async (patch) => {
  const { store, state } = fixture();
  Object.assign(state.approval, patch);
  await expect(ingestCorrespondence(store, [event], "approval", now, false)).rejects.toThrow();
  expect(state.rows).toHaveLength(0);
});
it.each([
  { identityHold: true },
  { relationshipId: roadmap },
  { organizationId: roadmap },
  { roadmapRevision: "2026-11-01T00:00:00Z" },
])("blocks stale or held mappings %o", async (patch) => {
  const { store, state } = fixture();
  Object.assign(state.mapping, patch);
  await expect(ingestCorrespondence(store, [event], "approval", now, false)).rejects.toThrow();
  expect(state.rows).toHaveLength(0);
});
it("preserves archives, separate mailboxes and distinct event kinds without claiming delivery", async () => {
  const events = [
    event,
    { ...event, sourceAccountRef: "second-mailbox" },
    { ...event, sourceEventId: "bounce", kind: "bounce" as const },
    { ...event, sourceEventId: "draft", kind: "draft" as const },
  ];
  const { store, state } = fixture(events);
  state.mapping.archived = true;
  expect((await ingestCorrespondence(store, events, "approval", now, false)).insertCount).toBe(4);
  expect(state.mapping.archived).toBe(true);
  expect((await readCorrespondencePage(store, org, roadmap)).coverage).toBe("partial");
});
it("fails atomically on conflicting copies, retaining original", async () => {
  const { store, state } = fixture();
  await ingestCorrespondence(store, [event], "approval", now, false);
  const changed = { ...event, bodyText: "Different copy" };
  state.approval.manifestDigest = manifestDigest([changed]);
  state.approval.approvedEventDigests = [digest(changed)];
  await expect(ingestCorrespondence(store, [changed], "approval", now, false)).rejects.toThrow(
    "conflicting_source_copy",
  );
  expect(state.rows[0]!.event.bodyText).toBe(event.bodyText);
});
it.each([
  { bodyText: "password=EXAMPLE_SECRET" },
  { bodyText: '<img src="https://example.test/pixel">' },
  { attachments: ["unrelated"] },
  { sourceUrl: "https://evil.test/message" },
  { sourceUrl: "https://mail.google.com/?access_token=secret" },
  { review: { ...event.review, quotedHistoryExcluded: false } },
])("rejects unsafe/unreviewed input %o", async (patch) => {
  const { store, state } = fixture();
  await expect(
    ingestCorrespondence(store, [{ ...event, ...patch }], "approval", now, false),
  ).rejects.toThrow();
  expect(state.rows).toHaveLength(0);
});
it("does not invent LinkedIn provider IDs or infer coverage", async () => {
  const li: Correspondence = {
    ...event,
    channel: "linkedin",
    sourceUrl: "https://www.linkedin.com/in/synthetic/",
    identityKind: "reviewed_receipt",
    sourceEventId: "reviewed-ui-receipt-1",
    timestampPrecision: "approximate",
  };
  const { store } = fixture([li]);
  await ingestCorrespondence(store, [li], "approval", now, false);
  const page = await readCorrespondencePage(store, org, roadmap);
  expect(page.events[0]!.timestampPrecision).toBe("approximate");
  expect(page.coverage).toBe("partial");
});
it("rechecks access every page and rejects cross-roadmap bodies from a faulty adapter", async () => {
  const { store, state } = fixture();
  await ingestCorrespondence(store, [event], "approval", now, false);
  state.principal.membershipActive = false;
  await expect(readCorrespondencePage(store, org, roadmap)).rejects.toThrow("access_denied");
  state.principal.membershipActive = true;
  state.rows[0]!.event = { ...event, roadmapId: relationship };
  await expect(readCorrespondencePage(store, org, roadmap)).rejects.toThrow("read_scope_mismatch");
});
it("paginates without falsely claiming complete history", async () => {
  const events = [event, { ...event, sourceEventId: "second" }];
  const { store } = fixture(events);
  await ingestCorrespondence(store, events, "approval", now, false);
  const first = await readCorrespondencePage(store, org, roadmap, null, 1);
  expect(first.events).toHaveLength(1);
  expect(first.nextCursor).toBeTruthy();
  const second = await readCorrespondencePage(store, org, roadmap, first.nextCursor, 1);
  expect(second.events).toHaveLength(1);
  expect(second.nextCursor).toBeNull();
  expect(eventKey(first.events[0]!)).not.toBe(eventKey(second.events[0]!));
  expect(second.coverage).toBe("partial");
});
it("preserves Sales Navigator separately from ordinary LinkedIn and email", async () => {
  const nav: Correspondence = {
    ...event,
    channel: "linkedin_sales_navigator",
    sourceUrl: "https://www.linkedin.com/sales/inbox",
    identityKind: "reviewed_receipt",
    sourceEventId: "synthetic-navigator-receipt",
    timestampPrecision: "approximate",
  };
  const ordinary: Correspondence = {
    ...nav,
    channel: "linkedin",
    sourceUrl: "https://www.linkedin.com/messaging/",
  };
  const { store } = fixture([nav, ordinary]);
  expect(
    (await ingestCorrespondence(store, [nav, ordinary], "approval", now, false)).insertCount,
  ).toBe(2);
  const page = await readCorrespondencePage(store, org, roadmap);
  expect(new Set(page.events.map((e) => e.channel))).toEqual(
    new Set(["linkedin_sales_navigator", "linkedin"]),
  );
  expect(page.coverage).toBe("partial");
});
it("rejects a mixed-organization batch before inserting any prepared event", async () => {
  const other = { ...event, organizationId: relationship, sourceEventId: "other-org" };
  const { store, state } = fixture([event, other]);
  await expect(ingestCorrespondence(store, [event, other], "approval", now, false)).rejects.toThrow(
    "mixed_organizations",
  );
  expect(state.rows).toHaveLength(0);
});
it("allows an explicitly authorized team viewer to read but not ingest", async () => {
  const { store, state } = fixture();
  await ingestCorrespondence(store, [event], "approval", now, false);
  state.principal.role = "viewer";
  state.principal.override = "view";
  expect((await readCorrespondencePage(store, org, roadmap)).events).toHaveLength(1);
  await expect(ingestCorrespondence(store, [event], "approval", now, false)).rejects.toThrow(
    "access_denied",
  );
});
it("propagates a failed read instead of returning empty history", async () => {
  const { store } = fixture();
  store.readPage = async () => {
    throw new Error("database unavailable");
  };
  await expect(readCorrespondencePage(store, org, roadmap)).rejects.toThrow("database unavailable");
});

it("honors verified existing role defaults without requiring new member grants", async () => {
  const { store, state } = fixture();
  state.principal.override = null;
  expect((await ingestCorrespondence(store, [event], "approval", now)).insertCount).toBe(1);
  state.principal.role = "viewer";
  await expect(ingestCorrespondence(store, [event], "approval", now)).rejects.toThrow(
    "access_denied",
  );
});
