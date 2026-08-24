/**
 * Small shared pieces for the Scout company detail page: section shells,
 * strength/status treatments and empty states. Weight is deliberate, the
 * summary card carries more than the activity list.
 */

import type { ReactNode } from "react";
import { ArrowRight, Check, CircleHelp, Minus, X } from "lucide-react";

import type { ICPFactorStatus } from "@/data/scout/icp-factors";
import type { SignalStrength } from "@/data/scout/top-signals";
import { cn } from "@/lib/utils";

export function DetailSection({
  title,
  meta,
  action,
  children,
  emphasis = "normal",
  className,
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  emphasis?: "lead" | "normal" | "quiet";
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl",
        emphasis === "lead"
          ? "tt-level-primary"
          : emphasis === "quiet"
            ? "tt-level-tertiary"
            : "tt-level-secondary",
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <div className="flex min-w-0 items-center gap-3">
          <h2
            className={cn(
              "truncate text-foreground",
              emphasis === "lead"
                ? "text-[18px] font-semibold tracking-tight"
                : emphasis === "quiet"
                  ? "text-[14px] font-medium"
                  : "text-[15px] font-semibold tracking-tight",
            )}
          >
            {title}
          </h2>
          {meta ? (
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{meta}</span>
          ) : null}
        </div>
        {action}
      </header>
      <div className="px-5 pb-5 pt-4">{children}</div>
    </section>
  );
}

export function SectionLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-royal underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
      <ArrowRight aria-hidden className="size-3.5" />
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border bg-surface-tertiary px-4 py-5 text-[13px] text-muted-foreground">
      {children}
    </p>
  );
}

const STRENGTH_TONE: Record<SignalStrength, string> = {
  strong: "border-success/25 bg-success/8 text-success",
  medium: "border-royal/25 bg-royal/8 text-royal",
  weak: "border-border bg-secondary text-muted-foreground",
};

export function StrengthPill({ strength }: { strength: SignalStrength }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em]",
        STRENGTH_TONE[strength],
      )}
    >
      {strength}
    </span>
  );
}

const FACTOR_ICON: Record<ICPFactorStatus, typeof Check> = {
  matched: Check,
  partial: Minus,
  not_matched: X,
  unknown: CircleHelp,
};

const FACTOR_TONE: Record<ICPFactorStatus, string> = {
  matched: "border-success/25 bg-success/10 text-success",
  partial: "border-warning/30 bg-warning/10 text-warning",
  not_matched: "border-destructive/25 bg-destructive/8 text-destructive",
  unknown: "border-border bg-secondary text-muted-foreground",
};

export function FactorIcon({ status }: { status: ICPFactorStatus }) {
  const Icon = FACTOR_ICON[status];
  return (
    <span
      className={cn(
        "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border",
        FACTOR_TONE[status],
      )}
    >
      <Icon aria-hidden className="size-3" />
    </span>
  );
}

export function relativeTime(value?: string): string {
  if (!value) return "-";
  const at = Date.parse(value);
  if (Number.isNaN(at)) return "-";
  const days = Math.floor((Date.now() - at) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}
