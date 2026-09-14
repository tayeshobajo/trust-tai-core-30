/**
 * MOCKUP ONLY — Comms workspace v2.
 *
 * Sample data and local state only. No production Comms record, route,
 * approval authority or send path is read or changed here, and nothing is
 * ever sent.
 */

import { createFileRoute } from "@tanstack/react-router";

import { CommsWorkspaceV2 } from "@/components/mockups/comms-workspace-v2/workspace";

const TITLE = "Mockup · Comms workspace v2 · Trust Tai OS";
const DESCRIPTION =
  "An isolated prototype of one Comms workspace: conversation, new review intake, and line-level draft review with human approval. Sample data only.";

export const Route = createFileRoute("/mockups/comms-workspace-v2")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CommsWorkspaceV2,
});
