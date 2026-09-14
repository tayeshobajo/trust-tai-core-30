/**
 * How a dashboard section decides what to show.
 *
 * A failed read is never allowed to look like an empty success: if the read
 * did not happen, the section says so and offers to try again. Counts belong
 * to successful reads only.
 */

export type SectionState = "error" | "loading" | "empty" | "list";

export function sectionState(input: {
  isError: boolean;
  isPending: boolean;
  count: number | null;
}): SectionState {
  if (input.isError) return "error";
  if (input.isPending || input.count === null) return "loading";
  return input.count === 0 ? "empty" : "list";
}

/** A sanitized sentence: provider and database detail never reach the page. */
export function readFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /permission|denied|rls|not authorized/i.test(message)
    ? "You do not have access to this part of the workspace."
    : "This could not be read just now.";
}

/** The exact record a dashboard draft row opens. */
export function draftSearch(draftId: string): { draft: string } {
  return { draft: draftId };
}
