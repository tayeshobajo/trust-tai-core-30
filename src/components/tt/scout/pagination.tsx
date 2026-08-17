/**
 * Bounded pagination for the Scout company table.
 * Only the current page's rows are ever rendered into the table.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";

import { ROWS_PER_PAGE_OPTIONS, pageNumbers, type PageView } from "@/data/scout-table";
import { cn } from "@/lib/utils";

const control =
  "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-lg border border-border bg-card px-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

export function ScoutPagination({
  view,
  pageSize,
  onPage,
  onPageSize,
}: {
  view: PageView<unknown>;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  return (
    <nav
      aria-label="Company table pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3"
    >
      <p className="text-[13px] text-muted-foreground" aria-live="polite">
        {view.total === 0 ? "No companies" : `${view.from}–${view.to} of ${view.total}`}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
          Rows
          <select
            aria-label="Rows per page"
            value={pageSize}
            onChange={(event) => onPageSize(Number(event.target.value))}
            className="h-8 rounded-lg border border-input bg-card px-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {ROWS_PER_PAGE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className={control}
          onClick={() => onPage(view.page - 1)}
          disabled={view.page <= 1}
        >
          <ChevronLeft aria-hidden className="size-4" />
          Previous
        </button>

        <div className="flex items-center gap-1">
          {pageNumbers(view.page, view.pageCount).map((entry, index) =>
            entry === null ? (
              <span key={`gap-${index}`} aria-hidden className="px-1 text-muted-foreground">
                …
              </span>
            ) : (
              <button
                key={entry}
                type="button"
                aria-current={entry === view.page ? "page" : undefined}
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
        >
          Next
          <ChevronRight aria-hidden className="size-4" />
        </button>
      </div>
    </nav>
  );
}
