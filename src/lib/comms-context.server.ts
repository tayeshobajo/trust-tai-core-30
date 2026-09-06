/**
 * The bounded project context a reply is grounded in.
 *
 * A client conversation is not a series of isolated emails. It carries a
 * direction: what was promised, what is still open, what already went out.
 * The thread alone cannot show that, and dumping every record into the model
 * would drown the signal and invite invention.
 *
 * So this layer selects, it does not dump. Each source has its own small cap,
 * newest first, and the whole packet has a character budget. Every line is
 * labelled by where it came from, and evidence is kept apart from
 * interpretation: only evidence may be stated back to a person as fact.
 *
 * Everything is read with the caller's own token, so the organization's
 * existing row policies decide what is visible. A source that is empty or
 * unreadable is simply left out; nothing is inferred to fill a gap.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** One selected line of context, with its provenance kept explicit. */
export interface ContextLine {
  source: "client" | "project" | "communication";
  /** Evidence may be stated as fact. Interpretation may only inform the angle. */
  kind: "evidence" | "interpretation";
  text: string;
  /** When it happened, when the source records that. Used for chronology. */
  at?: string;
}

export interface RelationshipContext {
  lines: ContextLine[];
  /** A short read of where the work stands. Interpretation, never quoted as fact. */
  trajectory: string[];
}

/** Per-source caps, then one budget over the whole packet. */
const MAX_PROJECTS = 3;
const MAX_COMMUNICATIONS = 5;
const CHAR_BUDGET = 2000;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Trim the packet to its budget, keeping the newest and the client frame. */
export function withinBudget(lines: ContextLine[], budget = CHAR_BUDGET): ContextLine[] {
  const kept: ContextLine[] = [];
  let used = 0;
  for (const line of lines) {
    const cost = line.text.length + 1;
    if (used + cost > budget) continue;
    kept.push(line);
    used += cost;
  }
  return kept;
}

/** Oldest first, so the model reads the work in the order it happened. */
export function inChronology(lines: ContextLine[]): ContextLine[] {
  return [...lines].sort((left, right) => (left.at ?? "").localeCompare(right.at ?? ""));
}

/**
 * What has been promised, what is still open, what changed. Derived from the
 * selected lines only, and always returned as interpretation.
 */
export function readTrajectory(lines: ContextLine[]): string[] {
  const out: string[] = [];
  const projects = lines.filter((line) => line.source === "project");
  const sent = lines.filter((line) => line.source === "communication");
  if (projects.length > 0) {
    out.push(`Work in flight: ${projects.map((line) => line.text).join(" | ")}`);
  }
  if (sent.length > 0) {
    out.push(`Most recent thing that actually went out: ${sent[sent.length - 1]!.text}`);
  }
  if (projects.length === 0 && sent.length === 0) {
    out.push("No project record or verified outbound message yet, so the thread stands alone.");
  }
  return out;
}

/**
 * Build the packet for one relationship. Returns an empty packet rather than
 * throwing: thin context weakens a draft, it must never break drafting, and
 * the grounding gate upstream still decides whether a draft may exist at all.
 */
export async function loadRelationshipContext(
  supabase: SupabaseClient,
  input: { organizationId: string; clientId?: string | null; relationshipId: string },
): Promise<RelationshipContext> {
  const lines: ContextLine[] = [];

  if (input.clientId) {
    const { data: client } = await supabase
      .from("clients")
      .select("id, name, status")
      .eq("organization_id", input.organizationId)
      .eq("id", input.clientId)
      .maybeSingle();
    const row = (client ?? null) as Record<string, unknown> | null;
    if (row && text(row["name"])) {
      lines.push({
        source: "client",
        kind: "evidence",
        text: `Client: ${text(row["name"])}${text(row["status"]) ? ` (${text(row["status"])})` : ""}`,
      });
    }

    const { data: projects } = await supabase
      .from("projects")
      .select("id, name, status, point_b, next_move, updated_at")
      .eq("organization_id", input.organizationId)
      .eq("client_id", input.clientId)
      .order("updated_at", { ascending: false })
      .limit(MAX_PROJECTS);
    for (const project of ((projects ?? []) as Record<string, unknown>[])) {
      const name = text(project["name"]);
      if (!name) continue;
      const parts = [
        text(project["status"]) ? `status ${text(project["status"])}` : "",
        text(project["point_b"]) ? `aiming at ${text(project["point_b"])}` : "",
        text(project["next_move"]) ? `next move ${text(project["next_move"])}` : "",
      ].filter(Boolean);
      lines.push({
        source: "project",
        kind: "evidence",
        text: `Project ${name}${parts.length ? `: ${parts.join(", ")}` : ""}`,
        ...(text(project["updated_at"]) ? { at: text(project["updated_at"]) } : {}),
      });
    }
  }

  // Only communications the provider has proven. Unsent drafts are not memory.
  const { data: verified } = await supabase
    .from("activities")
    .select("summary, occurred_at")
    .eq("organization_id", input.organizationId)
    .eq("entity_type", "relationship")
    .eq("entity_id", input.relationshipId)
    .eq("event_type", "COMMS_MESSAGE_VERIFIED")
    .order("occurred_at", { ascending: false })
    .limit(MAX_COMMUNICATIONS);
  for (const row of ((verified ?? []) as Record<string, unknown>[])) {
    const summary = text(row["summary"]);
    if (!summary) continue;
    lines.push({
      source: "communication",
      kind: "evidence",
      text: summary,
      ...(text(row["occurred_at"]) ? { at: text(row["occurred_at"]) } : {}),
    });
  }

  const selected = inChronology(withinBudget(lines));
  return { lines: selected, trajectory: readTrajectory(selected) };
}
