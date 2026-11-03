import { evidenceHolds, type EvidenceRecord } from "./roadmap-evidence";
import { conversationEvents } from "./roadmap-conversation";
export interface StandingReview {
  reviewedAt: string;
  validThrough: string;
  reviewer: string;
  sourceRef: string;
  coverage: "reviewed_current";
}
const validDay = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
export function followUpState(record: EvidenceRecord, now: Date, review?: StandingReview) {
  const today = now.toISOString().slice(0, 10);
  const raw = record.followUp;
  const valid = Boolean(
    raw &&
    /^\d{4}-\d{2}-\d{2}$/.test(raw) &&
    Number.isFinite(Date.parse(raw)) &&
    new Date(raw).toISOString().slice(0, 10) === raw,
  );
  const days = valid ? (Date.parse(raw!) - Date.parse(today)) / 86400000 : null;
  const inactive = record.native?.status === "archived" || record.native?.status === "complete";
  const state = inactive
    ? "inactive"
    : days === null
      ? "needs_scheduling"
      : days < 0
        ? "overdue"
        : days === 0
          ? "due_today"
          : days <= 7
            ? "upcoming"
            : "scheduled";
  const holds = evidenceHolds(record);
  const latest = conversationEvents(record)[0];
  const reviewed = Boolean(
    review &&
    review.coverage === "reviewed_current" &&
    review.reviewer.trim() &&
    review.sourceRef.trim() &&
    Number.isFinite(Date.parse(review.reviewedAt)) &&
    Date.parse(review.reviewedAt) <= now.getTime() &&
    validDay(review.validThrough) &&
    Date.parse(review.validThrough) >= Date.parse(today) &&
    (!latest || Date.parse(latest.at) <= Date.parse(review.reviewedAt)),
  );
  const good =
    reviewed &&
    !holds.length &&
    !inactive &&
    Boolean(
      record.owner &&
      !["Unknown", "Unassigned"].includes(record.owner) &&
      record.nextAction &&
      record.nextAction !== "Next action unknown",
    ) &&
    days !== null &&
    days > 0;
  return {
    state,
    days,
    date: valid ? raw : null,
    standing: good ? "good" : holds.length ? "held" : "unverified",
    label:
      state === "inactive"
        ? "Closed / archived"
        : state === "overdue"
          ? "Overdue"
          : state === "due_today"
            ? "Due today"
            : state === "upcoming"
              ? "Upcoming · next 7 days"
              : state === "scheduled"
                ? "Scheduled"
                : "Needs scheduling",
    rank:
      state === "inactive"
        ? 5
        : state === "overdue"
          ? 0
          : state === "due_today"
            ? 1
            : state === "needs_scheduling"
              ? 2
              : state === "upcoming"
                ? 3
                : 4,
    holds,
  };
}
