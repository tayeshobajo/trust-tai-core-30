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
    title: z.string().trim().min(1).max(240),
    kind: z.enum(["rfp", "grant"]),
    source_url: source,
    source_name: z.string().trim().min(1).max(240),
    cycle: z.string().trim().min(1).max(120),
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
  submitted_at: string;
  channel: string;
  reference: string;
  evidence_url: string;
  draft_id: string | null;
  recorded_at: string;
}
export interface Snapshot {
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
export const submissionInput = z
  .object({
    submitted_at: z.string().datetime({ offset: true }),
    channel: z.string().trim().min(1).max(240),
    reference: z.string().trim().max(2000),
    evidence_url: z.union([source, z.literal("")]),
    draft_id: z.string().uuid().nullable(),
  })
  .refine(
    (v) => new Date(v.submitted_at).getTime() <= Date.now(),
    "Submission time cannot be in the future.",
  );
