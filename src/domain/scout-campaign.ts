/**
 * Scout outreach campaigns: one template, a chosen set of saved Scout People,
 * and one Comms draft per recipient. The campaign prepares drafts only. Every
 * message still goes through Comms review and a person's own send approval.
 */

export const CAMPAIGN_PLACEHOLDERS = ["first_name", "title", "company"] as const;
export type CampaignPlaceholder = (typeof CAMPAIGN_PLACEHOLDERS)[number];

export interface CampaignTemplate {
  subject: string;
  body: string;
}

export interface CampaignRecipientInput {
  /** Saved Scout People row id. Unsaved people cannot join a campaign. */
  personId: string | null;
  fullName: string;
  title: string | null;
  company: string;
  workEmail: string | null;
  emailState: "verified" | "found_unverified" | "stale" | "not_found" | "not_checked";
  /** A person accepted an unverified address explicitly. */
  acceptedUnverified?: boolean;
}

export type RecipientEligibility =
  | { ok: true }
  | { ok: false; because: string };

export function recipientEligibility(r: CampaignRecipientInput): RecipientEligibility {
  if (!r.personId) return { ok: false, because: "Save this person in Scout first." };
  if (!r.workEmail) return { ok: false, because: "No work email on file." };
  if (r.emailState === "verified") return { ok: true };
  if (r.emailState === "found_unverified" && r.acceptedUnverified) return { ok: true };
  return { ok: false, because: "The work email is not verified." };
}

const TOKEN = /\{\s*([a-z_]+)\s*\}/gi;

function valueFor(key: string, r: CampaignRecipientInput): string | null {
  switch (key.toLowerCase()) {
    case "first_name": {
      const first = r.fullName.trim().split(/\s+/)[0] ?? "";
      return first || null;
    }
    case "title":
      return r.title?.trim() || null;
    case "company":
      return r.company.trim() || null;
    default:
      return null;
  }
}

export type RenderResult =
  | { ok: true; subject: string; body: string }
  | { ok: false; because: string; missing: string[] };

/** Fill placeholders. Any unfillable or unknown placeholder blocks the draft (never blanks). */
export function renderTemplate(t: CampaignTemplate, r: CampaignRecipientInput): RenderResult {
  const missing = new Set<string>();
  const fill = (text: string) =>
    text.replace(TOKEN, (whole, key: string) => {
      const v = valueFor(key, r);
      if (v === null) {
        missing.add(key.toLowerCase());
        return whole;
      }
      return v;
    });
  const subject = fill(t.subject);
  const body = fill(t.body);
  if (missing.size > 0) {
    const list = [...missing];
    return {
      ok: false,
      missing: list,
      because: `Missing ${list.map((m) => `{${m}}`).join(", ")} for ${r.fullName}.`,
    };
  }
  if (!subject.trim() || !body.trim()) {
    return { ok: false, missing: [], because: "The template needs a subject and a message." };
  }
  return { ok: true, subject, body };
}

/** One recipient per saved person and per address. Order preserved. */
export function dedupeRecipients(list: CampaignRecipientInput[]): CampaignRecipientInput[] {
  const seen = new Set<string>();
  const out: CampaignRecipientInput[] = [];
  for (const r of list) {
    const keys = [r.personId ? `p:${r.personId}` : "", r.workEmail ? `e:${r.workEmail.trim().toLowerCase()}` : ""].filter(Boolean);
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    out.push(r);
  }
  return out;
}

export type QueueState = "drafting" | "blocked" | "needs_review" | "approved" | "sent" | "failed";

export const QUEUE_LABEL: Record<QueueState, string> = {
  drafting: "Drafting",
  blocked: "Blocked",
  needs_review: "Needs review",
  approved: "Approved",
  sent: "Sent",
  failed: "Failed",
};

/** Map a Comms draft review state onto the send queue. Unknown states stay "Needs review". */
export function queueStateFor(reviewState: string | null | undefined): QueueState {
  switch (reviewState) {
    case "sent":
      return "sent";
    case "approved":
      return "approved";
    case "failed":
      return "failed";
    case undefined:
    case null:
      return "drafting";
    default:
      return "needs_review";
  }
}

export function campaignKey(prospectId: string, name: string): string {
  return `scout:prospect:${prospectId}:campaign:${name.trim().toLowerCase().replace(/\s+/g, "-")}`;
}
