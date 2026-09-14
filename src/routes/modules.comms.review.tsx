/**
 * The old Review deep link.
 *
 * Review is no longer a separate screen stacked on its own page: it is the
 * focused surface inside Drafts & Reviews. The review being opened is carried
 * across unchanged, so every existing link still lands on the same record.
 */

import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/modules/comms/review")({
  validateSearch: (search: Record<string, unknown>): { session?: string } => {
    const value = typeof search["session"] === "string" ? search["session"].trim() : "";
    return value ? { session: value } : {};
  },
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/modules/comms/drafts",
      search: search.session ? { session: search.session } : {},
    });
  },
  component: () => null,
});
