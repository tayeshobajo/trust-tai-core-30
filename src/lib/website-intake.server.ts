/**
 * The Website → Scout receiver (server only).
 *
 * TrustTai.com calls this server-to-server with a shared secret and an HMAC
 * signature. Nothing here trusts the caller for identity: the organization is
 * server configuration, not payload, so a submission can never be injected
 * into another organization's workspace.
 *
 * What it does, in order, and nothing more:
 *   verify signature → validate shape → upsert the raw submission by
 *   `submission_id` → resolve Scout identity on evidence → link or hold →
 *   write one activity row. It never creates a Roadmap, a Project, or a
 *   qualification.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  matchProspect,
  subjectDomain,
  type MatchCandidate,
} from "@/domain/website-matching";
import {
  EMPTY_STRUCTURED,
  WEBSITE_INTAKE_LABEL,
  WEBSITE_SOURCE_APP,
  WEBSITE_SOURCE_CHANNEL,
  WEBSITE_SOURCE_TYPE,
  isWebsiteEventName,
  type WebsiteStructured,
} from "@/domain/website";
import { trustTaiSupabaseUrl } from "@/lib/trust-tai-backend.server";

/* --------------------------------------------------------------- contract */

const list = z.array(z.string().max(4000)).max(200).optional();

export const IntakeBody = z.object({
  source_app: z.literal("website"),
  source_channel: z.literal("website"),
  source_type: z.literal("roadmap_intake"),
  submission_id: z.string().min(1).max(200),
  submitted_at: z.string().min(4).max(40),
  started_at: z.string().min(4).max(40).optional().nullable(),
  organization_id: z.string().uuid().optional(),
  attribution: z
    .object({
      landing_path: z.string().max(2000).optional().nullable(),
      entry_referrer: z.string().max(2000).optional().nullable(),
      utm: z
        .object({
          source: z.string().max(200).optional().nullable(),
          medium: z.string().max(200).optional().nullable(),
          campaign: z.string().max(200).optional().nullable(),
          term: z.string().max(200).optional().nullable(),
          content: z.string().max(200).optional().nullable(),
        })
        .optional()
        .nullable(),
      gclid: z.string().max(300).optional().nullable(),
      fbclid: z.string().max(300).optional().nullable(),
      session_id: z.string().max(200).optional().nullable(),
      page_views_before_start: z.number().int().min(0).max(10000).optional().nullable(),
      device: z.string().max(80).optional().nullable(),
      locale: z.string().max(40).optional().nullable(),
    })
    .default({}),
  person: z
    .object({
      name: z.string().max(200).optional().nullable(),
      email: z.string().max(320).optional().nullable(),
      phone: z.string().max(80).optional().nullable(),
      role: z.string().max(200).optional().nullable(),
    })
    .default({}),
  company: z
    .object({
      name: z.string().max(300).optional().nullable(),
      website: z.string().max(500).optional().nullable(),
      industry_stated: z.string().max(300).optional().nullable(),
      size_stated: z.string().max(120).optional().nullable(),
      location_stated: z.string().max(300).optional().nullable(),
    })
    .default({}),
  verbatim: z
    .array(
      z.object({
        question_id: z.string().min(1).max(200),
        question_text: z.string().max(4000),
        answer_text: z.string().max(20000),
        modality: z.enum(["text", "voice"]),
        media_url: z.string().max(2000).optional().nullable(),
        answered_at: z.string().max(40).optional().nullable(),
        skipped: z.boolean().optional(),
      }),
    )
    .max(200)
    .default([]),
  structured: z
    .object({
      current_state: list,
      desired_future: list,
      pains: list,
      goals: list,
      constraints: list,
      existing_assets: list,
      ideas: list,
      open_questions: list,
    })
    .default({}),
  signals: z
    .object({
      frame: z.string().max(200).optional().nullable(),
      frame_confidence: z.number().min(0).max(1).optional().nullable(),
      objective_coverage: z.number().min(0).max(1).optional().nullable(),
      completeness: z.number().min(0).max(1).optional().nullable(),
      authorizes_research: z.boolean().optional().nullable(),
    })
    .default({}),
  consent: z
    .object({
      marketing_opt_in: z.boolean().optional().nullable(),
      privacy_version: z.string().max(80).optional().nullable(),
    })
    .default({}),
});

export type IntakeInput = z.infer<typeof IntakeBody>;

export const EventsBody = z.object({
  source_app: z.literal("website"),
  organization_id: z.string().uuid().optional(),
  events: z
    .array(
      z.object({
        event_name: z.string().max(60),
        event_key: z.string().min(1).max(300),
        occurred_at: z.string().min(4).max(40),
        session_id: z.string().max(200).optional().nullable(),
        path: z.string().max(2000).optional().nullable(),
        referrer: z.string().max(2000).optional().nullable(),
        utm: z.record(z.string(), z.string().max(200)).optional(),
        device: z.string().max(80).optional().nullable(),
        submission_id: z.string().max(200).optional().nullable(),
        question_id: z.string().max(200).optional().nullable(),
        modality: z.enum(["text", "voice"]).optional().nullable(),
        properties: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1)
    .max(500),
});

/* ----------------------------------------------------------- authentication */

export const SIGNATURE_HEADER = "x-trust-tai-signature";
export const TIMESTAMP_HEADER = "x-trust-tai-timestamp";
const MAX_SKEW_SECONDS = 300;

export type AuthFailure =
  | "not_configured"
  | "missing_signature"
  | "stale_timestamp"
  | "bad_signature";

/** The exact bytes both sides sign: `${timestamp}.${rawBody}`. */
export function signingPayload(timestamp: string, rawBody: string): string {
  return `${timestamp}.${rawBody}`;
}

export function signIntake(secret: string, timestamp: string, rawBody: string): string {
  return `sha256=${createHmac("sha256", secret).update(signingPayload(timestamp, rawBody)).digest("hex")}`;
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function verifyIntakeSignature(input: {
  secret: string | undefined;
  signature: string | null;
  timestamp: string | null;
  rawBody: string;
  now?: Date;
}): { ok: true } | { ok: false; reason: AuthFailure } {
  if (!input.secret) return { ok: false, reason: "not_configured" };
  if (!input.signature || !input.timestamp) return { ok: false, reason: "missing_signature" };

  const sent = Number(input.timestamp);
  const seconds = Number.isFinite(sent)
    ? sent > 1e12
      ? sent / 1000
      : sent
    : Date.parse(input.timestamp) / 1000;
  if (!Number.isFinite(seconds)) return { ok: false, reason: "stale_timestamp" };
  const now = (input.now ?? new Date()).getTime() / 1000;
  if (Math.abs(now - seconds) > MAX_SKEW_SECONDS) return { ok: false, reason: "stale_timestamp" };

  const expected = signIntake(input.secret, input.timestamp, input.rawBody);
  return constantTimeEqual(expected, input.signature) ? { ok: true } : { ok: false, reason: "bad_signature" };
}

/* -------------------------------------------------------------- environment */

export function websiteIntakeSecret(): string | undefined {
  return process.env["WEBSITE_INTAKE_SECRET"] || undefined;
}

/**
 * The one organization TrustTai.com may write into. Server configuration, so
 * a payload can never redirect a submission into another workspace.
 */
export function websiteOrganizationId(): string | undefined {
  return process.env["WEBSITE_INTAKE_ORGANIZATION_ID"] || undefined;
}

function serviceClient(): SupabaseClient {
  const key =
    process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"] || process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!key) throw new Error("Missing Trust Tai Supabase service-role key.");
  return createClient(trustTaiSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

/* ------------------------------------------------------------- normalising */

export function normalizeStructured(input: IntakeInput["structured"]): WebsiteStructured {
  return {
    ...EMPTY_STRUCTURED,
    currentState: input.current_state ?? [],
    desiredFuture: input.desired_future ?? [],
    pains: input.pains ?? [],
    goals: input.goals ?? [],
    constraints: input.constraints ?? [],
    existingAssets: input.existing_assets ?? [],
    ideas: input.ideas ?? [],
    openQuestions: input.open_questions ?? [],
  };
}

/* ---------------------------------------------------------------- ingestion */

export interface IntakeResult {
  accepted: true;
  scout_prospect_id: string | null;
  duplicate: boolean;
  link_state: "linked" | "unlinked";
  because: string;
}

export async function receiveIntake(
  body: IntakeInput,
  organizationId: string,
): Promise<IntakeResult> {
  const db = serviceClient();

  // 1. Idempotency. The same submission_id always returns the same answer.
  const existing = await db
    .from("website_intake_submissions")
    .select("id, scout_prospect_id, link_state, link_reason")
    .eq("organization_id", organizationId)
    .eq("submission_id", body.submission_id)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) {
    const row = existing.data as Record<string, unknown>;
    await writeActivity(db, organizationId, {
      action: "flagged",
      summary: `A Website roadmap intake was received again and ignored as a duplicate (${body.submission_id}).`,
      submissionId: body.submission_id,
      entityId: String(row["id"]),
      prospectId: (row["scout_prospect_id"] as string | null) ?? null,
    });
    return {
      accepted: true,
      scout_prospect_id: (row["scout_prospect_id"] as string | null) ?? null,
      duplicate: true,
      link_state: (row["link_state"] as "linked" | "unlinked") ?? "unlinked",
      because: String(row["link_reason"] ?? "Already received."),
    };
  }

  // 2. Resolve Scout identity on evidence only.
  const candidates = await db
    .from("prospects")
    .select("id, company_name, website_url")
    .eq("organization_id", organizationId);
  if (candidates.error) throw new Error(candidates.error.message);
  const pool: MatchCandidate[] = ((candidates.data ?? []) as Record<string, unknown>[]).map(
    (row) => ({
      id: String(row["id"]),
      name: String(row["company_name"] ?? ""),
      websiteUrl: String(row["website_url"] ?? ""),
    }),
  );

  const outcome = matchProspect(
    {
      companyName: body.company.name ?? null,
      companyWebsite: body.company.website ?? null,
      personEmail: body.person.email ?? null,
    },
    pool,
  );

  let prospectId: string | null = null;
  let created = false;
  if (outcome.kind === "matched") {
    prospectId = outcome.prospectId;
  } else if (outcome.kind === "create") {
    const inserted = await db
      .from("prospects")
      .insert({
        organization_id: organizationId,
        company_name: outcome.name,
        website_url: outcome.websiteUrl,
        // Inbound, not qualified. Qualification stays a human act inside Scout.
        status: "discovered",
        source: "website_roadmap_intake",
        observed: [],
        inferred: {},
        suggested: {},
        provenance: {
          app_key: WEBSITE_SOURCE_APP,
          source_app: WEBSITE_SOURCE_APP,
          source_channel: WEBSITE_SOURCE_CHANNEL,
          source_type: WEBSITE_SOURCE_TYPE,
          label: WEBSITE_INTAKE_LABEL,
          submission_id: body.submission_id,
          submitted_at: body.submitted_at,
          landing_path: body.attribution.landing_path ?? null,
          utm: body.attribution.utm ?? {},
          received_at: new Date().toISOString(),
        },
      })
      .select("id")
      .maybeSingle();
    if (inserted.error) throw new Error(inserted.error.message);
    prospectId = inserted.data ? String((inserted.data as Record<string, unknown>)["id"]) : null;
    created = prospectId !== null;
  }

  const linkState: "linked" | "unlinked" = prospectId ? "linked" : "unlinked";

  // 3. Persist the raw submission exactly as it arrived.
  const insert = await db
    .from("website_intake_submissions")
    .insert({
      organization_id: organizationId,
      source_app: body.source_app,
      source_channel: body.source_channel,
      source_type: body.source_type,
      submission_id: body.submission_id,
      submitted_at: body.submitted_at,
      started_at: body.started_at ?? null,
      received_at: new Date().toISOString(),
      attribution: body.attribution,
      person: body.person,
      company: body.company,
      verbatim: body.verbatim,
      structured: body.structured,
      signals: body.signals,
      consent: body.consent,
      scout_prospect_id: prospectId,
      link_state: linkState,
      link_reason: outcome.because,
      processing_state: prospectId ? "routed" : "held",
    })
    .select("id")
    .maybeSingle();
  if (insert.error) {
    // A racing retry hit the unique key first: return its answer, not an error.
    if (insert.error.code === "23505") {
      return receiveIntake(body, organizationId);
    }
    throw new Error(insert.error.message);
  }
  const submissionRowId = insert.data
    ? String((insert.data as Record<string, unknown>)["id"])
    : body.submission_id;

  // 4. History. One row, traceable back to the submission.
  await writeActivity(db, organizationId, {
    action: prospectId ? "handed_over" : "flagged",
    summary: prospectId
      ? `${WEBSITE_INTAKE_LABEL}: ${body.company.name || subjectDomain({ companyWebsite: body.company.website, personEmail: body.person.email }) || "an inbound founder"} reached Scout. ${outcome.because}`
      : `${WEBSITE_INTAKE_LABEL}: an inbound submission is waiting for review. ${outcome.because}`,
    submissionId: body.submission_id,
    entityId: submissionRowId,
    prospectId,
    created,
  });

  return {
    accepted: true,
    scout_prospect_id: prospectId,
    duplicate: false,
    link_state: linkState,
    because: outcome.because,
  };
}

async function writeActivity(
  db: SupabaseClient,
  organizationId: string,
  input: {
    action: string;
    summary: string;
    submissionId: string;
    entityId: string;
    prospectId: string | null;
    created?: boolean;
  },
): Promise<void> {
  const payload = {
    organization_id: organizationId,
    app_key: WEBSITE_SOURCE_APP,
    event_type: `website.${input.action}`,
    entity_type: input.prospectId ? "prospect" : "activity",
    entity_id: input.prospectId ?? input.entityId,
    summary: input.summary,
    source_event_key: `website:intake:${input.submissionId}:${input.action}`,
    occurred_at: new Date().toISOString(),
    payload: {
      source_app: WEBSITE_SOURCE_APP,
      source_channel: WEBSITE_SOURCE_CHANNEL,
      source_type: WEBSITE_SOURCE_TYPE,
      submission_id: input.submissionId,
      submission_row_id: input.entityId,
      scout_prospect_id: input.prospectId,
      prospect_created: input.created === true,
    },
  };
  const { error } = await db.from("activities").insert(payload);
  if (error) console.error("[website] activity not recorded:", error.message);
}

/* ------------------------------------------------------------------- events */

export async function receiveEvents(
  body: z.infer<typeof EventsBody>,
  organizationId: string,
): Promise<{ accepted: true; stored: number; ignored: number }> {
  const db = serviceClient();
  const rows = body.events
    .filter((event) => isWebsiteEventName(event.event_name))
    .map((event) => ({
      organization_id: organizationId,
      event_name: event.event_name,
      event_key: event.event_key,
      occurred_at: event.occurred_at,
      session_id: event.session_id ?? null,
      path: event.path ?? null,
      referrer: event.referrer ?? null,
      utm: event.utm ?? {},
      device: event.device ?? null,
      submission_id: event.submission_id ?? null,
      question_id: event.question_id ?? null,
      modality: event.modality ?? null,
      properties: event.properties ?? {},
    }));

  if (rows.length > 0) {
    const { error } = await db
      .from("website_events")
      .upsert(rows, { onConflict: "organization_id,event_key", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  return { accepted: true, stored: rows.length, ignored: body.events.length - rows.length };
}
