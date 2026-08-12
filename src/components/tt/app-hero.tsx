import type { ReactNode } from "react";

import { AppMotifArt } from "@/components/tt/app-motif";
import { getAppTheme } from "@/domain/app-theme";
import { cn } from "@/lib/utils";

/**
 * Framed editorial hero. The motif frame is a fixed slot: an art-directed
 * photograph can replace the abstract motif later without changing layout.
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
  const theme = getAppTheme(appId);

  return (
    <header
      className={cn(
        "tt-rise overflow-hidden rounded-2xl border border-border bg-card",
        className,
      )}
    >
      <div className="grid gap-0 lg:grid-cols-[1.35fr_1fr]">
        <div className="p-6 sm:p-10 lg:p-12">
          <p className="tt-eyebrow">{eyebrow}</p>
          {greeting ? (
            <p className="mt-5 font-display text-2xl text-muted-foreground sm:text-3xl">
              {greeting}
            </p>
          ) : null}
          <h1
            className={cn(
              "tt-display max-w-[18ch] text-3xl text-foreground sm:text-4xl lg:text-5xl",
              greeting ? "mt-2" : "mt-5",
            )}
          >
            {title}
          </h1>
          {supporting ? (
            <p className="mt-5 max-w-reading text-base text-muted-foreground">{supporting}</p>
          ) : null}
          <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {theme.character}
          </p>
          {action ? <div className="mt-7">{action}</div> : null}
        </div>

        <div
          className="relative min-h-44 border-t border-border sm:min-h-56 lg:min-h-full lg:border-l lg:border-t-0"
          style={{
            backgroundColor: `color-mix(in oklab, ${theme.tint} 5%, var(--card))`,
          }}
        >
          <AppArtwork appId={appId} className="absolute inset-0" />
        </div>
      </div>
    </header>
  );
}
