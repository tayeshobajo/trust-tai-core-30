import { Link } from "@tanstack/react-router";

import { HOME_HERO_IMAGE } from "@/domain/home-imagery";
import { TTButton } from "@/components/tt/primitives";

/**
 * The entrance to the Trust Tai world.
 *
 * Copy on the left, one atmospheric photograph on the right, one action.
 * Nothing else belongs in this band.
 */
export function HomeHero({ firstName }: { firstName?: string | undefined }) {
  return (
    <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
      <div className="grid items-stretch gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <div className="flex flex-col justify-center gap-6 bg-gradient-to-b from-cloud to-card px-7 py-12 sm:px-12 sm:py-16">
          <p className="tt-eyebrow">{firstName ? `Welcome home, ${firstName}.` : "Welcome home."}</p>
          <h1 className="tt-display max-w-[16ch] text-[34px] leading-[1.08] text-foreground sm:text-[46px]">
            One operating system for how Trust Tai works.
          </h1>
          <p className="max-w-reading text-[15px] leading-relaxed text-muted-foreground">
            A shared foundation for clients, projects, conversations, operations, and intelligence.
          </p>
          <div>
            <TTButton asChild variant="signal">
              <Link to="/modules/$slug" params={{ slug: "conductor" }}>Ask Tai anything</Link>
            </TTButton>
          </div>
        </div>

        <div className="relative min-h-[240px] lg:min-h-[420px]">
          <img
            src={HOME_HERO_IMAGE}
            alt="A sunlit stone colonnade opening onto a wide morning horizon"
            width={1600}
            height={1200}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-r from-card/70 via-card/10 to-transparent lg:from-card/60"
          />
        </div>
      </div>
    </section>
  );
}
