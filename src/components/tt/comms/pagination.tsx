/**
 * Bounded pagination for the relationship list.
 *
 * One calm control at the foot of the list: where you are, previous and
 * next, and compact page numbers. No page-size selector, the rhythm is
 * fixed so the room never becomes a wall of rows. When everything fits on
 * one page the control stays out of the way entirely.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";

import { pageNumbers, type PageView } from "@/data/pagination";
import { cn } from "@/lib/utils";

const control =
  "inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-md border border-border bg-card px-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function CommsPagination({
  view,
  onPage,
  label = "Relationship list pagination",
}: {
  view: PageView<unknown>;
  onPage: (page: number) => void;
  /** Accessible name for the nav, name the list being paged. */
  label?: string;
}) {
  if (view.pageCount <= 1) return null;

  return (
    <nav
      aria-label={label}
      className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2"
    >
      <p className="text-[12px] text-muted-foreground" aria-live="polite">
        {view.total === 0 ? "No relationships": `${view.from}–${view.to} of ${view.total}`}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={control}
          onClick={() => onPage(view.page - 1)}
          disabled={view.page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft aria-hidden className="size-3.5" />
          Previous
        </button>

        <div className="flex items-center gap-1">
          {pageNumbers(view.page, view.pageCount).map((entry, index) =>
            entry === null ? (
              <span key={`gap-${index}`} aria-hidden className="px-0.5 text-muted-foreground">
                …
              </span>
            ): (
              <button
                key={entry}
                type="button"
                aria-current={entry === view.page ? "page": undefined}
                aria-label={`Page ${entry}`}
                onClick={() => onPage(entry)}
                className={cn(
                  control,
                  entry === view.page && "border-royal/30 bg-royal/8 font-medium text-royal",
                )}
              >
                {entry}
              </button>
            ),
          )}
        </div>

        <button
          type="button"
          className={control}
          onClick={() => onPage(view.page + 1)}
          disabled={view.page >= view.pageCount}
          aria-label="Next page"
        >
          Next
          <ChevronRight aria-hidden className="size-3.5" />
        </button>
      </div>
    </nav>
  );
}
