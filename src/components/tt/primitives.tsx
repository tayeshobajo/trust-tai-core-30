import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { AmbientDot, AmbientRule, AmbientSurface } from "@/components/tt/ambient";
import { cn } from "@/lib/utils";
import type { LifecycleStatus } from "@/domain/entities";

/* ---------------------------------- Button --------------------------------- */

export const ttButtonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium transition-colors duration-200 disabled:pointer-events-none disabled:opacity-60 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-royal text-primary-foreground shadow-action hover:bg-royal/90",
        secondary: "border border-border bg-card text-foreground hover:bg-secondary",
        quiet: "text-muted-foreground hover:text-foreground",
        signal: "bg-royal text-primary-foreground shadow-action hover:bg-royal/90",
      },
      size: {
        default: "h-11 px-5",
        sm: "h-9 px-4 text-[13px]",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

type TTButtonProps = ComponentProps<"button"> &
  VariantProps<typeof ttButtonVariants> & {
    asChild?: boolean;
    /** Shared working state: spinner plus an explicit, human-readable label. */
    pending?: boolean;
    pendingLabel?: string;
  };

export function TTButton({
  className,
  variant,
  size,
  asChild,
  pending = false,
  pendingLabel,
  children,
  disabled,
  ...props
}: TTButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(ttButtonVariants({ variant, size }), className)}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      data-pending={pending || undefined}
      {...props}
    >
      {pending && !asChild ? (
        <>
          <Loader2 aria-hidden className="animate-spin" />
          <span>{pendingLabel ?? children}</span>
        </>
      ) : (
        children
      )}
    </Comp>
  );
}

/* ---------------------------------- Input ---------------------------------- */

export function TTInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-12 w-full rounded-lg border border-input bg-card px-4 text-sm text-foreground placeholder:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function TTField({
  label,
  hint,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-foreground">
        {label}
        {optional ? <span className="ml-2 tt-eyebrow">Optional</span> : null}
      </span>
      {children}
      {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

/* -------------------------------- StatusPill ------------------------------- */

const STATUS_LABEL: Record<LifecycleStatus, string> = {
  mapped: "Mapped",
  in_build: "In build",
  live: "Live",
  needs_decision: "Needs decision",
  at_risk: "At risk",
  blocked: "Blocked",
  unknown: "Unknown",
};

const statusPill = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]",
  {
    variants: {
      tone: {
        neutral: "border-border bg-secondary text-muted-foreground",
        active: "border-royal/25 bg-royal/8 text-royal",
        good: "border-success/25 bg-success/8 text-success",
        caution: "border-warning/30 bg-warning/8 text-warning",
        risk: "border-destructive/25 bg-destructive/8 text-destructive",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

const STATUS_TONE: Record<LifecycleStatus, NonNullable<VariantProps<typeof statusPill>["tone"]>> = {
  mapped: "neutral",
  in_build: "active",
  live: "good",
  needs_decision: "caution",
  at_risk: "caution",
  blocked: "risk",
  unknown: "neutral",
};

export function StatusPill({ status, className }: { status: LifecycleStatus; className?: string }) {
  return (
    <span className={cn(statusPill({ tone: STATUS_TONE[status] }), className)}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function MetaPill({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn(statusPill({ tone: "neutral" }), className)}>{children}</span>;
}

/* ---------------------------------- Card ----------------------------------- */

export function TTCard({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("tt-surface p-6", className)} {...props} />;
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow ? <p className="tt-eyebrow mb-2">{eyebrow}</p> : null}
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        {description ? (
          <p className="mt-1 max-w-reading text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/* --------------------------------- Page header ------------------------------ */

/**
 * Page header. Pass `appId` to give the page its room's Ambient Identity Wash;
 * pass `contextAccent` when the page is about a subject with a real colour of
 * its own. Without either, the header stays the plain Trust Tai rule.
 */
export function PageHeader({
  eyebrow,
  title,
  supporting,
  action,
  appId,
  contextAccent,
}: {
  eyebrow: string;
  title: string;
  supporting?: string;
  action?: ReactNode;
  appId?: string;
  contextAccent?: string | null | undefined;
}) {
  if (appId) {
    return (
      <header className="tt-rise tt-level-secondary overflow-hidden rounded-2xl">
        <AmbientRule appId={appId} contextAccent={contextAccent} />
        <AmbientSurface
          appId={appId}
          contextAccent={contextAccent}
          depth="deep"
          className="p-6 sm:p-10"
        >
          <p className="tt-eyebrow flex items-center gap-2">
            {eyebrow}
            <AmbientDot appId={appId} contextAccent={contextAccent} />
          </p>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
            <h1 className="tt-display max-w-[16ch] text-4xl text-foreground sm:text-5xl">
              {title}
            </h1>
            {action}
          </div>
          {supporting ? (
            <p className="mt-5 max-w-reading text-base text-muted-foreground">{supporting}</p>
          ) : null}
        </AmbientSurface>
      </header>
    );
  }

  return (
    <header className="tt-rise border-b border-border pb-8">
      <p className="tt-eyebrow">{eyebrow}</p>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
        <h1 className="tt-display max-w-[16ch] text-4xl text-foreground sm:text-5xl lg:text-6xl">
          {title}
        </h1>
        {action}
      </div>
      {supporting ? (
        <p className="mt-5 max-w-reading text-base text-muted-foreground">{supporting}</p>
      ) : null}
    </header>
  );
}

/* -------------------------------- Empty state ------------------------------- */

export function EmptyState({
  title,
  belongsHere,
  whyItMatters,
  action,
}: {
  title: string;
  belongsHere: string;
  whyItMatters: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/60 p-8">
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-2 max-w-reading text-sm text-muted-foreground">{belongsHere}</p>
      <p className="mt-1 max-w-reading text-sm text-muted-foreground">{whyItMatters}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
