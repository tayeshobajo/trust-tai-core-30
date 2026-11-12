import { z } from "zod";
export const stages = [
  "captured",
  "qualifying",
  "preparing",
  "review",
  "ready",
  "submitted",
  "awarded",
  "declined",
  "closed",
] as const;
export type Stage = (typeof stages)[number];
export const stageLabel: Record<Stage, string> = {
  captured: "Captured",
  qualifying: "Qualifying",
  preparing: "Preparing",
  review: "In review",
  ready: "Ready",
  submitted: "Submitted",
  awarded: "Awarded",
  declined: "Declined",
  closed: "Closed",
};
export function canonicalSource(value: string): string {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Use a public http or https source URL.");
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|mc_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.toString().replace(/\/(?=\?|$)/, "");
}
const source = z
  .string()
  .trim()
  .min(1)
  .transform((v, ctx) => {
    try {
      return canonicalSource(v);
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a valid http or https source URL." });
      return z.NEVER;
    }
  });
export const opportunityInput = z
  .object({
    audience: z.enum(["private", "team_business", "qa"]).optional(),
    title: z.string().trim().min(1).max(240),
    kind: z.enum(["rfp", "grant"]),
    source_url: source.or(z.literal("")),
    source_file_sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .or(z.literal(""))
      .optional(),
    source_name: z.string().trim().max(240),
    cycle: z.string().trim().max(120),
    applicant: z.string().trim().max(240),
    eligibility: z.enum(["unknown", "reviewing", "eligible", "ineligible"]),
    eligibility_notes: z.string().max(10000),
    requirements: z.string().max(20000),
    deadline_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .or(z.literal("")),
    deadline_time: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .or(z.literal("")),
    deadline_timezone: z.string().refine((v) => {
      if (!v) return true;
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, "Use an IANA timezone, for example America/Chicago."),
    owner_label: z.string().trim().max(240),
    next_action: z.string().trim().max(2000),
    source_evidence: z.string().trim().min(1).max(20000),
  })
  .superRefine((v, ctx) => {
    if (!v.source_url && !v.source_file_sha256)
      ctx.addIssue({
        code: "custom",
        path: ["source_url"],
        message: "Provide a source URL or source document.",
      });
    if (
      v.deadline_date &&
      (Number.isNaN(Date.parse(v.deadline_date)) ||
        new Date(v.deadline_date).toISOString().slice(0, 10) !== v.deadline_date)
    )
      ctx.addIssue({
        code: "custom",
        path: ["deadline_date"],
        message: "Enter a valid calendar date.",
      });
    if (v.deadline_time && !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v.deadline_time))
      ctx.addIssue({ code: "custom", path: ["deadline_time"], message: "Enter a valid time." });
    if (v.deadline_time && (!v.deadline_date || !v.deadline_timezone))
      ctx.addIssue({
        code: "custom",
        path: ["deadline_timezone"],
        message: "An exact deadline needs a date and timezone.",
      });
  });
export type OpportunityInput = z.infer<typeof opportunityInput>;
export interface Opportunity extends OpportunityInput {
  id: string;
  organization_id: string;
  stage: Stage;
  created_by: string;
  created_at: string;
  updated_at: string;
  revision: number;
  source_checked_at: string | null;
  source_state: "unchecked" | "available" | "failed";
}
export interface DraftVersion {
  id: string;
  opportunity_id: string;
  organization_id: string;
  file_name: string;
  object_path: string;
  created_at: string;
  created_by: string;
  note: string;
  sha256: string;
}
export interface Submission {
  id: string;
  opportunity_id: string;
  submitted_at: string | null;
  submitted_date?: string | null;
  time_precision?: TimePrecision;
  channel: string;
  reference: string;
  evidence_url: string;
  draft_id: string | null;
  recorded_at: string;
}
export type SourceFile = Omit<DraftVersion, "note">;
export interface Snapshot {
  sourceFiles?: SourceFile[];
  documents?: DocumentReference[];
  amendments?: EvidenceAmendment[];
  opportunities: Opportunity[];
  versions: DraftVersion[];
  submissions: Submission[];
  approvals: { draft_id: string; created_at: string }[];
  checks: {
    id: string;
    checked_at: string;
    note: string;
    source_count: number;
    failed_count: number;
  }[];
}
export const blankOpportunity: OpportunityInput = {
  audience: "team_business",
  title: "",
  kind: "rfp",
  source_url: "",
  source_name: "",
  cycle: "",
  applicant: "",
  eligibility: "unknown",
  eligibility_notes: "",
  requirements: "",
  deadline_date: "",
  deadline_time: "",
  deadline_timezone: "",
  owner_label: "",
  next_action: "",
  source_evidence: "",
};
export function deadlineLabel(o: OpportunityInput) {
  return o.deadline_date
    ? `${o.deadline_date}${o.deadline_time ? ` · ${o.deadline_time}` : " · time unknown"}${o.deadline_timezone ? ` ${o.deadline_timezone}` : " · timezone unknown"}`
    : "Deadline unknown";
}
export function filterOpportunities(
  rows: Opportunity[],
  query: string,
  stage: string,
  kind: string,
) {
  return rows
    .filter(
      (o) =>
        (stage === "all" || o.stage === stage) &&
        (kind === "all" || o.kind === kind) &&
        [o.title, o.source_name, o.owner_label, o.applicant]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => (a.deadline_date || "9999").localeCompare(b.deadline_date || "9999"));
}
export function validateUpload(file: Pick<File, "size" | "name" | "type">) {
  if (file.size === 0 || file.size > 20 * 1024 * 1024)
    throw new Error("Choose a non-empty file up to 20 MB.");
  if (!/\.(pdf|docx|txt)$/i.test(file.name)) throw new Error("Choose a PDF, DOCX, or TXT draft.");
}
export type TimePrecision = "second" | "minute" | "date" | "unknown" | "legacy";
export interface SubmissionTime {
  submitted_at?: string | null;
  submitted_date?: string | null;
  time_precision?: TimePrecision | null;
}
const timeFields = {
  submitted_at: z.string().datetime({ offset: true }).nullable(),
  submitted_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  time_precision: z.enum(["second", "minute", "date", "unknown", "legacy"]),
};
function validSubmissionTime(v: SubmissionTime): boolean {
  const p = v.time_precision;
  if (p == null) return v.submitted_at == null && v.submitted_date == null;
  if (p === "unknown") return v.submitted_at == null && v.submitted_date == null;
  if (p === "date")
    return (
      v.submitted_at == null &&
      !!v.submitted_date &&
      !Number.isNaN(Date.parse(v.submitted_date)) &&
      new Date(v.submitted_date).toISOString().slice(0, 10) === v.submitted_date &&
      v.submitted_date <= new Date().toISOString().slice(0, 10)
    );
  if (!v.submitted_at || v.submitted_date != null) return false;
  const ms = Date.parse(v.submitted_at);
  return (
    Number.isFinite(ms) &&
    ms <= Date.now() &&
    (p !== "minute" || ms % 60000 === 0) &&
    (p !== "second" || ms % 1000 === 0)
  );
}
export function submissionTimeLabel(v: SubmissionTime): string {
  if (v.time_precision === "unknown") return "Submission time unknown";
  if (v.time_precision === "date") return `${v.submitted_date} · date only; time unknown`;
  if (v.time_precision == null || v.time_precision === "legacy")
    return "Submission time precision not recorded (legacy)";
  if (!v.submitted_at) return "Submission time unknown";
  return `${new Date(v.submitted_at).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(v.time_precision === "second" ? { second: "2-digit" as const } : {}),
    timeZoneName: "short",
  })} · ${v.time_precision === "minute" ? "minute precision; seconds unknown" : "second precision"}`;
}
export function submissionTimeFromForm(f: FormData): SubmissionTime {
  const precision = String(f.get("time_precision"));
  return {
    time_precision: precision === "unchanged" ? null : (precision as TimePrecision),
    submitted_at: ["minute", "second"].includes(precision)
      ? new Date(String(f.get("time"))).toISOString()
      : null,
    submitted_date: precision === "date" ? String(f.get("submission_date")) : null,
  };
}
export const submissionInput = z
  .object({
    ...timeFields,
    time_precision: timeFields.time_precision.default("legacy"),
    channel: z.string().trim().min(1).max(240),
    reference: z.string().trim().max(2000),
    evidence_url: z.union([source, z.literal("")]),
    draft_id: z.string().uuid().nullable(),
  })
  .refine(
    validSubmissionTime,
    "Provide a valid past submission date/time matching its precision; unknown times must be empty.",
  );

export function googleDocUrl(value: string): string {
  const url = new URL(value.trim());
  if (
    url.protocol !== "https:" ||
    url.hostname !== "docs.google.com" ||
    url.port ||
    url.username ||
    url.password
  )
    throw new Error(
      "Use a Google Docs document URL beginning https://docs.google.com/document/d/.",
    );
  const match = url.pathname.match(
    /^\/document\/d\/([a-zA-Z0-9_-]+)(?:\/(?:edit|view|preview))?\/?$/,
  );
  if (!match) throw new Error("Use a Google Docs document link, not a folder or published page.");
  return `https://docs.google.com/document/d/${match[1]}/edit`;
}
export const documentInput = z.object({
  title: z.string().trim().min(1).max(240),
  url: z.string().transform((value, ctx) => {
    try {
      return googleDocUrl(value);
    } catch (error) {
      ctx.addIssue({ code: "custom", message: (error as Error).message });
      return z.NEVER;
    }
  }),
  note: z.string().trim().max(2000),
});
export interface DocumentReference {
  id: string;
  opportunity_id: string;
  title: string;
  url: string;
  note: string;
  created_at: string;
}
export const evidenceInput = z
  .object({
    ...timeFields,
    submitted_at: timeFields.submitted_at.default(null),
    time_precision: z.enum(["second", "minute", "date", "unknown"]).nullable().default(null),
    draft_id: z.string().uuid().nullable(),
    document_id: z.string().uuid().nullable(),
    submitted_version: z.string().trim().max(2000),
    reference: z.string().trim().max(2000),
    evidence_url: z.union([source, z.literal("")]),
    reason: z.string().trim().min(1).max(2000),
  })
  .refine(
    validSubmissionTime,
    "Submission timing must match its precision and cannot be in the future.",
  );
export interface EvidenceAmendment extends z.infer<typeof evidenceInput> {
  id: string;
  submission_id: string;
  opportunity_id: string;
  created_at: string;
}
