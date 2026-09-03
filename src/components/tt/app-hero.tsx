import type { ReactNode } from "react";

import { AmbientRule, AmbientSurface } from "@/components/tt/ambient";
import { cn } from "@/lib/utils";

/**
 * Compact room header.
 *
 * One band, roughly 200px tall: mono label, serif statement, one supporting
 * line, and the room's primary action. The per-app accent stays as a light
 * wash, atmosphere, never decoration that costs working space.
 */
export function AppHero({
  appId,
  eyebrow,
  greeting,
  title,
  supporting,
  action,
  className,
}: {
  appId: string;
  eyebrow: string;
  greeting?: string | undefined;
  title: string;
  supporting?: string | undefined;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("tt-rise tt-level-secondary overflow-hidden rounded-2xl", className)}>
      <AmbientRule appId={appId} />
      <AmbientSurface appId={appId} className="px-6 py-7 sm:px-8 sm:py-8">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-6">
          <div className="min-w-0">
            <p className="tt-eyebrow">{eyebrow}</p>
            {greeting ? (
              <p className="mt-3 font-display text-xl text-muted-foreground">{greeting}</p>
            ) : null}
            <h1
              className={cn(
                "tt-display max-w-[22ch] text-[28px] text-foreground sm:text-[34px]",
                greeting ? "mt-1" : "mt-3",
              )}
            >
              {title}
            </h1>
            {supporting ? (
              <p className="mt-3 max-w-reading text-sm text-muted-foreground">{supporting}</p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      </AmbientSurface>
    </header>
  );
}
