/**
 * The client tile, the views above the grid, and the quieter proposed row.
 *
 * One hierarchy, everywhere: company, then tier and value, then review, then
 * delivery. The visual area is restrained and truthful: the company's own
 * logo when a person recorded one, otherwise two initials. No stock imagery,
 * no decorative controls. Warnings only appear when something is genuinely
 * wrong, so a normal client reads as calm rather than as an alert with no
 * alarm.
 */

import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { CLIENTS_VIEWS, type ClientCard, type ClientsView } from "@/domain/clients-book";

const VIEW_LABEL: Record<ClientsView, string> = {
  all: "All clients",
  run: "Run",
  build: "Build",
  diagnose: "Diagnose",
};

export function ClientsViews({
  view,
  counts,
  onChange,
}: {
  view: ClientsView;
  counts: Record<ClientsView, number>;
  onChange: (next: ClientsView) => void;
}) {
  return (
    <div role="tablist" aria-label="Client views" className="flex flex-wrap gap-2">
      {CLIENTS_VIEWS.map((candidate) => {
        const active = candidate === view;
        return (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(candidate)}
            className={cn(
              "rounded-full border px-4 py-2 text-[13px] transition-colors",
              active
                ? "border-transparent bg-royal text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {VIEW_LABEL[candidate]}
            <span className="ml-2 font-mono text-[10px] opacity-70">{counts[candidate]}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The featured visual area: 3:2, quiet, and only ever the company's real mark.
 * A recorded logo sits on a plain card surface; without one, the initials
 * tile stands in. Nothing here is generated or borrowed.
 */
export function ClientVisual({
  card,
  muted = false,
  className,
}: {
  card: Pick<ClientCard, "name" | "initials" | "logoUrl">;
  muted?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex aspect-[3/2] w-full items-center justify-center overflow-hidden rounded-xl border border-border",
        muted ? "bg-secondary/50" : "bg-secondary",
        className,
      )}
    >
      {card.logoUrl ? (
        <img
          src={card.logoUrl}
          alt={`${card.name} logo`}
          loading="lazy"
          className="max-h-[56%] max-w-[64%] object-contain"
        />
      ) : (
        <span
          aria-hidden
          className={cn(
            "tt-display text-3xl tracking-tight sm:text-4xl",
            muted ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {card.initials}
        </span>
      )}
    </div>
  );
}

const TILE =
  "group tt-surface tt-rise block p-4 transition-[transform,border-color,box-shadow] duration-200 ease-out " +
  "motion-safe:hover:-translate-y-0.5 motion-safe:hover:scale-[1.02] hover:border-royal " +
  "focus-visible:outline-none focus-visible:-translate-y-0.5 focus-visible:border-royal focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function OpenAffordance() {
  return (
    <span
      aria-hidden
      className="flex items-center gap-1 text-[13px] font-medium text-royal opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      Open client
      <ArrowRight className="size-3.5" />
    </span>
  );
}

export function ClientTile({ card }: { card: ClientCard }) {
  return (
    <Link
      to="/modules/clients/$clientId"
      params={{ clientId: card.id }}
      aria-label={`Open ${card.name}`}
      className={TILE}
    >
      <ClientVisual card={card} />
      <div className="mt-4 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <h3 className="truncate text-base font-semibold tracking-tight text-foreground">
            {card.name}
          </h3>
          <OpenAffordance />
        </div>
        <p className="mt-1 text-sm text-foreground">{card.commercialLine}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{card.reviewLine}</p>
        {card.deliveryLine ? (
          <p className="mt-3 line-clamp-2 border-t border-border pt-3 text-[13px] text-muted-foreground">
            {card.deliveryLine}
          </p>
        ) : null}
        {card.warnings.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {card.warnings.map((warning) => (
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
    </Link>
  );
}

export function ClientGrid({ cards }: { cards: ClientCard[] }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <ClientTile key={card.id} card={card} />
      ))}
    </div>
  );
}

/** A proposed company: not a client yet, so quieter, smaller and below. */
export function ProposedTile({ card }: { card: ClientCard }) {
  return (
    <Link
      to="/modules/clients/$clientId"
      params={{ clientId: card.id }}
      aria-label={`Open ${card.name}, proposed`}
      className={cn(TILE, "flex items-center gap-4 bg-card/60 p-3")}
    >
      <ClientVisual card={card} muted className="w-20 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="truncate text-sm font-semibold tracking-tight text-foreground">
            {card.name}
          </h3>
          <OpenAffordance />
        </div>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{card.proposalLine}</p>
        {card.proposalNote ? (
          <p className="mt-0.5 text-[12px] text-muted-foreground">{card.proposalNote}</p>
        ) : null}
      </div>
    </Link>
  );
}

export function ProposedList({ cards }: { cards: ClientCard[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {cards.map((card) => (
        <ProposedTile key={card.id} card={card} />
      ))}
    </div>
  );
}
