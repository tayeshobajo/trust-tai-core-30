/**
 * Display-only title normalization for the workroom task list.
 *
 * Stored titles are canonical and never rewritten. When a title carries a
 * shared prefix separated by a spaced dash ("Client — Deliverable"), the list
 * shows the distinguishing tail so neighbouring rows read differently, while
 * the full stored title stays available in the tooltip and detail panel.
 * Nothing is inferred about the work itself; an ambiguous title is shown whole.
 */

const DASH_SEPARATORS = [" — ", " – ", " - "] as const;
const MIN_TAIL_LENGTH = 3;

export interface DisplayTitle {
  /** What the compact row shows. */
  display: string;
  /** The canonical stored title, unchanged. */
  full: string;
  /** True when the display text is a normalized view of the full title. */
  shortened: boolean;
}

export function displayTitleOf(title: string): DisplayTitle {
  const full = title;
  const trimmed = title.trim();
  for (const separator of DASH_SEPARATORS) {
    const parts = trimmed
      .split(separator)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (parts.length < 2) continue;
    const tail = parts[parts.length - 1]!;
    /* A tail that is the whole title or trivially short distinguishes nothing. */
    if (tail.length >= MIN_TAIL_LENGTH && tail !== trimmed) {
      return { display: tail, full, shortened: true };
    }
  }
  return { display: trimmed || title, full, shortened: false };
}
