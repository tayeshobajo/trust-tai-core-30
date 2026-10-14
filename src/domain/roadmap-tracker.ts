import type { Roadmap } from "./roadmap";
import { sha256 } from "./sha256";
import { outboundFingerprint, type OutboundPayload, type DeliveryState } from "./comms-delivery";

export const PIPELINE_STAGES = [
  "Ideation",
  "Draft",
  "Design",
  "Approved",
  "Sent",
  "Follow-up",
  "Conversation Ongoing",
  "Closed - Won",
  "Closed - Lost",
] as const;
export const TRACKER_COLUMNS = {
  project: "Project / Roadmap",
  priority: "Priority",
  pipelineStage: "Roadmap Stage",
  channel: "Comms Channel",
  conversationPosition: "Current Conversation Position",
  clientSignal: "Client Signal",
  keyLinks: "Key Links",
  dateSent: "Date Sent",
  lastMeaningfulUpdate: "Last Update Date",
  nextAction: "This Week's Goal / Next Action",
  dateClosed: "Date Closed",
  endOfWeekStatus: "End-of-Week Status",
  conversionDays: "Conversion Turnaround (Days)",
} as const;
export type TrackerField = keyof typeof TRACKER_COLUMNS;
export type TrackerCells = Record<TrackerField, string | null>;
export interface TrackerRow {
  sourceKey: string;
  row: number;
  cells: TrackerCells;
}
export interface TrackerSnapshot {
  fileId: string;
  fileName: string;
  sheet: string;
  modifiedAt: string;
  sha256: string;
  rows: TrackerRow[];
}
/** A reviewed binding is an explicit identity decision, never a fuzzy name match. */
export interface TrackerBinding {
  sourceKey: string;
  fileId: string;
  sheet: string;
  roadmapId: string;
  organizationId: string;
  reviewedBy: string;
  reviewedAt: string;
}
export interface TrackerState {
  fields: Partial<TrackerCells>;
  receipts: string[];
}
export interface TrackerPreviewRow {
  source: TrackerRow;
  roadmap: Roadmap | null;
  candidates: Roadmap[];
  proposed: Partial<TrackerCells>;
  conflicts: string[];
  holds: string[];
  receiptKey: string;
  expectedRevision: string | null;
  alreadyReviewed: boolean;
}
export const ELEVATE_EVIDENCE = {
  url: "https://mail.google.com/mail/u/?authuser=tayeshobajo%40gmail.com#all/1a0fe768c3425eb3",
  sentAt: "2026-10-02T21:12:56.000Z",
  reason:
    "Updated quote and forecast sent October 2. Reconcile the old send action before preparing outreach.",
};
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const present = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
export function trackerState(roadmap: Roadmap): TrackerState {
  const raw = roadmap.metadata["outreach_tracker"];
  if (!raw || typeof raw !== "object") return { fields: {}, receipts: [] };
  const state = raw as Partial<TrackerState>;
  return {
    fields: state.fields && typeof state.fields === "object" ? state.fields : {},
    receipts: Array.isArray(state.receipts) ? state.receipts.filter(present) : [],
  };
}
/** Includes values as well as updated_at: stale clocks cannot authorize a replacement. */
export function roadmapRevision(roadmap: Roadmap): string {
  return sha256(
    JSON.stringify([
      roadmap.id,
      roadmap.organizationId,
      roadmap.updatedAt,
      roadmap.status,
      roadmap.ownerUserId,
      roadmap.nextMove,
      roadmap.metadata,
    ]),
  );
}
export function isStaleElevate(row: TrackerRow): boolean {
  return normalize(row.cells.project ?? "") === "elevate" && present(row.cells.nextAction);
}
export function previewTracker(
  snapshot: TrackerSnapshot,
  roadmaps: Roadmap[],
  organizationId: string,
  bindings: TrackerBinding[] = [],
): TrackerPreviewRow[] {
  const scoped = roadmaps.filter((r) => r.organizationId === organizationId);
  return snapshot.rows.map((source) => {
    const candidates = scoped.filter(
      (r) => normalize(r.subjectLabel) === normalize(source.cells.project ?? ""),
    );
    const decisions = bindings.filter(
      (b) =>
        b.sourceKey === source.sourceKey &&
        b.fileId === snapshot.fileId &&
        b.sheet === snapshot.sheet &&
        b.organizationId === organizationId &&
        present(b.reviewedBy) &&
        present(b.reviewedAt),
    );
    const binding = decisions.length === 1 ? decisions[0] : undefined;
    const roadmap = binding ? (scoped.find((r) => r.id === binding.roadmapId) ?? null) : null;
    const holds: string[] = [];
    const conflicts: string[] = [];
    if (!roadmap)
      holds.push(
        candidates.length > 1 || decisions.length > 1
          ? "Ambiguous identity. Review the canonical roadmap binding."
          : "Canonical roadmap binding needs review. No record will be created.",
      );
    if (
      snapshot.rows.filter((r) => r.sourceKey === source.sourceKey).length !== 1 ||
      snapshot.rows.filter(
        (r) => normalize(r.cells.project ?? "") === normalize(source.cells.project ?? ""),
      ).length !== 1
    )
      holds.push("Duplicate source identity. Reconcile before binding.");
    if (
      binding &&
      bindings.some(
        (b) =>
          b !== binding &&
          b.organizationId === organizationId &&
          b.roadmapId === binding.roadmapId &&
          b.sourceKey !== source.sourceKey,
      )
    )
      holds.push("Multiple source identities target one roadmap. Reconcile the bindings.");
    if (!PIPELINE_STAGES.includes(source.cells.pipelineStage as (typeof PIPELINE_STAGES)[number]))
      holds.push("Unknown spreadsheet stage. Preserve it for review.");
    if (isStaleElevate(source)) holds.push(ELEVATE_EVIDENCE.reason);
    const state = roadmap ? trackerState(roadmap) : { fields: {}, receipts: [] };
    // Stable source identity and cell digest; a row's physical position is evidence, never identity.
    const receiptKey = sha256(
      JSON.stringify([
        snapshot.fileId,
        snapshot.sheet,
        source.sourceKey,
        Object.keys(TRACKER_COLUMNS).map((key) => source.cells[key as TrackerField]),
        roadmap?.id ?? null,
      ]),
    );
    const alreadyReviewed = state.receipts.includes(receiptKey);
    const proposed: Partial<TrackerCells> = {};
    if (!alreadyReviewed)
      for (const field of Object.keys(TRACKER_COLUMNS) as TrackerField[]) {
        const incoming = source.cells[field];
        if (!present(incoming) || field === "project") continue;
        // next_move remains canonical. An imported action is evidence requiring human reconciliation.
        if (field === "nextAction") {
          if (!isStaleElevate(source))
            holds.push("Review the source action against the existing next move.");
          continue;
        }
        const current = state.fields[field];
        if (present(current) && current !== incoming)
          conflicts.push(`${TRACKER_COLUMNS[field]} differs from the current human fact.`);
        else if (!present(current)) proposed[field] = incoming;
      }
    return {
      source,
      roadmap,
      candidates,
      proposed,
      conflicts,
      holds,
      receiptKey,
      expectedRevision: roadmap ? roadmapRevision(roadmap) : null,
      alreadyReviewed,
    };
  });
}
/** Pure review contract only. This preview release has no apply writer or retry loop. */
export function checkReviewedApply(
  preview: TrackerPreviewRow,
  current: Roadmap | null,
  reviewedReceipt: string | null,
): "readback_required" | "no_op" | "conflict" | "review_required" | "eligible_for_later_apply" {
  if (!current || !preview.roadmap) return "readback_required";
  if (
    current.id !== preview.roadmap.id ||
    current.organizationId !== preview.roadmap.organizationId
  )
    return "conflict";
  if (trackerState(current).receipts.includes(preview.receiptKey)) return "no_op";
  if (roadmapRevision(current) !== preview.expectedRevision) return "conflict";
  if (preview.holds.length || preview.conflicts.length || reviewedReceipt !== preview.receiptKey)
    return "review_required";
  return "eligible_for_later_apply";
}
export function trackerSummary(rows: TrackerRow[]) {
  const won = rows.filter((r) => r.cells.pipelineStage === "Closed - Won").length;
  const lost = rows.filter((r) => r.cells.pipelineStage === "Closed - Lost").length;
  const days = rows
    .filter((r) => r.cells.pipelineStage === "Closed - Won" && present(r.cells.conversionDays))
    .map((r) => Number(r.cells.conversionDays))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return {
    total: rows.length,
    won,
    lost,
    winRate: won + lost ? won / (won + lost) : null,
    averageDays: days.length ? days.reduce((a, b) => a + b, 0) / days.length : null,
  };
}
/** Preparation evidence references the existing Comms approval and delivery authority.
 * It cannot send or approve anything, including when all checks pass. */
export interface OutreachPreparation {
  roadmapId: string;
  organizationId: string;
  draftId: string;
  recipientVerifiedAt: string | null;
  recipientEvidence: string | null;
  payload: OutboundPayload;
  export: {
    id: string;
    roadmapId: string;
    version: string;
    digest: string;
    frozen: boolean;
    kind: "preview" | "priced_proposal";
  } | null;
  approval: {
    requestId: string;
    itemId: string;
    eventId: string;
    revision: number;
    status: string;
    fingerprint: string;
    expiresAt: string;
    maxSends: number;
  } | null;
  deliveryState: DeliveryState | "not_attempted";
}
export function preparationFingerprint(value: OutreachPreparation): string {
  return sha256(
    JSON.stringify([
      value.organizationId,
      value.roadmapId,
      value.draftId,
      outboundFingerprint(value.payload),
      value.export,
      value.approval?.revision,
    ]),
  );
}
export function preparationBlockers(
  row: TrackerPreviewRow,
  value: OutreachPreparation,
  now: string,
): string[] {
  const blockers = [...row.holds, ...row.conflicts];
  if (
    !row.roadmap ||
    row.roadmap.id !== value.roadmapId ||
    row.roadmap.organizationId !== value.organizationId
  )
    blockers.push("Verify the canonical roadmap.");
  if (
    !value.draftId ||
    !value.payload.body.trim() ||
    !value.payload.recipient.trim() ||
    !value.payload.senderIdentity
  )
    blockers.push("Link the exact Comms draft, recipient and sender.");
  if (
    !value.recipientEvidence ||
    !value.recipientVerifiedAt ||
    !Number.isFinite(Date.parse(value.recipientVerifiedAt))
  )
    blockers.push("Verify the recipient with evidence.");
  if (
    !value.export?.frozen ||
    value.export.roadmapId !== value.roadmapId ||
    !value.export.id ||
    !value.export.version ||
    !value.export.digest
  )
    blockers.push("Link an exact frozen roadmap export version.");
  const approval = value.approval;
  if (
    !approval ||
    !approval.requestId ||
    !approval.itemId ||
    !approval.eventId ||
    approval.status !== "approved" ||
    approval.maxSends !== 1 ||
    approval.fingerprint !== preparationFingerprint(value) ||
    !Number.isFinite(Date.parse(approval.expiresAt)) ||
    Date.parse(approval.expiresAt) <= Date.parse(now)
  )
    blockers.push("A current, bounded human approval must match this exact preparation.");
  if (value.deliveryState !== "not_attempted")
    blockers.push("Read the existing delivery receipt before any further attempt.");
  return blockers;
}
