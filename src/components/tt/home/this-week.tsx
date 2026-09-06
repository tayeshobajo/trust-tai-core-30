import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";

import type { HomeNumber } from "@/domain/home-week";

/**
 * The four canonical This Week numbers, on one white surface.
 *
 * No charts, no second metric, no vanity widget. Each number names its owning
 * room and links there, so nothing here is a dead end, and Home never carries
 * a control that belongs somewhere else.
 */
export function ThisWeek({
  numbers,
  note,
  loading,
}: {
  numbers: HomeNumber[];
  note: string | null;
  loading?: boolean;
}) {
  return (
    <section aria-labelledby="this-week-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="this-week-heading" className="font-display text-2xl text-foreground">
          This week
        </h2>
        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      </div>

      <div className="tt-surface mt-5 overflow-hidden">
        {loading ? (
          <p className="px-7 py-10 text-sm text-muted-foreground">Reading the week.</p>
        ) : numbers.length === 0 ? (
          <p className="px-7 py-10 text-sm text-muted-foreground">
            The week could not be read just now.
          </p>
        ) : (
          <ul className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">
            {numbers.map((number, index) => (
              <li
                key={number.key}
                className={[
                  "min-w-0",
                  index > 0 ? "lg:border-l lg:border-border" : "",
                  index === 1 ? "sm:border-l sm:border-border" : "",
                  index === 2 ? "sm:border-t sm:border-border lg:border-t-0" : "",
                  index === 3 ? "sm:border-t sm:border-l sm:border-border lg:border-t-0" : "",
                ].join(" ")}
              >
                <Link
                  to="/modules/$slug"
                  params={{ slug: number.slug }}
                  className="group flex h-full flex-col gap-2 px-7 py-7 transition-colors hover:bg-cloud focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                    {number.label}
                    <ArrowUpRight
                      className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden
                    />
                  </span>

                  <span
                    className={
                      number.state === "unknown"
                        ? "font-display text-[26px] leading-none text-muted-foreground"
                        : "font-display text-[34px] leading-none text-foreground"
                    }
                  >
                    {number.display}
                  </span>

                  <span className="mt-1 block text-[13px] leading-snug">
                    {number.state === "unknown" ? (
                      <span className="text-warning">
                        {number.because ?? "This source could not be read just now."}
                      </span>
                    ) : number.state === "below_floor" ? (
                      <span className="text-warning">
                        Below the floor. {number.targetLabel ?? ""}
                      </span>
                    ) : number.targetLabel ? (
                      <span className="text-muted-foreground">{number.targetLabel}</span>
                    ) : (
                      <span className="text-muted-foreground">No target agreed yet</span>
                    )}
                  </span>

                  <span className="mt-auto block pt-3 text-[13px] text-muted-foreground/90">
                    {number.action}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
