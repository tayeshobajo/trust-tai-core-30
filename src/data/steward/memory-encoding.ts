/**
 * How structured memory rides inside the existing belief ledger.
 *
 * `public.steward_beliefs` is already append only, already org-scoped by the
 * shared RLS helper, and already carries tier, authority, supersedes_id,
 * evidence and who recorded it. That is exactly the shape memory needs, so
 * Memory + Learning adds no table and no migration.
 *
 * The structured part (facet, person, pattern key, the value before a
 * correction) travels as one reserved entry in the belief's evidence array,
 * prefixed so it can never be mistaken for something a person should read. It
 * is stripped on the way out; a person only ever sees real evidence.
 */

import type { EvidenceRef } from "@/domain/confidence";
import type { Belief } from "@/domain/steward";
import type { MemoryBelief, MemoryDraft, MemoryMeta } from "@/domain/steward-memory";

const META_PREFIX = "steward-memory::";

export function encodeMeta(meta: MemoryMeta): EvidenceRef {
  return { kind: "computed", label: `${META_PREFIX}${JSON.stringify(meta)}` };
}

function decodeMeta(evidence: EvidenceRef[]): MemoryMeta | null {
  for (const ref of evidence) {
    if (typeof ref?.label !== "string" || !ref.label.startsWith(META_PREFIX)) continue;
    try {
      const parsed = JSON.parse(ref.label.slice(META_PREFIX.length)) as MemoryMeta;
      if (parsed && typeof parsed === "object" && typeof parsed.kind === "string") return parsed;
    } catch {
      /* A belief older than this encoding, or one written by hand. */
    }
  }
  return null;
}

/** Evidence a person is meant to read: everything except the encoded payload. */
export function visibleEvidence(evidence: EvidenceRef[]): EvidenceRef[] {
  return evidence.filter(
    (ref) => !(typeof ref?.label === "string" && ref.label.startsWith(META_PREFIX)),
  );
}

/** Beliefs written before this encoding still belong on the Memory page. */
function fallbackMeta(belief: Belief): MemoryMeta {
  return {
    kind: belief.authority === "human" ? "correction" : "person",
    facet: "other",
    ...(belief.subjectLabel ? { personName: belief.subjectLabel } : {}),
  };
}

/** Turn a stored belief into a memory row, payload decoded and hidden. */
export function toMemoryBelief(belief: Belief): MemoryBelief {
  return {
    ...belief,
    evidence: visibleEvidence(belief.evidence),
    meta: decodeMeta(belief.evidence) ?? fallbackMeta(belief),
  };
}

/** The evidence array actually written: real evidence plus the payload. */
export function draftEvidence(draft: MemoryDraft): EvidenceRef[] {
  return [...visibleEvidence(draft.evidence), encodeMeta(draft.meta)];
}

/* --------------------------------------------------------------- subjects */

export function personSubject(personKey: string): string {
  return `person:${personKey}`;
}

export function handoffSubject(personKey: string, counterpartKey: string): string {
  return `handoff:${personKey}>${counterpartKey}`;
}

export function projectSubject(label: string): string {
  return `project:${label.toLowerCase().trim()}`;
}

export function commitmentSubject(commitmentId: string): string {
  return `commitment:${commitmentId}`;
}
