/**
 * A relationship, written down.
 *
 * One readable summary of what Comms actually holds: who this is, what we
 * remember, what was promised, how the conversation is doing, and the next
 * move with its reason. It is assembled from existing reads only, so the
 * exported page can never claim more than the room does.
 */

import type { MemoryItem, Relationship, Touch } from "@/domain/comms";
import { TIER_LABEL } from "@/domain/comms";
import type { ConversationHealth, RelationshipStrengthRead } from "@/domain/comms-health";
import { HEALTH_LABEL, STRENGTH_LABEL } from "@/domain/comms-health";
import {
  COMMITMENT_OWNER_LABEL,
  commitmentsOf,
  effectiveIntent,
  INTENT_LABEL,
  isCommitment,
} from "@/domain/comms-interactions";
import { readTouchRecord } from "@/domain/comms-touch-record";

import type { NextRelationshipMove } from "./comms-next-move";

export interface RelationshipSummaryInput {
  relationship: Relationship;
  health: ConversationHealth;
  strength: RelationshipStrengthRead;
  move: NextRelationshipMove;
  touches?: Touch[];
  /** Who asked for the export, for the footer line. */
  exportedBy?: string;
  now?: Date;
}

export interface SummarySection {
  heading: string;
  lines: string[];
}

function dateLabel(value?: string): string {
  if (!value) return "not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "not recorded"
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function memoryLine(item: MemoryItem): string {
  const parts = [`${item.category ?? item.label}: ${item.value}`];
  parts.push(`(${TIER_LABEL[item.tier]}`);
  parts.push(item.addedBy ? `· ${item.addedBy})` : ")");
  return parts.join(" ").replace(" )", ")");
}

/** The sections an export shows, in the same order the rail reads. */
export function relationshipSummarySections(
  input: RelationshipSummaryInput,
): SummarySection[] {
  const { relationship, health, strength, move } = input;
  const now = input.now ?? new Date();
  const intent = effectiveIntent(relationship);

  const identity = [
    relationship.companyName ? `Company: ${relationship.companyName}` : null,
    relationship.email ? `Email: ${relationship.email}` : null,
    `Relationship type: ${INTENT_LABEL[intent]}`,
    relationship.metWhere ? `Met at: ${relationship.metWhere}` : null,
    relationship.metAt ? `Met on: ${dateLabel(relationship.metAt)}` : null,
    `Last interaction: ${dateLabel(relationship.lastTouchAt)}`,
  ].filter((line): line is string => Boolean(line));

  const memory = [...relationship.decided, ...relationship.observed, ...relationship.inferred]
    .filter((item) => !isCommitment(item))
    .map(memoryLine);

  const commitments = commitmentsOf(relationship).map((entry) => {
    const due = entry.due ? `due ${dateLabel(entry.due)}` : "no date set";
    return `${entry.text} (${COMMITMENT_OWNER_LABEL[entry.owner]} · ${due} · ${entry.status})`;
  });

  const interactions = (input.touches ?? [])
    .slice()
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    .slice(0, 10)
    .map((touch) => {
      const record = readTouchRecord((touch as { provenance?: unknown }).provenance);
      const mark = record.retracted ? " [retracted]" : record.edited ? " [edited]" : "";
      return `${dateLabel(touch.occurredAt)} · ${touch.channel} · ${touch.direction === "inbound" ? "them" : "us"}: ${touch.summary}${mark}`;
    });

  return [
    { heading: "Who this is", lines: identity },
    {
      heading: "What we know",
      lines: memory.length > 0 ? memory : ["Nothing is remembered yet."],
    },
    {
      heading: "Promises and commitments",
      lines: commitments.length > 0 ? commitments : ["Nothing is promised in either direction."],
    },
    {
      heading: "Next relationship move",
      lines: [
        `Action: ${move.action}`,
        `Why now: ${move.whyNow}`,
        `Goal: ${move.goal}`,
        `Urgency: ${move.needed ? move.urgency.replace(/_/g, " ") : "none"}`,
      ],
    },
    {
      heading: "Conversation health",
      lines: [`Status: ${HEALTH_LABEL[health.status]}`, ...health.reasons],
    },
    {
      heading: "Relationship strength",
      lines: [
        `Band: ${STRENGTH_LABEL[strength.band]}`,
        ...strength.factors.map((factor) => `${factor.label}: ${factor.value}`),
      ],
    },
    ...(interactions.length > 0
      ? [{ heading: "Recent interactions", lines: interactions }]
      : []),
    {
      heading: "About this summary",
      lines: [
        `Prepared ${now.toLocaleString()}${input.exportedBy ? ` by ${input.exportedBy}` : ""}.`,
        "Everything above is what Comms holds on the record. Nothing here is inferred beyond the stated tier.",
      ],
    },
  ];
}

/** Plain text, ready to copy into a message or a document. */
export function relationshipSummaryText(input: RelationshipSummaryInput): string {
  const sections = relationshipSummarySections(input);
  const title = `${input.relationship.fullName}${input.relationship.companyName ? ` · ${input.relationship.companyName}` : ""}`;
  const body = sections
    .map((section) => [section.heading.toUpperCase(), ...section.lines.map((line) => `- ${line}`)].join("\n"))
    .join("\n\n");
  return `${title}\nRelationship summary · Trust Tai OS\n\n${body}\n`;
}

export function summaryFileName(relationship: Relationship, now: Date = new Date()): string {
  const slug = relationship.fullName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const day = now.toISOString().slice(0, 10);
  return `${slug || "relationship"}-summary-${day}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A printable page. The browser's own print dialog turns this into a PDF, so
 * no rendering dependency is added and the export always matches what is shown.
 */
export function relationshipSummaryHtml(input: RelationshipSummaryInput): string {
  const sections = relationshipSummarySections(input);
  const title = `${input.relationship.fullName}${input.relationship.companyName ? ` · ${input.relationship.companyName}` : ""}`;
  const body = sections
    .map(
      (section) =>
        `<section><h2>${escapeHtml(section.heading)}</h2><ul>${section.lines
          .map((line) => `<li>${escapeHtml(line)}</li>`)
          .join("")}</ul></section>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>${escapeHtml(title)} · Relationship summary</title>
<style>
  :root { color-scheme: light; }
  body { margin: 40px; font-family: Inter, system-ui, sans-serif; color: #1b2233; line-height: 1.5; }
  h1 { font-family: "Cormorant Garamond", Georgia, serif; font-size: 30px; margin: 0 0 4px; }
  .eyebrow { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #6b7488; }
  section { margin-top: 22px; page-break-inside: avoid; }
  h2 { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #6b7488; margin: 0 0 6px; }
  ul { margin: 0; padding-left: 18px; }
  li { font-size: 13px; margin-bottom: 4px; }
  @media print { body { margin: 24mm 18mm; } }
</style></head>
<body>
  <p class="eyebrow">Trust Tai OS · Comms</p>
  <h1>${escapeHtml(title)}</h1>
  <p class="eyebrow">Relationship summary</p>
  ${body}
</body></html>`;
}
