/**
 * The old Queue deep link.
 *
 * The queue is now a section of Drafts & Reviews. Old links keep working.
 */

import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/modules/comms/queue")({
  beforeLoad: () => {
    throw redirect({ to: "/modules/comms/drafts" });
  },
  component: () => null,
});
