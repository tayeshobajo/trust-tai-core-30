import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";
import { initialsOf } from "@/domain/steward-accountability";

/** A compact, real-value summary tile. Never shows an invented count. */
export function SummaryCard({
  label,
  value,
  supporting,
  icon,
}: {
  label: string;
  value: string;
  supporting?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="tt-surface flex min-w-0 items-start gap-3 p-5">
      {icon ? (
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-cloud-strong text-royal">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0">
        <p className="tt-eyebrow">{label}</p>
        <p className="mt-1 truncate text-[17px] font-medium text-foreground">{value}</p>
        {supporting ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{supporting}</p>
        ) : null}
      </div>
    </div>
  );
}

export function TTSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-11 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-50",
        checked ? "border-royal bg-royal" : "border-border bg-secondary",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-0.5 size-4 rounded-full bg-card transition-transform",
          checked ? "translate-x-[22px]" : "translate-x-[3px]",
        )}
      />
    </button>
  );
}

/** Person chip: photo when we have one, initials when we do not. */
export function PersonChip({
  name,
  email,
  avatarUrl,
  supporting,
}: {
  name: string;
  email?: string;
  avatarUrl?: string | null;
  supporting?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="size-9 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-cloud-strong text-xs font-medium text-royal">
          {initialsOf(name)}
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">{name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {supporting ?? email ?? ""}
        </span>
      </span>
    </div>
  );
}

/**
 * Said once, plainly, when a settings table has not been applied to the
 * database yet. Nothing is simulated in its place.
 */
export function NotProvisioned({ what, file }: { what: string; file: string }) {
  return (
    <div className="rounded-xl border border-warning/30 bg-warning/8 p-4">
      <p className="text-sm text-foreground">{what} is not stored in this workspace yet.</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Apply <span className="font-mono">{file}</span> to the Trust Tai database to turn it on.
        Until then this screen reads only what already exists, and changes cannot be saved.
      </p>
    </div>
  );
}

export function Health({ tone, children }: { tone: "good" | "caution" | "risk" | "neutral"; children: ReactNode }) {
  const map = {
    good: "border-success/25 bg-success/8 text-success",
    caution: "border-warning/30 bg-warning/8 text-warning",
    risk: "border-destructive/25 bg-destructive/8 text-destructive",
    neutral: "border-border bg-secondary text-muted-foreground",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]",
        map[tone],
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
