/**
 * The Conductor hero: a quiet band that says where you are and what this room
 * is for. The orbit mark is the Pulse radar's calmer relative — the same idea
 * (many rooms, one reading) said with less urgency, because nothing here is
 * asking for attention. It is waiting for a question.
 */

import { AmbientRule, AmbientSurface } from "@/components/tt/ambient";

function Orbit() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 220 140"
      className="hidden h-[124px] w-[220px] shrink-0 text-royal sm:block"
    >
      <ellipse cx="110" cy="70" rx="86" ry="34" fill="none" stroke="currentColor" strokeOpacity="0.16" />
      <ellipse cx="110" cy="70" rx="56" ry="22" fill="none" stroke="currentColor" strokeOpacity="0.2" />
      <ellipse cx="110" cy="70" rx="26" ry="10" fill="none" stroke="currentColor" strokeOpacity="0.26" />
      <circle cx="110" cy="70" r="5" fill="currentColor" />
      <circle cx="196" cy="70" r="3" fill="currentColor" fillOpacity="0.55" />
      <circle cx="66" cy="88" r="2.5" fill="currentColor" fillOpacity="0.45" />
      <circle cx="136" cy="49" r="2.5" fill="currentColor" fillOpacity="0.4" />
    </svg>
  );
}

export function ConductorHeader({ onExplain }: { onExplain: () => void }) {
  return (
    <header className="tt-rise overflow-hidden rounded-2xl border border-border bg-card">
      <AmbientRule appId="conductor" />
      <AmbientSurface appId="conductor" className="px-6 py-7 sm:px-8">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <p className="tt-eyebrow text-royal">Conductor</p>
              <button
                type="button"
                onClick={onExplain}
                className="rounded-full border border-border bg-card px-3 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground sm:hidden"
              >
                What can Conductor do?
              </button>
            </div>
            <h1 className="tt-display mt-3 max-w-[20ch] text-[30px] text-foreground sm:text-[36px]">
              Ask Trust Tai.
            </h1>
            <p className="mt-3 max-w-reading text-sm text-muted-foreground">
              One question, one grounded answer, one clear next move when action is warranted.
            </p>
          </div>

          <div className="flex flex-col items-end gap-3">
            <button
              type="button"
              onClick={onExplain}
              className="hidden rounded-full border border-border bg-card px-3 py-2 text-[13px] text-foreground transition-colors hover:bg-secondary sm:block"
            >
              What can Conductor do?
            </button>
            <Orbit />
          </div>
        </div>
      </AmbientSurface>
    </header>
  );
}
