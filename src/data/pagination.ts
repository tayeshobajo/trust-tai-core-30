/**
 * Shared bounded pagination primitives.
 *
 * Deliberately free of React and of Supabase: pure slicing over rows already
 * loaded for the organization, so any list surface (Scout companies, Comms
 * relationships) paginates the same honest way, counts always describe the
 * full filtered set, never just the page on screen.
 */

export interface PageView<T> {
  rows: T[];
  page: number;
  pageCount: number;
  total: number;
  /** 1-based index of the first row on this page, 0 when empty. */
  from: number;
  to: number;
}

/** Bounded slice. An out-of-range page clamps to the last available page. */
export function paginate<T>(items: T[], page: number, pageSize: number): PageView<T> {
  const total = items.length;
  const size = Math.max(1, pageSize);
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * size;
  const rows = items.slice(start, start + size);
  return {
    rows,
    page: current,
    pageCount,
    total,
    from: total === 0 ? 0: start + 1,
    to: Math.min(total, start + rows.length),
  };
}

/**
 * Page numbers to render, with `null` marking an elision. Keeps the control
 * compact no matter how many pages the list has.
 */
export function pageNumbers(page: number, pageCount: number): (number | null)[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const out: (number | null)[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 1);
  if (start > 2) out.push(null);
  for (let i = start; i <= end; i += 1) out.push(i);
  if (end < pageCount - 1) out.push(null);
  out.push(pageCount);
  return out;
}
