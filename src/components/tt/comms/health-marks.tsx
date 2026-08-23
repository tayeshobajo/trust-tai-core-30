/**
 * Shared health marks.
 *
 * A dot and a word. Health is a signal about the conversation, so the marks
 * stay quiet: no sirens, no grades, no colour without a label beside it.
 */

import {
  HEALTH_LABEL,
  type ConversationHealthStatus,
} from "@/domain/comms-health";
import { SEGMENT_LABEL, type RelationshipSegment } from "@/domain/comms";
import { cn } from "@/lib/utils";

export const HEALTH_DOT: Record<ConversationHealthStatus, string> = {
  healthy: "bg-[var(--success)]",
  needs_attention: "bg-[var(--warning)]",
  at_risk: "bg-destructive",
  quiet: "bg-muted-foreground/50",
};

export function HealthDot({
  status,
  className,
}: {
  status: ConversationHealthStatus;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", HEALTH_DOT[status], className)}
    />
  );
}

export function HealthPill({
  status,
  className,
}: {
  status: ConversationHealthStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground",
        className,
      )}
    >
      <HealthDot status={status} />
      {HEALTH_LABEL[status]}
    </span>
  );
}

/* ------------------------------------------------------------ segments */

/**
 * Classification marks: what kind of relationship this is. Deliberately a
 * separate hue family from health — royal blue says "client", soft plum says
 * "developing", and neither is ever red, amber, or green, because kind is not
 * condition.
 */
export const SEGMENT_DOT: Record<RelationshipSegment, string> = {
  client: "bg-[var(--royal)]",
  nurture: "bg-[var(--plum)]",
};

export const SEGMENT_TEXT: Record<RelationshipSegment, string> = {
  client: "text-[var(--royal)]",
  nurture: "text-[var(--plum)]",
};

/**
 * Canonical segment surfaces. Every place a row or card carries a
 * classification reads from these records, so the treatment cannot drift:
 * a quiet wash on the surface, a restrained classification edge on the
 * left, and a tinted avatar. Selected state keeps the same segment family
 * — a stronger wash plus a ring of the same hue — never a generic blue.
 */
export const SEGMENT_SURFACE: Record<RelationshipSegment, string> = {
  client: "bg-royal-wash hover:bg-royal-wash-strong",
  nurture: "bg-plum-wash hover:bg-plum-wash-strong",
};

export const SEGMENT_SURFACE_SELECTED: Record<RelationshipSegment, string> = {
  client: "bg-royal-wash-strong ring-1 ring-inset ring-royal/50",
  nurture: "bg-plum-wash-strong ring-1 ring-inset ring-plum/50",
};

export const SEGMENT_EDGE: Record<RelationshipSegment, string> = {
  client: "border-l-royal",
  nurture: "border-l-plum",
};

export const SEGMENT_AVATAR: Record<RelationshipSegment, string> = {
  client: "bg-royal-wash-strong text-royal",
  nurture: "bg-plum-wash-strong text-plum",
};

export function SegmentDot({
  segment,
  className,
}: {
  segment: RelationshipSegment;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={SEGMENT_LABEL[segment]}
      title={SEGMENT_LABEL[segment]}
      className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", SEGMENT_DOT[segment], className)}
    />
  );
}

export function SegmentPill({
  segment,
  className,
}: {
  segment: RelationshipSegment;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px]",
        SEGMENT_TEXT[segment],
        className,
      )}
    >
      <SegmentDot segment={segment} />
      {segment === "client" ? "Client" : "Developing"}
    </span>
  );
}
