/**
 * Scout intro templates, the human-authored messages the Scout agent may
 * draft FROM.
 *
 * Templates are configuration. A person writes them and a person edits them;
 * every draft produced from one still lands in `comms_drafts` for human
 * review, and nothing here sends.
 *
 * The weekly intro cap is NOT stored here. It lives in
 * `organization_activity_targets` under stream = 'scout_intros'
 * (see `activity-targets.ts`).
 *
 * Writes go through the authenticated browser client, so RLS applies as the
 * signed-in person and the organization boundary is enforced by the database.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";

type Row = Record<string, unknown>;

/** Advisory scheduling window, e.g. days 1-5, 08:00-18:00 America/Chicago. */
export interface SendWindow {
  /** ISO weekday numbers, 1 = Monday .. 7 = Sunday. */
  days?: number[];
  start_hour?: number;
  end_hour?: number;
  tz?: string;
}

export interface ScoutIntroTemplate {
  id: ID;
  organizationId: ID;
  name: string;
  subject: string | null;
  body: string;
  active: boolean;
  sendWindow: SendWindow;
  createdBy: ID | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ScoutIntroTemplateInput {
  name: string;
  subject?: string | null;
  body: string;
  active?: boolean;
  sendWindow?: SendWindow;
}

export interface ScoutIntroTemplatesContext {
  organizationId: ID;
  userId: ID;
}

function assertOk(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

function toTemplate(row: Row): ScoutIntroTemplate {
  const window =
    row["send_window"] && typeof row["send_window"] === "object" && !Array.isArray(row["send_window"])
      ? (row["send_window"] as SendWindow)
      : {};
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    name: String(row["name"] ?? ""),
    subject: typeof row["subject"] === "string" ? row["subject"] : null,
    body: String(row["body"] ?? ""),
    active: row["active"] !== false,
    sendWindow: window,
    createdBy: typeof row["created_by"] === "string" ? row["created_by"] : null,
    createdAt: typeof row["created_at"] === "string" ? row["created_at"] : null,
    updatedAt: typeof row["updated_at"] === "string" ? row["updated_at"] : null,
  };
}

function validate(input: ScoutIntroTemplateInput): string[] {
  const problems: string[] = [];
  if (!input.name || !input.name.trim()) problems.push("A template needs a name.");
  if (!input.body || !input.body.trim()) problems.push("A template needs a body.");
  const window = input.sendWindow ?? {};
  if (window.days && window.days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
    problems.push("Send window days must be whole numbers from 1 (Monday) to 7 (Sunday).");
  }
  for (const [label, hour] of [
    ["start hour", window.start_hour],
    ["end hour", window.end_hour],
  ] as const) {
    if (hour !== undefined && (!Number.isInteger(hour) || hour < 0 || hour > 23)) {
      problems.push(`Send window ${label} must be a whole hour from 0 to 23.`);
    }
  }
  if (
    typeof window.start_hour === "number" &&
    typeof window.end_hour === "number" &&
    window.start_hour >= window.end_hour
  ) {
    problems.push("The send window must start before it ends.");
  }
  return problems;
}

export async function listScoutIntroTemplates(organizationId: ID): Promise<ScoutIntroTemplate[]> {
  const { data, error } = await supabase
    .from("scout_intro_templates")
    .select("*")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false });
  assertOk(error);
  return ((data as Row[]) ?? []).map(toTemplate);
}

export async function createScoutIntroTemplate(
  input: ScoutIntroTemplateInput,
  context: ScoutIntroTemplatesContext,
): Promise<ScoutIntroTemplate> {
  const problems = validate(input);
  if (problems.length > 0) throw new Error(problems.join(" "));

  const { data, error } = await supabase
    .from("scout_intro_templates")
    .insert({
      organization_id: context.organizationId,
      name: input.name.trim(),
      subject: input.subject?.trim() || null,
      body: input.body,
      active: input.active ?? true,
      send_window: input.sendWindow ?? {},
      created_by: context.userId,
    })
    .select("*")
    .single();
  assertOk(error);
  return toTemplate((data as Row) ?? {});
}

export async function updateScoutIntroTemplate(
  templateId: ID,
  input: Partial<ScoutIntroTemplateInput>,
  context: ScoutIntroTemplatesContext,
): Promise<ScoutIntroTemplate> {
  const patch: Row = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new Error("A template needs a name.");
    patch["name"] = input.name.trim();
  }
  if (input.subject !== undefined) patch["subject"] = input.subject?.trim() || null;
  if (input.body !== undefined) {
    if (!input.body.trim()) throw new Error("A template needs a body.");
    patch["body"] = input.body;
  }
  if (input.active !== undefined) patch["active"] = input.active;
  if (input.sendWindow !== undefined) {
    const problems = validate({ name: "x", body: "x", sendWindow: input.sendWindow });
    if (problems.length > 0) throw new Error(problems.join(" "));
    patch["send_window"] = input.sendWindow;
  }

  const { data, error } = await supabase
    .from("scout_intro_templates")
    .update(patch)
    .eq("id", templateId)
    .eq("organization_id", context.organizationId)
    .select("*")
    .single();
  assertOk(error);
  return toTemplate((data as Row) ?? {});
}

export async function deleteScoutIntroTemplate(
  templateId: ID,
  context: ScoutIntroTemplatesContext,
): Promise<void> {
  const { error } = await supabase
    .from("scout_intro_templates")
    .delete()
    .eq("id", templateId)
    .eq("organization_id", context.organizationId);
  assertOk(error);
}
