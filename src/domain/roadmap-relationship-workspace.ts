import { conversationEvents } from "./roadmap-conversation";
import {
  canonicalOutreachHolds,
  evidenceHolds,
  messagePlainText,
  type EvidenceRecord,
} from "./roadmap-evidence";
import { followUpState, type StandingReview } from "./roadmap-followup";

export type RelationshipHealth =
  "attention" | "approaching" | "on_track" | "not_assessed" | "inactive";
export const healthLabels: Record<RelationshipHealth, string> = {
  attention: "Needs Attention",
  approaching: "Approaching Due",
  on_track: "On Track",
  not_assessed: "Not Assessed",
  inactive: "Closed / archived",
};
export const recordKey = (r: EvidenceRecord) =>
  r.publication?.slug ?? r.review?.roadmap_slug ?? r.key;
export const channelLabels = {
  email: "Email",
  linkedin: "LinkedIn",
  linkedin_sales_navigator: "Sales Navigator",
};
export function latestRelationshipActivity(r: EvidenceRecord) {
  const supplied = conversationEvents(r)[0];
  const imported = r.importedActivity?.latest;
  if (imported && (!supplied || Date.parse(imported.at) >= Date.parse(supplied.at)))
    return {
      at: imported.at,
      channel: imported.channel,
      kind: imported.kind,
      scope: "approved imported history",
    };
  if (supplied)
    return {
      at: supplied.at,
      channel: supplied.channel,
      kind:
        supplied.channel === "email"
          ? supplied.email.message.type === "email_received"
            ? "received"
            : supplied.email.message.type === "email_team_outbound_copy"
              ? "team_outbound_copy"
              : "sent"
          : supplied.linkedin.status === "received_ui_verified"
            ? "received"
            : "sent",
      scope: "supplied evidence",
    };
  return null;
}
export function relationshipHealth(r: EvidenceRecord, now: Date, review?: StandingReview) {
  const follow = followUpState(r, now, review);
  const health: RelationshipHealth =
    follow.state === "inactive"
      ? "inactive"
      : follow.holds.length || ["overdue", "due_today"].includes(follow.state)
        ? "attention"
        : follow.standing === "good"
          ? "on_track"
          : follow.state === "upcoming"
            ? "approaching"
            : "not_assessed";
  return { ...follow, health, healthLabel: healthLabels[health] };
}
export function relationshipMetrics(
  records: EvidenceRecord[],
  now: Date,
  reviews: Record<string, StandingReview> = {},
) {
  const saved = records.filter((r) => r.native);
  const statuses = saved.map((r) => relationshipHealth(r, now, reviews[recordKey(r)]));
  return {
    total: new Set(saved.map((r) => r.native!.id)).size,
    attention: statuses.filter((s) => s.health === "attention").length,
    approaching: statuses.filter((s) => s.health === "approaching").length,
    onTrack: statuses.some((s) => s.standing === "good")
      ? statuses.filter((s) => s.health === "on_track").length
      : null,
    unassessed: statuses.filter((s) => s.health === "not_assessed").length,
    sourceOnly: records.filter((r) => !r.native).length,
  };
}
export function relationshipSnippet(r: EvidenceRecord) {
  const e = r.messages.find((m) => !m.conflict);
  return e
    ? messagePlainText(e.message.body_exact, e.message.body_format).replace(/\s+/g, " ").trim()
    : null;
}
export function relationshipNextAction(r: EvidenceRecord) {
  const holds = canonicalOutreachHolds(r);
  if (holds.some((h) => h.kind === "declined")) return "Retain history · do not contact";
  if (holds.some((h) => h.kind === "permanent_email_bounce"))
    return "Confirm corrected contact · outreach remains held";
  if (r.publication?.identityHold) return "Resolve the identity hold";
  return r.nextAction === "Next action unknown" ? "Agree on the next step" : r.nextAction;
}
export function safeRoadmapUrl(url: string | undefined) {
  try {
    if (!url) return undefined;
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password ? url : undefined;
  } catch {
    return undefined;
  }
}
export function outreachBlocked(r: EvidenceRecord) {
  return (
    evidenceHolds(r).length > 0 ||
    r.native?.status === "archived" ||
    r.native?.status === "complete"
  );
}
