/**
 * Where each preparation job reads its real subject (server only).
 *
 * These are the adapters between the rooms' own tables and the one runner.
 * Three rules hold for all of them:
 *
 *  - every read runs with the caller's own token, under RLS, and always
 *    carries the organization as an explicit filter. Nothing here trusts a
 *    workspace, an owner or a source named by the browser: all three are read
 *    back off the record itself,
 *  - the revision is computed from what the room actually stores, so it moves
 *    exactly when the subject moves and prepared work goes stale by itself,
 *  - a table or column that is not there is said plainly. A source that cannot
 *    be read is never quietly treated as an empty one.
 *
 * No room's state is written here. These readers only read.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { PreparationRequest } from "@/domain/preparation-jobs";
import type { DeterministicRead } from "@/lib/preparation-runner.server";
import type { SubjectReader } from "@/lib/preparation-subjects.server";
import { trustTaiSupabaseKey, trustTaiSupabaseUrl } from "@/lib/trust-tai-backend.server";

type Row = Record<string, unknown>;

/** A source that could not be read. Never dressed up as an empty source. */
export class SubjectUnreadable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubjectUnreadable";
  }
}

type ClientFactory = (token: string) => SupabaseClient;

const realClient: ClientFactory = (token) =>
  createClient(trustTaiSupabaseUrl(), trustTaiSupabaseKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

let factory: ClientFactory = realClient;

/**
 * Tests stand a fake workspace behind the readers. Production never calls
 * this, and the default is always the real, token-scoped client.
 */
export function setCallerClientFactory(next: ClientFactory | null): void {
  factory = next ?? realClient;
}

export function callerClient(token: string): SupabaseClient {
  return factory(token);
}


function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
}

function list(value: unknown): Row[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function fail(what: string, error: { message?: string } | null): never {
  throw new SubjectUnreadable(
    `${what} could not be read, so nothing was prepared: ${error?.message ?? "unknown reason"}`,
  );
}

/* --------------------------------------------------------- a new enquiry */

const ENQUIRY_TABLE = "website_intake_submissions";

async function enquiryRow(
  token: string,
  request: PreparationRequest,
): Promise<Row | null> {
  const { data, error } = await callerClient(token)
    .from(ENQUIRY_TABLE)
    .select("*")
    .eq("organization_id", request.organizationId)
    .eq("submission_id", request.subjectRef)
    .maybeSingle();
  if (error) fail("That enquiry", error);
  return (data as Row | null) ?? null;
}

export const enquiryReader: SubjectReader = {
  async belongsToWorkspace(request, token) {
    return (await enquiryRow(token, request)) !== null;
  },

  async currentRevision(request, token) {
    const row = await enquiryRow(token, request);
    if (!row) throw new SubjectUnreadable("That enquiry is not in this workspace.");
    // The revision moves when anything we would prepare from moves.
    return [
      str(row["received_at"]) || str(row["submitted_at"]),
      str(row["link_state"]),
      str(row["processing_state"]),
    ].join("|");
  },

  async read(request, token): Promise<DeterministicRead> {
    const client = callerClient(token);
    const row = await enquiryRow(token, request);
    if (!row) throw new SubjectUnreadable("That enquiry is not in this workspace.");

    const person = record(row["person"]);
    const company = record(row["company"]);
    const consent = record(row["consent"]);
    const spoken = list(row["verbatim"])
      .filter((answer) => answer["skipped"] !== true)
      .map((answer) => str(answer["answer_text"] ?? answer["answerText"]).trim())
      .filter((text) => text.length > 0);

    // The ICP the person will judge fit against. Absent is said, never assumed.
    const icpRead = await client
      .from("icp_profiles")
      .select("*")
      .eq("organization_id", request.organizationId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (icpRead.error) fail("The ICP", icpRead.error);
    const icp = (icpRead.data?.[0] as Row | undefined) ?? null;
    const criteria = icp
      ? list(icp["criteria"]).map((entry) => str(entry["label"] ?? entry["text"]))
          .filter((text) => text.length > 0)
      : [];

    const unknowns: string[] = [];
    if (!str(company["website"])) unknowns.push("We do not have their website.");
    if (!str(person["email"])) unknowns.push("We do not have an email for them.");
    if (!icp) unknowns.push("There is no ICP recorded to judge fit against.");
    if (consent["marketing_opt_in"] === null || consent["marketing_opt_in"] === undefined) {
      unknowns.push("They were not asked about marketing contact.");
    }

    const figures = {
      answersGiven: spoken.length,
      icpCriteria: criteria.length,
      unknownsAtIntake: unknowns.length,
    };

    if (spoken.length === 0) {
      return {
        figures,
        evidenceRefs: [],
        ownerLabel: "Whoever curates Scout",
        material: [],
        cannotPrepareBecause: "They did not tell us anything we can prepare from.",
      };
    }

    return {
      figures,
      evidenceRefs: [
        `website_submission:${request.subjectRef}`,
        ...(row["scout_prospect_id"] ? [`prospect:${str(row["scout_prospect_id"])}`] : []),
      ],
      ownerLabel: "Whoever curates Scout",
      material: [
        {
          ref: `website_submission:${request.subjectRef}`,
          text: [
            `Company as given: ${str(company["name"]) || "not given"}`,
            `Website as given: ${str(company["website"]) || "not given"}`,
            `How they reached us: ${str(row["source_channel"]) || "not recorded"}`,
            "What they told us, in their words:",
            ...spoken.map((text) => `- ${text}`),
            criteria.length > 0
              ? `ICP to judge against:\n${criteria.map((text) => `- ${text}`).join("\n")}`
              : "There is no ICP recorded. Do not claim fit.",
            unknowns.length > 0 ? `Not known: ${unknowns.join(" ")}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      ...(str(row["link_state"]) === "unlinked"
        ? { needsDecisionBecause: "Someone needs to say which company this enquiry belongs to." }
        : {}),
    };
  },
};

/* ------------------------------------------------------- a conversation */

const RELATIONSHIPS = "comms_relationships";
const MESSAGES = "comms_messages";
const MESSAGE_WINDOW = 12;

async function relationshipRow(token: string, request: PreparationRequest): Promise<Row | null> {
  const { data, error } = await callerClient(token)
    .from(RELATIONSHIPS)
    .select("*")
    .eq("organization_id", request.organizationId)
    .eq("id", request.subjectRef)
    .maybeSingle();
  if (error) fail("That conversation", error);
  return (data as Row | null) ?? null;
}

async function conversationMessages(token: string, request: PreparationRequest): Promise<Row[]> {
  const { data, error } = await callerClient(token)
    .from(MESSAGES)
    .select("id, organization_id, relationship_id, direction, subject, snippet, occurred_at")
    .eq("organization_id", request.organizationId)
    .eq("relationship_id", request.subjectRef)
    .order("occurred_at", { ascending: false })
    .limit(MESSAGE_WINDOW);
  if (error) fail("That conversation", error);
  return ((data ?? []) as Row[]).map(record);
}

export const conversationReader: SubjectReader = {
  async belongsToWorkspace(request, token) {
    return (await relationshipRow(token, request)) !== null;
  },

  async currentRevision(request, token) {
    const messages = await conversationMessages(token, request);
    const latest = messages.map((message) => str(message["occurred_at"])).sort().at(-1);
    // Count and latest moment together: a new message moves the revision.
    return [messages.length, latest ?? "none"].join("|");
  },

  async read(request, token): Promise<DeterministicRead> {
    const relationship = await relationshipRow(token, request);
    if (!relationship) throw new SubjectUnreadable("That conversation is not in this workspace.");
    const messages = await conversationMessages(token, request);

    const usable = messages.filter((message) => str(message["occurred_at"]).length > 0);
    const figures = {
      sourcesRead: usable.length,
      sourcesNotRead: messages.length - usable.length,
    };
    const ownerLabel =
      str(relationship["owner_label"]) || str(relationship["owner_name"]) || "Relationship owner";

    if (usable.length === 0) {
      return {
        figures,
        evidenceRefs: [],
        ownerLabel,
        material: [],
        cannotPrepareBecause: "There is nothing recorded in this conversation to prepare from.",
      };
    }

    return {
      figures,
      evidenceRefs: usable.map((message) => `comms_message:${str(message["id"])}`),
      ownerLabel,
      material: usable.map((message) => ({
        ref: `comms_message:${str(message["id"])}`,
        text: [
          `${str(message["direction"]) || "message"} on ${str(message["occurred_at"])}: ${str(message["subject"]) || "no subject"}`,
          str(message["snippet"]),
        ]
          .filter(Boolean)
          .join("\n"),
      })),
      ...(figures.sourcesNotRead > 0
        ? {
            needsDecisionBecause: `Some material was not read: ${figures.sourcesNotRead} message(s) had no recorded time.`,
          }
        : {}),
    };
  },
};

/* ----------------------------------------------------- a milestone moved */

const MILESTONES = "roadmap_milestones";
const CRITERIA = "roadmap_milestone_criteria";

async function milestoneRow(token: string, request: PreparationRequest): Promise<Row | null> {
  const { data, error } = await callerClient(token)
    .from(MILESTONES)
    .select("*")
    .eq("organization_id", request.organizationId)
    .eq("id", request.subjectRef)
    .maybeSingle();
  if (error) fail("That milestone", error);
  return (data as Row | null) ?? null;
}

export const milestoneReader: SubjectReader = {
  async belongsToWorkspace(request, token) {
    return (await milestoneRow(token, request)) !== null;
  },

  async currentRevision(request, token) {
    const row = await milestoneRow(token, request);
    if (!row) throw new SubjectUnreadable("That milestone is not in this workspace.");
    return [
      str(row["status"]),
      str(row["updated_at"]) || str(row["accepted_at"]) || str(row["created_at"]),
    ].join("|");
  },

  async read(request, token): Promise<DeterministicRead> {
    const client = callerClient(token);
    const row = await milestoneRow(token, request);
    if (!row) throw new SubjectUnreadable("That milestone is not in this workspace.");

    const criteriaRead = await client
      .from(CRITERIA)
      .select("*")
      .eq("organization_id", request.organizationId)
      .eq("milestone_id", request.subjectRef);
    if (criteriaRead.error) fail("The success measures for that milestone", criteriaRead.error);
    const criteria = ((criteriaRead.data ?? []) as Row[]).map(record);
    const met = criteria.filter((entry) => entry["met"] === true).length;
    const unmet = criteria.filter((entry) => entry["met"] === false).length;

    const figures = {
      successMeasures: criteria.length,
      measuresMet: met,
      measuresNotMet: unmet,
      // An unrecorded measure is unknown, not met and not failed.
      measuresUnknown: criteria.length - met - unmet,
    };
    const accepted = Boolean(row["accepted_at"]);

    return {
      figures,
      evidenceRefs: [
        `roadmap_milestone:${request.subjectRef}`,
        ...criteria.map((entry) => `milestone_criterion:${str(entry["id"])}`),
      ],
      ownerLabel: str(row["owner_label"]) || "Roadmap approver",
      material: [
        {
          ref: `roadmap_milestone:${request.subjectRef}`,
          text: [
            `Milestone: ${str(row["name"]) || "unnamed"}`,
            `State as recorded: ${str(row["status"]) || "not recorded"}`,
            `Success measures recorded: ${criteria.length}, met: ${met}, not met: ${unmet}, not yet recorded: ${figures.measuresUnknown}`,
            ...criteria.map(
              (entry) =>
                `- ${str(entry["label"]) || str(entry["name"]) || "measure"}: ${
                  entry["met"] === true ? "met" : entry["met"] === false ? "not met" : "not recorded"
                }`,
            ),
          ].join("\n"),
        },
      ],
      ...(accepted
        ? {}
        : {
            needsDecisionBecause:
              "Nobody has accepted this milestone yet, so this update is a draft for a person to own.",
          }),
    };
  },
};
