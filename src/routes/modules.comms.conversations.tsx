/**
 * The old conversations list.
 *
 * There is one conversation surface now — the relationship room — so this
 * address keeps working rather than being a second, thinner copy of it. Any
 * person named in the link is carried across, so an old bookmark still opens
 * the same conversation.
 */

import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/modules/comms/conversations")({
  validateSearch: (search: Record<string, unknown>): { relationship?: string } => ({
    ...(typeof search["relationship"] === "string" && search["relationship"]
      ? { relationship: search["relationship"] }
      : {}),
  }),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/modules/comms/relationships",
      search: search.relationship ? { relationship: search.relationship } : {},
      replace: true,
    });
  },
});
