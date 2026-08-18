import type { FitLight } from "@/domain/scout-fit";
import type { ProspectStatus } from "@/domain/entities";
import { cn } from "@/lib/utils";

/** Traffic-light colour is ICP FIT only, never workflow stage. */
const LIGHT_DOT: Record<FitLight, string> = {
  green: "bg-success",
  yellow: "bg-warning",
  red: "bg-destructive",
  neutral: "bg-border",
};

export const FIT_LIGHT_LABEL: Record<FitLight, string> = {
  green: "Strong fit",
  yellow: "Mixed fit",
  red: "Poor fit",
  neutral: "Not scored",
};

export function FitDot({ light, className }: { light: FitLight; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2.5 shrink-0 rounded-full ring-2 ring-inset ring-card",
        LIGHT_DOT[light],
        className,
      )}
    />
  );
}

/** Dot plus text, so colour is never the only carrier of meaning. */
export function FitIndicator({
  light,
  score,
  scoreable,
  className,
}: {
  light: FitLight;
  score: number;
  scoreable: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <FitDot light={light} />
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
        {scoreable ? `${score}%` : "-"}
      </span>
      <span className="sr-only">{FIT_LIGHT_LABEL[light]}</span>
    </span>
  );
}

/** Workflow stage. Deliberately monochrome. */
export const STAGE_LABEL: Record<ProspectStatus, string> = {
  discovered: "New",
  reviewing: "Reviewing",
  qualified: "Qualified",
  ready_for_comms: "Ready for Comms",
  passed: "Passed",
  converted: "Converted",
  archived: "Archived",
};

export function StageTag({ status }: { status: ProspectStatus }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-secondary px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
      {STAGE_LABEL[status]}
    </span>
  );
}

export function formatChecked(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}
