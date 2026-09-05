/**
 * The client page's frame: identity header, the six tabs, and the small set
 * of pieces every tab is built from.
 *
 * The header answers, in order: who this company is, what they are on and
 * worth, when they are next reviewed, when they renew. Each tab below reads
 * one owning room and says so. A section that could not be read says that,
 * plainly, instead of rendering an empty state that looks like calm.
 */

import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowUpRight, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

import { ClientVisual } from "@/components/tt/clients/card";
import { TTCard } from "@/components/tt/primitives";
import type { ClientHeaderFacts, ClientTab, RoomRead } from "@/domain/client-shell";
import { CLIENT_TAB_LABEL, CLIENT_TABS } from "@/domain/client-shell";
import type { ClientCard } from "@/domain/clients-book";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ header */

export function ClientHeader({
  card,
  facts,
  websiteUrl,
  warnings,
}: {
  card: ClientCard;
  facts: ClientHeaderFacts;
  websiteUrl: string | null;
  warnings: string[];
}) {
  const host = websiteUrl ? hostOf(websiteUrl) : null;
  return (
    <header className="relative overflow-hidden rounded-2xl border border-border bg-card px-6 py-6 sm:px-8">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, color-mix(in oklab, var(--royal) 6%, transparent) 0%, transparent 190px)",
        }}
      />
      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-start">
        <ClientVisual card={card} className="w-28 shrink-0 rounded-xl sm:w-32" />
        <div className="min-w-0 flex-1">
          <p className="tt-eyebrow text-royal">Client</p>
          <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight text-foreground sm:text-4xl">
            {card.name}
          </h1>
          <p className="mt-2 text-[15px] text-foreground">{facts.tierAndValue}</p>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">Review</dt>
              <dd className={cn(facts.reviewOverdue ? "font-medium text-foreground" : "text-foreground")}>
                {facts.nextReview}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">Renewal</dt>
              <dd className="text-foreground">{facts.renewal}</dd>
            </div>
            {websiteUrl && host ? (
              <div className="flex gap-1.5">
                <dt className="sr-only">Website</dt>
                <dd>
                  <a
                    href={websiteUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-royal hover:underline"
                  >
                    {host}
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>
          {warnings.length > 0 ? (
            <ul className="mt-4 space-y-1" aria-label="Needs you">
              {warnings.map((warning) => (
                <li
                  key={warning}
                  className="flex items-center gap-2 text-[13px] font-medium text-foreground"
                >
                  <AlertTriangle className="size-4 text-warning" aria-hidden />
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------- tabs */

export function ClientTabs({ clientId, active }: { clientId: string; active: ClientTab }) {
  return (
    <nav
      role="tablist"
      aria-label="Client sections"
      className="flex gap-1 overflow-x-auto border-b border-border"
    >
      {CLIENT_TABS.map((tab) => {
        const selected = tab === active;
        return (
          <Link
            key={tab}
            to="/modules/clients/$clientId"
            params={{ clientId }}
            search={tab === "overview" ? {} : { tab }}
            role="tab"
            aria-selected={selected}
            resetScroll={false}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2.5 text-[13px] transition-colors",
              selected
                ? "border-royal font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {CLIENT_TAB_LABEL[tab]}
          </Link>
        );
      })}
    </nav>
  );
}

/* ----------------------------------------------------------------- pieces */

/**
 * A section that reads another room. The eyebrow names the owner; the
 * optional deep link goes there. Nothing in a section is a second copy.
 */
export function RoomSection({
  eyebrow,
  title,
  description,
  openLabel,
  openTo,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  openLabel?: string;
  openTo?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`section-${slug(title)}`}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="tt-eyebrow">{eyebrow}</p>
          <h2 id={`section-${slug(title)}`} className="mt-1 text-lg font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {openTo ? <div className="text-sm font-medium text-royal">{openTo}</div> : null}
        {openLabel && !openTo ? (
          <span className="text-[13px] text-muted-foreground">{openLabel}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** A deep link into the room that owns the truth. */
export function OpenIn({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      {children}
      <ArrowUpRight className="size-3.5" aria-hidden />
    </span>
  );
}

/** The honest line for a source that could not be asked. */
export function Unreadable({ what, because }: { what: string; because?: string }) {
  return (
    <TTCard className="border-dashed p-4" role="status">
      <p className="text-sm font-medium text-foreground">{what} could not be read just now.</p>
      {because ? <p className="mt-1 text-[13px] text-muted-foreground">{because}</p> : null}
    </TTCard>
  );
}

/** A plain fact of absence. Never dressed up as health. */
export function Absent({ line, because }: { line: string; because?: string }) {
  return (
    <TTCard className="p-4">
      <p className="text-sm text-foreground">{line}</p>
      {because ? <p className="mt-1 text-[13px] text-muted-foreground">{because}</p> : null}
    </TTCard>
  );
}

export function Fact({
  label,
  value,
  note,
  emphasis = false,
}: {
  label: string;
  value: string;
  note?: string | null;
  emphasis?: boolean;
}) {
  return (
    <TTCard className="p-4">
      <p className="tt-eyebrow">{label}</p>
      <p className={cn("mt-2 text-sm", emphasis ? "font-medium text-foreground" : "text-foreground")}>
        {value}
      </p>
      {note ? <p className="mt-1 text-[12px] text-muted-foreground">{note}</p> : null}
    </TTCard>
  );
}

/**
 * Render a room read: the value when it arrived, the honest line when it did
 * not, and a quiet reading line while it is still on its way.
 */
export function ReadOrSay<T>({
  read,
  loading,
  what,
  children,
}: {
  read: RoomRead<T> | null;
  loading: boolean;
  what: string;
  children: (value: T) => ReactNode;
}) {
  if (loading || read === null) {
    return <p className="text-sm text-muted-foreground">Reading {what.toLowerCase()}.</p>;
  }
  if (!read.available) return <Unreadable what={what} because={read.because} />;
  return <>{children(read.value)}</>;
}
