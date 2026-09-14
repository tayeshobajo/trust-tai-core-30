/**
 * The old Dashboard deep link.
 *
 * "Dashboard" now answers what needs action; this list of conversations kept
 * its behaviour and moved to Conversations.
 */

import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/modules/comms/dashboard")({
  beforeLoad: () => {
    throw redirect({ to: "/modules/comms/conversations" });
  },
  component: () => null,
});
