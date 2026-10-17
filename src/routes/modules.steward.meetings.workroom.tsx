/**
 * The workroom moved to Steward's first page. Keep the old URL working.
 */

import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/modules/steward/meetings/workroom")({
  beforeLoad: () => {
    throw redirect({ to: "/modules/steward" });
  },
});
