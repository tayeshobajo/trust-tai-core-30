import { Link } from "@tanstack/react-router";
import { ArrowRight, type LucideIcon } from "lucide-react";

export interface TodayItem {
  key: string;
  count: number;
  label: string;
  icon: LucideIcon;
  /** Room slug this card hands off to. */
  slug: string;
}

/**
 * Three compact cards, one number each. No charts, no second metric.
 * A card that has no truthful number is simply not passed in.
 */
export function TodaySummary({ items }: { items: TodayItem[] }) {
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="today-heading">
      <h2 id="today-heading" className="font-display text-2xl text-foreground">
        Today
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">What needs your attention.</p>

      <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.key}>
              <Link
                to="/modules/$slug"
                params={{ slug: item.slug }}
                className="group flex h-full items-center gap-4 rounded-2xl border border-border bg-card px-5 py-5 transition-colors hover:bg-cloud focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-cloud-strong text-royal">
                  <Icon className="size-[18px]" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-3xl leading-none text-foreground">
                    {item.count}
                  </span>
                  <span className="mt-1.5 block text-sm text-muted-foreground">{item.label}</span>
                </span>
                <ArrowRight
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-royal"
                  aria-hidden
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
