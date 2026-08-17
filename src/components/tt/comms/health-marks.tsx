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
