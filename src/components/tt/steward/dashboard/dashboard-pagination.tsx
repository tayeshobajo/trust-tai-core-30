import { ChevronLeft, ChevronRight } from "lucide-react";

import { TTButton } from "@/components/tt/primitives";
import { pageNumbers, type PageView } from "@/data/pagination";
import { cn } from "@/lib/utils";

const pageControl =
  "h-7 min-w-7 rounded-md border border-border bg-card px-2 text-[11px] text-muted-foreground shadow-none hover:border-royal/30 hover:bg-secondary hover:text-foreground";

export function DashboardPagination({
  view,
  onPage,
  label,
}: {
  view: PageView<unknown>;
  onPage: (page: number) => void;
  label: string;
}) {
  if (view.pageCount <= 1) return null;

  return (
    <nav
      aria-label={label}
      className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3"
    >
      <p className="text-[11px] text-muted-foreground" aria-live="polite">
        {view.from}–{view.to} of {view.total}
      </p>
      <div className="flex items-center gap-1">
        <TTButton
          type="button"
          variant="quiet"
          size="sm"
          className={pageControl}
          onClick={() => onPage(view.page - 1)}
          disabled={view.page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft aria-hidden />
        </TTButton>
        {pageNumbers(view.page, view.pageCount).map((entry, index) =>
          entry === null ? (
            <span key={`gap-${index}`} aria-hidden className="px-0.5 text-xs text-muted-foreground">
              …
            </span>
          ) : (
            <TTButton
              key={entry}
              type="button"
              variant="quiet"
              size="sm"
              aria-current={entry === view.page ? "page" : undefined}
              aria-label={`Page ${entry}`}
              onClick={() => onPage(entry)}
              className={cn(
                pageControl,
                entry === view.page && "border-royal/30 bg-royal/8 font-semibold text-royal",
              )}
            >
              {entry}
            </TTButton>
          ),
        )}
        <TTButton
          type="button"
          variant="quiet"
          size="sm"
          className={pageControl}
          onClick={() => onPage(view.page + 1)}
          disabled={view.page >= view.pageCount}
          aria-label="Next page"
        >
          <ChevronRight aria-hidden />
        </TTButton>
      </div>
    </nav>
  );
}