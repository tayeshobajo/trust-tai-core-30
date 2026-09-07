/**
 * Trust Tai OS, acceptance criterion evidence.
 *
 * A checklist box records a human judgment. Evidence records why that judgment
 * can be trusted: the file somebody looked at, the page they checked, or the
 * sentence they wrote about what they saw.
 *
 * The laws that hold here:
 *
 *  1. Roadmap owns criterion evidence, the way it owns the criterion itself
 *     (Canon 17). The Project workroom and the Client workspace operate it
 *     through the same Roadmap service. There is no second evidence store.
 *  2. Evidence never completes anything. Attaching it does not check the
 *     criterion; checking the criterion does not require it. A person stays
 *     responsible for both.
 *  3. Evidence is optional by default. `required` exists on the contract so a
 *     future canonical rule can demand proof without breaking what is written
 *     today, and until such a rule exists nothing sets it.
 *  4. Absence is absence. No evidence reads as no evidence, never as unproven
 *     and never as proven.
 */

import type { ID, ISODateTime } from "./entities";

export type CriterionEvidenceType = "file" | "link" | "note";

export const EVIDENCE_TYPE_LABEL: Record<CriterionEvidenceType, string> = {
  file: "File",
  link: "Link",
  note: "Note",
};

export interface CriterionEvidence {
  id: ID;
  organizationId: ID;
  roadmapId: ID;
  milestoneId: ID;
  criterionId: ID;
  type: CriterionEvidenceType;
  /** What a reader sees: the file name, the page title, or the note itself. */
  label: string;
  /** Where it can be checked, for a link. */
  url?: string | undefined;
  /** The object path inside the private files bucket, for a file. */
  storagePath?: string | undefined;
  contentType?: string | undefined;
  sizeBytes?: number | undefined;
  /** The person's own words about what this proves. Optional on every type. */
  note?: string | undefined;
  createdBy: ID;
  createdByLabel?: string | undefined;
  createdAt: ISODateTime;
}

export interface CriterionEvidenceInput {
  type: CriterionEvidenceType;
  label: string;
  url?: string | undefined;
  note?: string | undefined;
}

export type EvidenceCheck =
  { ok: true; input: CriterionEvidenceInput } | { ok: false; refusal: string };

export const NO_EVIDENCE = "No evidence yet";

/** Attaching proof is never a decision, and never will be. */
export const EVIDENCE_IS_NOT_A_DECISION =
  "Evidence explains a judgment. Checking the condition is still a person's call.";

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

/** A link has to be somewhere a colleague could actually open. */
export function checkEvidenceUrl(raw: unknown): { ok: true; url: string } | { ok: false } {
  const url = clean(raw);
  if (!url) return { ok: false };
  if (!/^https?:\/\/\S+\.\S+/i.test(url)) return { ok: false };
  return { ok: true, url };
}

/** Fail closed before the database or the bucket is touched. */
export function checkEvidenceInput(raw: {
  type: CriterionEvidenceType;
  label?: unknown;
  url?: unknown;
  note?: unknown;
}): EvidenceCheck {
  const label = clean(raw.label);
  const note = clean(raw.note);

  if (raw.type === "link") {
    const url = checkEvidenceUrl(raw.url);
    if (!url.ok) {
      return { ok: false, refusal: "Paste the full address, starting with https://." };
    }
    return {
      ok: true,
      input: {
        type: "link",
        label: label || url.url,
        url: url.url,
        ...(note ? { note } : {}),
      },
    };
  }

  if (raw.type === "note") {
    const text = note || label;
    if (!text) return { ok: false, refusal: "Write what you saw, in one line." };
    if (text.length > 500) return { ok: false, refusal: "Keep the note short." };
    return { ok: true, input: { type: "note", label: text, note: text } };
  }

  if (!label) return { ok: false, refusal: "Choose a file to attach." };
  return { ok: true, input: { type: "file", label, ...(note ? { note } : {}) } };
}

/** Evidence for one criterion, newest last so the story reads forward. */
export function evidenceFor(rows: CriterionEvidence[], criterionId: ID): CriterionEvidence[] {
  return rows
    .filter((row) => row.criterionId === criterionId)
    .sort((a, b) =>
      a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1,
    );
}

/** One quiet line for a criterion row. */
export function evidenceSummary(rows: CriterionEvidence[]): string {
  if (rows.length === 0) return NO_EVIDENCE;
  return rows.length === 1 ? "1 evidence item" : `${rows.length} evidence items`;
}

/**
 * Whether this criterion must be proven before a person checks it.
 *
 * No canonical mechanism decides this yet, so the honest answer is always no.
 * The seam exists so a later rule can answer differently without a migration
 * of meaning.
 */
export function evidenceRequired(_criterion: { id: ID }): boolean {
  return false;
}

/** The stable key for one attached proof, used for replay protection. */
export function evidenceEventKey(criterionId: ID, input: CriterionEvidenceInput): string {
  const fingerprint = clean(input.url || input.label).toLowerCase();
  return `roadmap.criterion_evidence_added:${criterionId}:${input.type}:${fingerprint}`;
}

/** Where a file lives inside the existing private bucket. Org scoped, always. */
export function criterionEvidencePath(
  organizationId: ID,
  milestoneId: ID,
  criterionId: ID,
  fileName: string,
): string {
  const safe = fileName.replace(/[^\w.-]+/g, "-").slice(-120) || "file";
  const unique =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : String(Date.now());
  return `${organizationId}/criterion-evidence/${milestoneId}/${criterionId}/${unique}-${safe}`;
}

/** Whether this proof can be shown as a picture rather than described. */
export function isImageEvidence(item: {
  type: CriterionEvidenceType;
  contentType?: string | undefined;
  label?: string | undefined;
}): boolean {
  if (item.type !== "file") return false;
  if (item.contentType && /^image\//i.test(item.contentType)) return true;
  return /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(item.label ?? "");
}

/** The place a link points at, in the words a reader would use for it. */
export function evidenceLinkDomain(url?: string | undefined): string | null {
  const raw = clean(url);
  if (!raw) return null;
  try {
    return new URL(raw).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

/** File size a person can read at a glance. */
export function formatEvidenceSize(bytes?: number | undefined): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function evidenceDate(value?: string | undefined): string | null {
  if (!value) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** One quiet line under an evidence card: what it is, how big, when. */
export function evidenceMetaLine(item: CriterionEvidence): string {
  const parts: string[] = [];
  if (item.type === "link") {
    parts.push(evidenceLinkDomain(item.url) ?? EVIDENCE_TYPE_LABEL.link);
  } else {
    parts.push(EVIDENCE_TYPE_LABEL[item.type]);
  }
  const size = formatEvidenceSize(item.sizeBytes);
  if (size) parts.push(size);
  const at = evidenceDate(item.createdAt);
  if (at) parts.push(at);
  return parts.join(" · ");
}
