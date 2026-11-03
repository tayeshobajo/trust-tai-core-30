/** Local integration candidate. Not mounted in any route and has no production adapter. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { resolveAppAccess, type AppAccessInput } from "@/domain/app-access";
const uuid = z.string().uuid();
export { correspondenceSchema } from "@/domain/roadmap-correspondence";
export type { Correspondence } from "@/domain/roadmap-correspondence";
import { correspondenceSchema, type Correspondence } from "@/domain/roadmap-correspondence";
export interface Principal extends AppAccessInput {
  userId: string;
  organizationId: string;
}
export interface CanonicalMapping {
  organizationId: string;
  roadmapId: string;
  relationshipId: string;
  roadmapRevision: string;
  relationshipRevision: string;
  identityHold: boolean;
  archived: boolean;
}
export interface Approval {
  id: string;
  organizationId: string;
  importerId: string;
  expiresAt: string;
  revoked: boolean;
  manifestDigest: string;
  approvedEventDigests: string[];
}
export interface StoredEvent {
  key: string;
  digest: string;
  event: Correspondence;
}
/** Implementations MUST use one transaction, lock approval/target rows, and enforce unique event keys. */
export interface CorrespondenceTransaction {
  principal(): Promise<Principal>;
  mapping(roadmapId: string): Promise<CanonicalMapping | null>;
  approval(id: string): Promise<Approval | null>;
  existing(key: string): Promise<StoredEvent | null>;
  insert(row: StoredEvent, approvalId: string): Promise<void>;
}
export interface CorrespondenceStore {
  transaction<T>(work: (tx: CorrespondenceTransaction) => Promise<T>): Promise<T>;
  /** Must perform access/mapping check and page read in a consistent transaction; never cache principal. */
  readPage(
    organizationId: string,
    roadmapId: string,
    after: string | null,
    limit: number,
  ): Promise<{
    principal: Principal;
    mapping: CanonicalMapping | null;
    rows: StoredEvent[];
    coverage: "partial" | "unknown";
    asOf: string | null;
  }>;
}
const roles = new Set([
  "owner",
  "admin",
  "leadership",
  "project_lead",
  "client_support",
  "team_member",
  "member",
  "viewer",
]);
export class CorrespondenceError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
function requireAccess(principal: Principal, org: string, write: boolean) {
  // Existing normalizeRole defaults unknown roles to member; this narrower boundary must fail closed.
  if (principal.organizationId !== org || !roles.has(principal.role ?? ""))
    throw new CorrespondenceError("access_denied");
  const access = resolveAppAccess("roadmap", principal);
  if (!access.visible || (write && !access.canWork)) throw new CorrespondenceError("access_denied");
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const digest = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");
// Account-scoped provider identity: same provider ID in two mailboxes is not silently merged.
export const eventKey = (event: Correspondence) =>
  digest([event.organizationId, event.channel, event.sourceAccountRef, event.sourceEventId]);
export const manifestDigest = (events: Correspondence[]) =>
  digest(events.map((e) => digest(e)).sort());
function validateEvent(input: unknown, now: Date): Correspondence {
  const parsed = correspondenceSchema.safeParse(input);
  if (!parsed.success) throw new CorrespondenceError("invalid_or_unreviewed_event");
  const e = parsed.data;
  if (
    e.channel === "email" &&
    (e.identityKind !== "provider_id" || e.timestampPrecision !== "exact")
  )
    throw new CorrespondenceError("email_provider_evidence_required");
  if (e.channel !== "email" && ["draft", "bounce", "team_outbound_copy"].includes(e.kind))
    throw new CorrespondenceError("unsupported_linkedin_event_kind");
  if ((e.channel === "email") !== (new URL(e.sourceUrl).hostname === "mail.google.com"))
    throw new CorrespondenceError("channel_source_mismatch");
  if (
    [e.occurredAt, e.verifiedAt, e.review.reviewedAt].some(
      (at) => Date.parse(at) > now.getTime(),
    ) ||
    Date.parse(e.review.reviewedAt) < Date.parse(e.verifiedAt)
  )
    throw new CorrespondenceError("invalid_review_time");
  // Defense in depth only, not a secret detector or substitute for human selection/redaction.
  if (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:access_token|api_key|password|client_secret)\s*[:=]\s*\S+|\bsk-[A-Za-z0-9_-]{16,}|<\/?(?:script|iframe|img)\b/i.test(
      `${e.subject}\n${e.bodyText}`,
    )
  )
    throw new CorrespondenceError("unsafe_content_review_required");
  return e;
}
function requireMapping(mapping: CanonicalMapping | null, event: Correspondence) {
  if (
    !mapping ||
    mapping.organizationId !== event.organizationId ||
    mapping.roadmapId !== event.roadmapId ||
    mapping.relationshipId !== event.relationshipId
  )
    throw new CorrespondenceError("canonical_mapping_mismatch");
  if (mapping.identityHold) throw new CorrespondenceError("identity_hold");
  if (
    mapping.roadmapRevision !== event.roadmapRevision ||
    mapping.relationshipRevision !== event.relationshipRevision
  )
    throw new CorrespondenceError("stale_mapping");
  // Archive state is intentionally untouched. Approved history may be retained for archived relationships.
}
export async function prepareCorrespondenceBatch(
  tx: CorrespondenceTransaction,
  input: unknown[],
  approvalId: string,
  now: Date,
) {
  if (!input.length || input.length > 250) throw new CorrespondenceError("invalid_batch_size");
  const events = input.map((e) => validateEvent(e, now));
  const org = events[0]!.organizationId;
  const principal = await tx.principal();
  requireAccess(principal, org, true);
  const approval = await tx.approval(approvalId);
  if (
    !approval ||
    approval.organizationId !== org ||
    approval.importerId !== principal.userId ||
    approval.revoked ||
    Date.parse(approval.expiresAt) <= now.getTime() ||
    !Number.isFinite(Date.parse(approval.expiresAt)) ||
    approval.manifestDigest !== manifestDigest(events)
  )
    throw new CorrespondenceError("batch_approval_required");
  const staged = new Map<string, StoredEvent>();
  const duplicates: string[] = [];
  for (const event of events) {
    if (event.organizationId !== org) throw new CorrespondenceError("mixed_organizations");
    if (!approval.approvedEventDigests.includes(digest(event)))
      throw new CorrespondenceError("event_not_approved");
    requireMapping(await tx.mapping(event.roadmapId), event);
    const row = { key: eventKey(event), digest: digest(event), event };
    const existing = staged.get(row.key) ?? (await tx.existing(row.key));
    if (existing) {
      if (existing.digest !== row.digest) throw new CorrespondenceError("conflicting_source_copy");
      duplicates.push(row.key);
    } else staged.set(row.key, row);
  }
  return { rows: [...staged.values()], duplicates, manifestDigest: approval.manifestDigest };
}
/** No route invokes this. A future adapter must satisfy transactional and RLS contract. */
export async function ingestCorrespondence(
  store: CorrespondenceStore,
  input: unknown[],
  approvalId: string,
  now: Date,
  dryRun = true,
) {
  return store.transaction(async (tx) => {
    const plan = await prepareCorrespondenceBatch(tx, input, approvalId, now);
    if (!dryRun) for (const row of plan.rows) await tx.insert(row, approvalId);
    // Return no bodies in dry-run receipts/logs.
    return {
      dryRun,
      insertCount: plan.rows.length,
      duplicateCount: plan.duplicates.length,
      manifestDigest: plan.manifestDigest,
      targets: plan.rows.map((r) => ({
        roadmapId: r.event.roadmapId,
        relationshipId: r.event.relationshipId,
        channel: r.event.channel,
        kind: r.event.kind,
        eventKey: r.key,
      })),
    };
  });
}
export async function readCorrespondencePage(
  store: CorrespondenceStore,
  organizationId: string,
  roadmapId: string,
  after: string | null = null,
  limit = 50,
) {
  if (
    !uuid.safeParse(organizationId).success ||
    !uuid.safeParse(roadmapId).success ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (after !== null && !/^[a-f0-9]{64}$/.test(after))
  )
    throw new CorrespondenceError("invalid_page_request");
  const page = await store.readPage(organizationId, roadmapId, after, limit + 1);
  requireAccess(page.principal, organizationId, false);
  if (
    !page.mapping ||
    page.mapping.organizationId !== organizationId ||
    page.mapping.roadmapId !== roadmapId ||
    page.mapping.identityHold
  )
    throw new CorrespondenceError("canonical_mapping_mismatch");
  // Fail closed on a faulty adapter: never return any cross-roadmap row, even within the same org.
  for (const row of page.rows)
    if (
      row.event.organizationId !== organizationId ||
      row.event.roadmapId !== roadmapId ||
      row.event.relationshipId !== page.mapping.relationshipId
    )
      throw new CorrespondenceError("read_scope_mismatch");
  const rows = page.rows.slice(0, limit);
  return {
    events: rows.map((r) => r.event),
    nextCursor: page.rows.length > limit ? rows.at(-1)!.key : null,
    coverage: page.coverage,
    asOf: page.asOf,
  };
}
