/**
 * Steward, Your dashboard (self scope).
 *
 * A person's own week: goal, streak, level, tasks completed, time saved,
 * their tasks, AI teammate activity and blockers. Every number comes from
 * src/data/steward/dashboard-read.ts, which reads real rows only, so an
 * unprovisioned or empty workspace renders honest empties rather than
 * crashing. See src/routes/modules.steward.people.$userId.tsx for the
 * status-only team view of the same component.
 */

import { createFileRoute, redirect } from "@tanstack/react-router";

const TITLE = "Steward · Your dashboard · Trust Tai OS";
const DESCRIPTION = "Your goal, your tasks, and what an AI teammate cleared for you this week.";

export const Route = createFileRoute("/modules/steward/dashboard")({
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true });
  },
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => null,
});
