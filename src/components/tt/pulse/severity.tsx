/**
 * Severity language: icon, tint and label. Colour always means one of the four
 * attention levels, never decoration.
 */

import { AlertTriangle, Eye, Info, Scale, type LucideIcon } from "lucide-react";

import { PULSE_SEVERITY_LABEL, type PulseSeverity, type PulseImpactLevel } from "@/domain/pulse";
import { cn } from "@/lib/utils";

const ICON: Record<PulseSeverity, LucideIcon> = {
  act_now: AlertTriangle,
  evaluate: Scale,
  watch_closely: Eye,
  good_to_know: Info,
};

/** Foreground colour per level. */
export const SEVERITY_TEXT: Record<PulseSeverity, string> = {
  act_now: "text-destructive",
  evaluate: "text-ember",
  watch_closely: "text-warning",
  good_to_know: "text-royal",
};

/** Soft surface behind the icon and the section chip. */
export const SEVERITY_SURFACE: Record<PulseSeverity, string> = {
  act_now: "bg-destructive/10",
  evaluate: "bg-ember/10",
  watch_closely: "bg-warning/10",
  good_to_know: "bg-royal/10",
};

export const SEVERITY_BORDER: Record<PulseSeverity, string> = {
  act_now: "border-destructive/30",
  evaluate: "border-ember/30",
  watch_closely: "border-warning/30",
  good_to_know: "border-royal/25",
};

export function PulseSeverityIcon({
  severity,
  className,
}: {
  severity: PulseSeverity;
  className?: string;
}) {
  const Icon = ICON[severity];
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-lg",
        SEVERITY_SURFACE[severity],
        SEVERITY_TEXT[severity],
        className,
      )}
    >
      <Icon className="size-[18px]" />
    </span>
  );
}

export function PulseSeverityChip({ severity }: { severity: PulseSeverity }) {
  return (
    <span
      className={cn(
        "font-mono text-[10px] uppercase tracking-[0.16em]",
        SEVERITY_TEXT[severity],
      )}
    >
      {PULSE_SEVERITY_LABEL[severity]}
    </span>
  );
}

const IMPACT_TEXT: Record<PulseImpactLevel, string> = {
  high: "text-destructive",
  medium: "text-warning",
  low: "text-success",
};

export function PulseImpact({ impact }: { impact: PulseImpactLevel }) {
  return (
    <span className={cn("text-[13px] font-medium capitalize", IMPACT_TEXT[impact])}>{impact}</span>
  );
}
