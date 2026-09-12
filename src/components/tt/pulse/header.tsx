/**
 * Pulse header: quiet utilities and a compact statement band. This introduces
 * the deeper signal field without competing with the revenue cockpit above it.
 */

import { Link } from "@tanstack/react-router";
import { MoreHorizontal, Share2 } from "lucide-react";
import { useState } from "react";

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
    <div className="space-y-3 border-t border-border pt-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <nav aria-label="Breadcrumb" className="min-w-0">
          <ol className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
            <li>
              <Link to="/modules/pulse" className="hover:text-foreground">
                Pulse
              </Link>
            </li>
            <li aria-hidden>›</li>
            <li className="truncate text-foreground">What you&rsquo;re seeing</li>
          </ol>
        </nav>

        <div className="relative flex shrink-0 items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={() => void share()}
            aria-label={copied ? "Pulse link copied" : "Share pulse"}
            className="flex size-9 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-secondary sm:h-auto sm:w-auto sm:gap-2 sm:px-3 sm:py-2 sm:text-[13px]"
          >
            <Share2 className="size-4" />
            <span className="hidden sm:inline">{copied ? "Link copied" : "Share pulse"}</span>
          </button>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((v) => !v)}
            aria-label="More Pulse actions"
            className="flex size-9 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-secondary sm:h-auto sm:w-auto sm:gap-2 sm:px-3 sm:py-2 sm:text-[13px]"
          >
            <span className="hidden sm:inline">More actions</span>
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

      <header className="border-b border-border pb-5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
          <div className="min-w-0">
            <p className="tt-eyebrow text-royal">What you&rsquo;re seeing</p>
            <h1 className="tt-display mt-2 text-[26px] text-foreground sm:text-[30px]">
              What the system noticed.
            </h1>
            <p className="mt-2 max-w-reading text-[13px] text-muted-foreground">
              Signals worth attention, routed to the room where the work belongs.
            </p>
          </div>
          <p className="hidden text-right text-xs text-muted-foreground sm:block">
            {refreshing ? "Reading again." : `Last updated ${lastUpdated}`}
          </p>
        </div>
      </header>
    </div>
  );
}
