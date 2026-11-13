import { z } from "zod";
import { HIRING_ORG, HIRING_PEOPLE } from "@/domain/hiring";

// Render only from canonical snapshots supplied by the guarded notification claim.
export const HIRING_EMAIL_FROM = "Trust Tai Hiring <hello@trusttai.com>";
export const HIRING_EMAIL_LOGO = "https://cmd.trusttai.com/brand/trust-tai-logo.png";
const version = 1;
const line = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((s) => !/[\r\n]/.test(s));
const email = z
  .string()
  .email()
  .max(254)
  .refine((s) => !/[\r\n]/.test(s));
const applicationSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.literal(HIRING_ORG),
  job_id: z.string().uuid(),
  full_name: line,
  email,
  created_at: z.string().datetime({ offset: true }),
});
const jobSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.literal(HIRING_ORG),
  title: line,
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(120),
  owner_id: z.string().uuid().nullable(),
});
export type SavedEmailApplication = z.infer<typeof applicationSchema>;
export type EmailRole = z.infer<typeof jobSchema>;
/** Supply from authoritative current auth/membership/access reads, never a browser payload. */
export type VerifiedHiringMember = {
  user_id: string;
  organization_id: string;
  email: string;
  name: string;
  email_verified: boolean;
  active: boolean;
  hiring_access: boolean;
};
export type PreparedHiringEmail = {
  state: "prepared";
  kind: "applicant_receipt" | "role_owner_alert" | "tai_alert_copy";
  templateVersion: number;
  idempotencyKey: string;
  from: string;
  to: [string];
  subject: string;
  html: string;
  text: string;
};
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] ?? c,
  );
function date(value: string, withTime: boolean) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "long",
    day: "numeric",
    ...(withTime
      ? { hour: "numeric" as const, minute: "2-digit" as const, timeZoneName: "short" as const }
      : {}),
  }).format(new Date(value));
}
function shell(
  section: string,
  heading: string,
  paragraphs: string[],
  rows: [string, string][],
  url: string,
  cta: string,
  footer: string,
) {
  const details = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:12px 20px;border-bottom:1px solid #d4e3f4"><div style="font-size:11px;letter-spacing:2px;color:#49617f">${escape(label)}</div><div style="font-size:17px;margin-top:4px">${escape(value)}</div></td></tr>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(heading)}</title><style>@media(max-width:480px){.email-pad{padding:24px 18px!important}.email-title{font-size:27px!important}.email-logo{width:190px!important}}</style></head><body style="margin:0;background:#eef2f6;color:#08172d;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#fff;border-radius:16px"><tr><td class="email-pad" style="padding:36px"><table role="presentation" width="100%"><tr><td><img class="email-logo" src="${HIRING_EMAIL_LOGO}" alt="Trust Tai — Consultancy + AI Agency" width="240" style="display:block;max-width:100%;height:auto"></td><td style="font-size:11px;letter-spacing:2px;color:#49617f;text-align:right">${section}</td></tr></table><hr style="border:0;border-top:2px solid #69b8ff;margin:26px 0"><h1 class="email-title" style="font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:500;line-height:1.2;margin:0 0 28px"><span aria-hidden="true" style="color:#2389df">✓</span> ${escape(heading)}</h1>${paragraphs.map((p) => `<p style="font-size:16px;line-height:1.6;margin:0 0 20px">${escape(p)}</p>`).join("")}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eaf4ff;border-radius:10px;margin:24px 0">${details}</table><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="background:#102744;border-radius:8px"><a href="${escape(url)}" style="display:inline-block;padding:14px 22px;color:#fff;text-decoration:none;font-size:16px;font-weight:bold">${escape(cta)} →</a></td></tr></table><p style="font-size:13px;line-height:1.6;margin:22px 0;color:#49617f">${section === "HIRING" ? "Sign in required. Hiring-team access only." : "Trust Tai"}</p><hr style="border:0;border-top:1px solid #d4e3f4;margin:28px 0"><p style="font-size:13px;line-height:1.6;color:#49617f;margin:0">${escape(footer)}</p></td></tr></table></td></tr></table></body></html>`;
}
export function prepareHiringEmails(
  saved: unknown,
  role: unknown,
  members: readonly VerifiedHiringMember[],
) {
  const a = applicationSchema.parse(saved),
    j = jobSchema.parse(role);
  if (a.job_id !== j.id) throw new Error("Saved application and role do not match");
  const prepared = (
    kind: PreparedHiringEmail["kind"],
    to: string,
    subject: string,
    html: string,
    text: string,
  ): PreparedHiringEmail => ({
    state: "prepared",
    kind,
    templateVersion: version,
    idempotencyKey: `hiring/${a.id}/${kind}/v${version}`,
    from: HIRING_EMAIL_FROM,
    to: [to],
    subject,
    html,
    text,
  });
  const receiptParagraphs = [
    `Hi ${a.full_name},`,
    `Thanks for applying to Trust Tai. Your application for ${j.title} has been saved.`,
    "We appreciate the time you put into sharing your experience and work.",
  ];
  const roleUrl = `https://trusttai.com/careers/${j.slug}`;
  const receiptRows: [string, string][] = [
    ["ROLE", j.title],
    ["RECEIVED", `${date(a.created_at, false)} (America/Chicago)`],
  ];
  const receiptFooter = "trusttai.com · Careers. This is a receipt, not a hiring decision.";
  const receipt = prepared(
    "applicant_receipt",
    a.email,
    `Application received: ${j.title}`,
    shell(
      "CAREERS",
      "Application received.",
      receiptParagraphs,
      receiptRows,
      roleUrl,
      "View role",
      receiptFooter,
    ),
    [
      ...receiptParagraphs,
      ...receiptRows.map(([k, v]) => `${k}: ${v}`),
      `View role: ${roleUrl}`,
      "Trust Tai",
      receiptFooter,
    ].join("\n\n"),
  );
  const matches = members.filter(
    (m) => m.user_id === j.owner_id && m.organization_id === HIRING_ORG,
  );
  const owner = matches.length === 1 ? matches[0] : undefined;
  if (
    !owner ||
    !HIRING_PEOPLE.some((p) => p.id === owner.user_id) ||
    !owner.active ||
    !owner.hiring_access ||
    !owner.email_verified ||
    !email.safeParse(owner.email).success ||
    !line.safeParse(owner.name).success
  )
    return {
      receipt,
      ownerAlert: {
        state: "blocked" as const,
        reason: "verified_assigned_owner_required" as const,
      },
    };
  const paragraphs = [
    `Hi ${owner.name},`,
    `${a.full_name} has applied for ${j.title}. You’re the assigned owner for this role.`,
    "Open the application in CMD to review it and set the next step.",
  ];
  const url = `https://cmd.trusttai.com/modules/hiring?application=${a.id}`;
  const rows: [string, string][] = [
    ["CANDIDATE", a.full_name],
    ["ROLE", j.title],
    ["RECEIVED", date(a.created_at, true)],
    ["ASSIGNED OWNER", owner.name],
  ];
  const footer =
    "Trust Tai · Internal hiring notification. Applicant files and answers stay in CMD.";
  const alert = prepared(
    "role_owner_alert",
    owner.email,
    `New application: ${j.title}`,
    shell(
      "HIRING",
      "A new application is ready.",
      paragraphs,
      rows,
      url,
      "Review application",
      footer,
    ),
    [
      ...paragraphs,
      ...rows.map(([k, v]) => `${k}: ${v}`),
      `Review application: ${url}`,
      "Sign in required. Hiring-team access only.",
      footer,
    ].join("\n\n"),
  );
  const tai = members.filter(
    (m) => m.user_id === HIRING_PEOPLE[0]?.id && m.organization_id === HIRING_ORG,
  );
  const copy = tai.length === 1 ? tai[0] : undefined;
  const taiCopy =
    owner.user_id === HIRING_PEOPLE[0]?.id || owner.email.toLowerCase() === "tai@trust-tai.com"
      ? { state: "deduplicated" as const }
      : copy?.active &&
          copy.hiring_access &&
          copy.email_verified &&
          copy.email.toLowerCase() === "tai@trust-tai.com"
        ? prepared("tai_alert_copy", "tai@trust-tai.com", alert.subject, alert.html, alert.text)
        : { state: "blocked" as const, reason: "verified_tai_required" as const };
  return { receipt, ownerAlert: alert, taiCopy };
}
