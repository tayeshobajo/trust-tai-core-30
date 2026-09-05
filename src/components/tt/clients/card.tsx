/**
 * The client card, and the views above it.
 *
 * One hierarchy, everywhere: company, then tier and value, then review, then
 * delivery. Warnings only appear when something is genuinely wrong, so a
 * normal client reads as calm rather than as an alert with no alarm.
 */

import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ClientCard, ClientsView } from "@/domain/clients-book";

const VIEW_LABEL: Record<ClientsView, string> = {
  all: "All clients",
  run: "Run",
  build: "Build",
  diagnose: "Diagnose",
  proposed: "Proposed",
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
      {(Object.keys(VIEW_LABEL) as ClientsView[]).map((candidate) => {
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

function Monogram({ card }: { card: ClientCard }) {
  if (card.logoUrl) {
    return (
      <img
        src={card.logoUrl}
        alt={`${card.name} logo`}
        className="size-11 shrink-0 rounded-xl border border-border object-contain bg-card p-1"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-sm font-medium text-foreground"
    >
      {card.initials}
    </span>
  );
}

export function ClientTile({ card }: { card: ClientCard }) {
  return (
    <Link
      to="/modules/clients/$clientId"
      params={{ clientId: card.id }}
      className="tt-surface tt-rise block p-5 transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start gap-4">
        <Monogram card={card} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold tracking-tight text-foreground">
            {card.name}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{card.commercialLine}</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{card.reviewLine}</p>
          {card.deliveryLine ? (
            <p className="mt-3 line-clamp-2 border-t border-border pt-3 text-[13px] text-muted-foreground">
              {card.deliveryLine}
            </p>
          ) : null}
          {card.proposalNote ? (
            <p className="mt-3 border-t border-border pt-3 text-[13px] text-muted-foreground">
              {card.proposalNote}
            </p>
          ) : null}
          {card.warnings.length > 0 ? (
            <ul className="mt-3 space-y-1">
              {card.warnings.map((warning) => (
                <li
                  key={warning}
                  className="flex items-center gap-2 text-[13px] font-medium text-foreground"
                >
                  <AlertTriangle className="size-4 text-caution" aria-hidden />
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

export function ClientGrid({ cards }: { cards: ClientCard[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <ClientTile key={card.id} card={card} />
      ))}
    </div>
  );
}
