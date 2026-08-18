/**
 * The Conductor's only writes.
 *
 * Three tables, all of them records of human judgement: decided outcomes,
 * figures a person recorded by hand, and corrections to the Conductor's own
 * answers. No room's truth is written here, and nothing in these tables is a
 * copy of something Scout, Comms, Roadmap, Projects or Ops already owns.
 *
 * Every read is scoped to one organization. A missing table is treated as an
 * empty ledger rather than an error, so the Conductor still answers, with the
 * gap named, before the migration in docs/conductor-v1-schema.sql is applied.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";
import type {
  BusinessFigure,
  BusinessIntent,
  ConductorCorrection,
  CorrectionKind,
} from "@/domain/conductor";

type Row = Record<string, unknown>;

function text(row: Row, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(row: Row, key: string): number | undefined {
  const value = row[key];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** A person, as far as this module is concerned. */
export interface Recorder {
  id: ID;
  label: string;
}

/* ------------------------------------------------------------- intents */

function toIntent(row: Row): BusinessIntent {
  const target = num(row, "target");
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    kind: (text(row, "kind") ?? "custom") as BusinessIntent["kind"],
    label: text(row, "label") ?? "Untitled outcome",
    ...(target !== undefined ? { target } : {}),
    ...(text(row, "unit") ? { unit: text(row, "unit")! } : {}),
    horizon: (text(row, "horizon") ?? "quarter") as BusinessIntent["horizon"],
    because: text(row, "because") ?? "",
    critical: row["critical"] === true,
    decidedBy: { id: String(row["decided_by"]), label: "You" },
    decidedAt: text(row, "decided_at") ?? new Date().toISOString(),
    basis: "decided",
  };
}

/** Outcomes still in force, newest first. Retired ones are left behind. */
export async function loadBusinessIntents(organizationId: ID): Promise<BusinessIntent[]> {
  const { data, error } = await supabase
    .from("business_intents")
    .select("*")
    .eq("organization_id", organizationId)
    .is("retired_at", null)
    .order("decided_at", { ascending: false });
  if (error) return [];
  return (data ?? []).map((row) => toIntent(row as Row));
}

export interface DecideIntentInput {
  organizationId: ID;
  kind: BusinessIntent["kind"];
  label: string;
  target?: number;
  unit?: string;
  horizon: BusinessIntent["horizon"];
  because: string;
  critical?: boolean;
  decidedBy: Recorder;
}

/** Record an outcome a person decided. Decided truth; nothing infers it. */
export async function decideIntent(input: DecideIntentInput): Promise<BusinessIntent> {
  const payload: Row = {
    organization_id: input.organizationId,
    kind: input.kind,
    label: input.label,
    horizon: input.horizon,
    because: input.because,
    critical: input.critical ?? false,
    decided_by: input.decidedBy.id,
  };
  if (input.target !== undefined) payload["target"] = input.target;
  if (input.unit) payload["unit"] = input.unit;

  const { data, error } = await supabase
    .from("business_intents")
    .insert(payload)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return toIntent((data ?? payload) as Row);
}

/** Take an outcome out of force without deleting the record of it. */
export async function retireIntent(id: ID, at = new Date().toISOString()): Promise<void> {
  const { error } = await supabase.from("business_intents").update({ retired_at: at }).eq("id", id);
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------- figures */

function toFigure(row: Row): BusinessFigure {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    key: text(row, "key") ?? "unknown",
    value: num(row, "value") ?? 0,
    ...(text(row, "unit") ? { unit: text(row, "unit")! } : {}),
    basis: text(row, "basis") === "observed" ? "observed" : "decided",
    asOf: text(row, "as_of") ?? new Date().toISOString(),
    ...(text(row, "note") ? { note: text(row, "note")! } : {}),
    recordedBy: { id: String(row["recorded_by"]), label: "You" },
    recordedAt: text(row, "recorded_at") ?? new Date().toISOString(),
  };
}

/**
 * Recorded figures for an organization, newest first.
 *
 * Read wide rather than filtered by key: the freshness and expiry rules live
 * in the pure layer, so the reader keeps every row and lets that layer decide
 * what may still be said today.
 */
export async function loadBusinessFigures(organizationId: ID): Promise<BusinessFigure[]> {
  const { data, error } = await supabase
    .from("business_figures")
    .select("*")
    .eq("organization_id", organizationId)
    .order("as_of", { ascending: false })
    .limit(200);
  if (error) return [];
  return (data ?? []).map((row) => toFigure(row as Row));
}

export interface RecordFigureInput {
  organizationId: ID;
  key: string;
  value: number;
  unit?: string;
  /** The date the figure was true, not the date it was typed. */
  asOf: string;
  note?: string;
  recordedBy: Recorder;
}

/** Append a figure. Nothing is overwritten; a newer as_of simply wins. */
export async function recordFigure(input: RecordFigureInput): Promise<BusinessFigure> {
  const payload: Row = {
    organization_id: input.organizationId,
    key: input.key,
    value: input.value,
    basis: "decided",
    as_of: input.asOf,
    recorded_by: input.recordedBy.id,
  };
  if (input.unit) payload["unit"] = input.unit;
  if (input.note) payload["note"] = input.note;

  const { data, error } = await supabase
    .from("business_figures")
    .insert(payload)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return toFigure((data ?? payload) as Row);
}

/* --------------------------------------------------------- corrections */

function toCorrection(row: Row): ConductorCorrection {
  const figure = row["figure"];
  const parsed =
    figure && typeof figure === "object"
      ? (figure as { key?: string; value?: number; unit?: string; asOf?: string })
      : undefined;
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    kind: (text(row, "kind") ?? "wrong_read") as CorrectionKind,
    ...(text(row, "answer_id") ? { answerId: text(row, "answer_id")! } : {}),
    ...(text(row, "question") ? { question: text(row, "question")! } : {}),
    ...(text(row, "subject_key") ? { subjectKey: text(row, "subject_key")! } : {}),
    ...(parsed && parsed.key && typeof parsed.value === "number"
      ? {
          figure: {
            key: parsed.key,
            value: parsed.value,
            ...(parsed.unit ? { unit: parsed.unit } : {}),
            asOf: parsed.asOf ?? text(row, "created_at") ?? new Date().toISOString(),
          },
        }
      : {}),
    note: text(row, "note") ?? "",
    correctedBy: { id: String(row["corrected_by"]), label: "You" },
    at: text(row, "created_at") ?? new Date().toISOString(),
  };
}

/** Every correction this organization has made, newest first. */
export async function loadCorrections(organizationId: ID): Promise<ConductorCorrection[]> {
  const { data, error } = await supabase
    .from("conductor_corrections")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return [];
  return (data ?? []).map((row) => toCorrection(row as Row));
}

export interface RecordCorrectionInput {
  organizationId: ID;
  kind: CorrectionKind;
  answerId?: string;
  question?: string;
  topic?: string;
  subjectKey?: string;
  figure?: { key: string; value: number; unit?: string; asOf: string };
  note: string;
  correctedBy: Recorder;
}

/**
 * Record a correction, and, when it corrects a number, record the number
 * itself as a decided figure in the same breath, so the next answer stands on
 * it rather than on the correction text.
 */
export async function recordCorrection(input: RecordCorrectionInput): Promise<ConductorCorrection> {
  const payload: Row = {
    organization_id: input.organizationId,
    kind: input.kind,
    note: input.note,
    corrected_by: input.correctedBy.id,
  };
  if (input.answerId) payload["answer_id"] = input.answerId;
  if (input.question) payload["question"] = input.question;
  if (input.topic) payload["topic"] = input.topic;
  if (input.subjectKey) payload["subject_key"] = input.subjectKey;
  if (input.figure) payload["figure"] = input.figure;

  const { data, error } = await supabase
    .from("conductor_corrections")
    .insert(payload)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (input.kind === "wrong_figure" && input.figure) {
    await recordFigure({
      organizationId: input.organizationId,
      key: input.figure.key,
      value: input.figure.value,
      ...(input.figure.unit ? { unit: input.figure.unit } : {}),
      asOf: input.figure.asOf,
      note: `Corrected: ${input.note}`.trim(),
      recordedBy: input.correctedBy,
    });
  }

  return toCorrection((data ?? payload) as Row);
}
