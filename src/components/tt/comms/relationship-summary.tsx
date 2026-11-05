import {
  CalendarDays,
  Clock3,
  FilePlus2,
  Info,
  UserRound,
  Tag,
  MessageSquare,
  ArrowUpRight,
} from "lucide-react";
import type { Relationship } from "@/domain/comms";
import { STAGE_LABEL } from "@/domain/comms";
import { HEALTH_LABEL, type ConversationHealth } from "@/domain/comms-health";
import { HealthDot } from "./health-marks";

function dateLabel(value?: string) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not recorded"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** A read of the selected record; never guesses ownership, links, or channels. */
export function RelationshipSummary({
  relationship,
  health,
  ownerLabel,
  onContext,
  onProfile,
  onInteraction,
}: {
  relationship: Relationship;
  health: ConversationHealth;
  ownerLabel?: string;
  onContext: () => void;
  onProfile: () => void;
  onInteraction: () => void;
}) {
  const rows = [
    {
      icon: UserRound,
      label: "Owner",
      value: ownerLabel || (relationship.ownerUserId ? "Assigned team member" : "Unassigned"),
    },
    { icon: CalendarDays, label: "Next follow-up", value: dateLabel(relationship.followUpDueAt) },
    { icon: Tag, label: "Stage", value: STAGE_LABEL[relationship.stage] },
    { icon: Clock3, label: "Last activity", value: dateLabel(health.lastActivityAt) },
    {
      icon: Clock3,
      label: "Latest incoming",
      value: health.lastReplyAt
        ? `${health.lastIncomingApproximate ? "Approx. " : ""}${new Date(health.lastReplyAt).toLocaleString()}`
        : "Not recorded",
    },
    {
      icon: Clock3,
      label: "Latest outgoing",
      value: health.lastOutboundAt
        ? `${health.lastOutgoingApproximate ? "Approx. " : ""}${new Date(health.lastOutboundAt).toLocaleString()}`
        : "Not recorded",
    },
    { icon: CalendarDays, label: "Response due", value: dateLabel(relationship.responseDueAt) },
    { icon: MessageSquare, label: "Email", value: relationship.email || "Not recorded" },
  ];
  return (
    <div className="comms-summary">
      <section className="comms-card">
        <h2 className="comms-panel-title">Relationship</h2>
        <button className="comms-health-summary" onClick={onContext} type="button">
          <HealthDot status={health.status} />
          <span>
            <strong>{HEALTH_LABEL[health.status]}</strong>
            <small>{health.reasons[0] || "View relationship context"}</small>
          </span>
          <ArrowUpRight size={16} aria-hidden />
        </button>
        <dl>
          {rows.map(({ icon: Icon, label, value }) => (
            <div className="comms-summary-row" key={label}>
              <dt>
                <Icon size={16} aria-hidden />
                {label}
              </dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <button className="comms-summary-link" type="button" onClick={onProfile}>
          Profile & connections <ArrowUpRight size={14} aria-hidden />
        </button>
      </section>
      <section className="comms-card">
        <h2 className="comms-panel-title">Quick Actions</h2>
        <div className="comms-quick-actions">
          <button type="button" onClick={onContext}>
            <Info size={17} aria-hidden />
            Review context & commitments
          </button>
          <button type="button" onClick={onInteraction}>
            <FilePlus2 size={17} aria-hidden />
            Add interaction or evidence
          </button>
          <button type="button" onClick={onProfile}>
            <UserRound size={17} aria-hidden />
            View / edit relationship
          </button>
        </div>
      </section>
    </div>
  );
}
