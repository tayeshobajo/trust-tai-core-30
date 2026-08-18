/**
 * Pulse header: breadcrumb, quiet utilities, and one compact statement band
 * with a radar mark. Signals arrive from across the suite; the mark says that
 * without asking for attention itself.
 */

import { Link } from "@tanstack/react-router";
import { MoreHorizontal, Share2 } from "lucide-react";
import { useState } from "react";

import { AmbientRule, AmbientSurface } from "@/components/tt/ambient";

function Radar() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 220 150"
      className="hidden h-[132px] w-[220px] shrink-0 text-royal sm:block"
    >
      {[26, 42, 58].map((r) => (
        <circle
          key={r}
          cx="110"
          cy="75"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.18"
        />
      ))}
      <circle cx="110" cy="75" r="4" fill="currentColor" />
      <circle cx="152" cy="55" r="3.5" className="fill-royal" />
      <circle cx="80" cy="47" r="3" className="fill-warning" />
      <circle cx="66" cy="104" r="3.5" className="fill-destructive" />
      <circle cx="168" cy="96" r="3" className="fill-success" />
      <circle cx="128" cy="30" r="2.5" className="fill-success" />
      <circle cx="96" cy="76" r="2.5" className="fill-muted-foreground" />
    </svg>
  );
}

export function PulseHeader({
  lastUpdated,
  onRefresh,
  refreshing,
}: {
  lastUpdated: string;
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState(false);

  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <nav aria-label="Breadcrumb" className="min-w-0">
          <ol className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
            <li>
              <Link to="/modules/pulse" className="hover:text-foreground">
                Pulse
              </Link>
            </li>
            <li aria-hidden>›</li>
            <li className="truncate text-foreground">What Tai is seeing</li>
          </ol>
        </nav>

        <div className="relative flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void share()}
            className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-[13px] text-foreground transition-colors hover:bg-secondary"
          >
            <Share2 className="size-4" />
            {copied ? "Link copied" : "Share pulse"}
          </button>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((v) => !v)}
            className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-[13px] text-foreground transition-colors hover:bg-secondary"
          >
            More actions
            <MoreHorizontal className="size-4" />
          </button>
          {menu ? (
            <div
              role="menu"
              className="absolute right-0 top-11 z-20 w-52 rounded-xl border border-border bg-popover p-1 shadow-tt-md"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  onRefresh();
                }}
                className="w-full rounded-lg px-3 py-2 text-left text-[13px] text-foreground hover:bg-secondary"
              >
                Read the suite again
              </button>
              <Link
                to="/modules/conductor"
                role="menuitem"
                onClick={() => setMenu(false)}
                className="block rounded-lg px-3 py-2 text-left text-[13px] text-foreground hover:bg-secondary"
              >
                Open Conductor
              </Link>
            </div>
          ) : null}
        </div>
      </div>

      <p className="text-right text-xs text-muted-foreground">
        {refreshing ? "Reading again." : `Last updated ${lastUpdated}`}
      </p>

      <header className="tt-rise overflow-hidden rounded-2xl border border-border bg-card">
        <AmbientRule appId="pulse" />
        <AmbientSurface appId="pulse" className="px-6 py-7 sm:px-8">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-6">
            <div className="min-w-0">
              <p className="tt-eyebrow text-royal">What Tai is seeing</p>
              <h1 className="tt-display mt-3 max-w-[20ch] text-[30px] text-foreground sm:text-[36px]">
                What the system noticed.
              </h1>
              <p className="mt-3 max-w-reading text-sm text-muted-foreground">
                Signals worth your attention. Each one comes with context, implications, and where
                the work happens.
              </p>
            </div>
            <Radar />
          </div>
        </AmbientSurface>
      </header>
    </div>
  );
}
