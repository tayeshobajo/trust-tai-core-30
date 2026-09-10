/**
 * Website room, read side.
 *
 * Read-only by design. The Website room shows what TrustTai.com observed and
 * what Scout has since decided; it never edits either. Writes into these
 * tables happen only through the signed server receiver.
 *
 * If the tables have not been applied yet (docs/website-signals-schema.sql)
 * the readers return `provisioned: false` rather than throwing, and the room
 * says so plainly instead of showing invented numbers.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import {
  EMPTY_STRUCTURED,
  isWebsiteEventName,
  type WebsiteEvent,
  type WebsiteSubmission,
} from "@/domain/website";

import { missingRelation, type Provisioned } from "./settings-service";
import type { Row } from "./schema";

const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number | null => (typeof value === "number" ? value : null);

function toSubmission(row: Row, scoutStatus: string | null): WebsiteSubmission {
  const attribution = obj(row["attribution"]);
  const structured = obj(row["structured"]);
  const signals = obj(row["signals"]);
  const consent = obj(row["consent"]);
  const person = obj(row["person"]);
  const company = obj(row["company"]);

  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    submissionId: String(row["submission_id"]),
    sourceApp: String(row["source_app"] ?? "website"),
    sourceChannel: String(row["source_channel"] ?? "website"),
    sourceType: String(row["source_type"] ?? "roadmap_intake"),
    submittedAt: String(row["submitted_at"]),
    startedAt: text(row["started_at"]),
    receivedAt: String(row["received_at"] ?? row["created_at"] ?? row["submitted_at"]),
    attribution: {
      landingPath: text(attribution["landing_path"]),
      entryReferrer: text(attribution["entry_referrer"]),
      utm: obj(attribution["utm"]) as Record<string, string>,
      gclid: text(attribution["gclid"]),
      fbclid: text(attribution["fbclid"]),
      sessionId: text(attribution["session_id"]),
      pageViewsBeforeStart: num(attribution["page_views_before_start"]),
      device: text(attribution["device"]),
      locale: text(attribution["locale"]),
    },
    person: {
      name: text(person["name"]),
      email: text(person["email"]),
      phone: text(person["phone"]),
      role: text(person["role"]),
    },
    company: {
      name: text(company["name"]),
      website: text(company["website"]),
      industryStated: text(company["industry_stated"]),
      sizeStated: text(company["size_stated"]),
      locationStated: text(company["location_stated"]),
    },
    verbatim: (Array.isArray(row["verbatim"]) ? (row["verbatim"] as Row[]) : []).map((entry) => ({
      questionId: String(entry["question_id"] ?? ""),
      questionText: String(entry["question_text"] ?? ""),
      answerText: String(entry["answer_text"] ?? ""),
      modality: entry["modality"] === "voice" ? "voice" : "text",
      mediaUrl: text(entry["media_url"]),
      answeredAt: text(entry["answered_at"]),
      skipped: entry["skipped"] === true,
    })),
    structured: {
      ...EMPTY_STRUCTURED,
      currentState: strings(structured["current_state"]),
      desiredFuture: strings(structured["desired_future"]),
      pains: strings(structured["pains"]),
      goals: strings(structured["goals"]),
      constraints: strings(structured["constraints"]),
      existingAssets: strings(structured["existing_assets"]),
      ideas: strings(structured["ideas"]),
      openQuestions: strings(structured["open_questions"]),
    },
    signals: {
      frame: text(signals["frame"]),
      frameConfidence: num(signals["frame_confidence"]),
      objectiveCoverage: num(signals["objective_coverage"]),
      completeness: num(signals["completeness"]),
      authorizesResearch:
        typeof signals["authorizes_research"] === "boolean"
          ? (signals["authorizes_research"] as boolean)
          : null,
    },
    consent: {
      marketingOptIn:
        typeof consent["marketing_opt_in"] === "boolean"
          ? (consent["marketing_opt_in"] as boolean)
          : null,
      privacyVersion: text(consent["privacy_version"]),
    },
    scoutProspectId: text(row["scout_prospect_id"]),
    linkState: row["link_state"] === "linked" ? "linked" : "unlinked",
    linkReason: String(row["link_reason"] ?? ""),
    scoutStatus,
  };
}

/** Submissions for this organization, newest first, with Scout's own state. */
export async function listWebsiteSubmissions(
  organizationId: string,
  limit = 200,
): Promise<Provisioned<WebsiteSubmission[]>> {
  const result = await supabase
    .from("website_intake_submissions")
    .select("*")
    .eq("organization_id", organizationId)
    .order("submitted_at", { ascending: false })
    .limit(limit);

  if (result.error) {
    if (missingRelation(result.error)) return { provisioned: false, value: [] };
    throw new Error(result.error.message);
  }

  const rows = (result.data ?? []) as Row[];
  const prospectIds = [
    ...new Set(
      rows.map((row) => text(row["scout_prospect_id"])).filter((id): id is string => !!id),
    ),
  ];

  const states = new Map<string, string>();
  if (prospectIds.length > 0) {
    const scout = await supabase
      .from("prospects")
      .select("id, status")
      .eq("organization_id", organizationId)
      .in("id", prospectIds);
    if (!scout.error) {
      for (const row of (scout.data ?? []) as Row[]) {
        states.set(String(row["id"]), String(row["status"] ?? ""));
      }
    }
  }

  return {
    provisioned: true,
    value: rows.map((row) => {
      const prospectId = text(row["scout_prospect_id"]);
      return toSubmission(row, prospectId ? (states.get(prospectId) ?? null) : null);
    }),
  };
}

/** One submission, with the company name Scout holds for it. */
export async function getWebsiteSubmission(
  organizationId: string,
  submissionRowId: string,
): Promise<{ submission: WebsiteSubmission; prospectName: string | null } | null> {
  const result = await supabase
    .from("website_intake_submissions")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", submissionRowId)
    .maybeSingle();

  if (result.error) {
    if (missingRelation(result.error)) return null;
    throw new Error(result.error.message);
  }
  if (!result.data) return null;

  const row = result.data as Row;
  const prospectId = text(row["scout_prospect_id"]);
  let status: string | null = null;
  let prospectName: string | null = null;
  if (prospectId) {
    const scout = await supabase
      .from("prospects")
      .select("status, company_name")
      .eq("id", prospectId)
      .maybeSingle();
    if (!scout.error && scout.data) {
      const found = scout.data as Row;
      status = String(found["status"] ?? "") || null;
      prospectName = String(found["company_name"] ?? "") || null;
    }
  }

  return { submission: toSubmission(row, status), prospectName };
}

/** Raw attention events. The room aggregates; nothing is inferred here. */
export async function listWebsiteEvents(
  organizationId: string,
  sinceIso: string,
  limit = 5000,
): Promise<Provisioned<WebsiteEvent[]>> {
  const result = await supabase
    .from("website_events")
    .select("*")
    .eq("organization_id", organizationId)
    .gte("occurred_at", sinceIso)
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (result.error) {
    if (missingRelation(result.error)) return { provisioned: false, value: [] };
    throw new Error(result.error.message);
  }

  const value = ((result.data ?? []) as Row[])
    .filter((row) => isWebsiteEventName(row["event_name"]))
    .map((row) => ({
      id: String(row["id"]),
      organizationId: String(row["organization_id"]),
      eventName: row["event_name"] as WebsiteEvent["eventName"],
      occurredAt: String(row["occurred_at"]),
      sessionId: text(row["session_id"]),
      eventKey: String(row["event_key"]),
      path: text(row["path"]),
      referrer: text(row["referrer"]),
      utm: obj(row["utm"]) as Record<string, string>,
      device: text(row["device"]),
      submissionId: text(row["submission_id"]),
      questionId: text(row["question_id"]),
      modality:
        row["modality"] === "voice"
          ? ("voice" as const)
          : row["modality"] === "text"
            ? ("text" as const)
            : null,
      properties: obj(row["properties"]),
    }));

  return { provisioned: true, value };
}

/** The inbound submissions behind one Scout prospect. Used by Scout itself. */
export async function submissionsForProspect(
  organizationId: string,
  prospectId: string,
): Promise<WebsiteSubmission[]> {
  const result = await supabase
    .from("website_intake_submissions")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("scout_prospect_id", prospectId)
    .order("submitted_at", { ascending: false });
  if (result.error) return [];
  return ((result.data ?? []) as Row[]).map((row) => toSubmission(row, null));
}
