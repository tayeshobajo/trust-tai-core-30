/** Isolated design preview. Only invented fixtures; no production work services. */
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/tt/app-shell";
import { StewardPreview } from "@/components/mockups/steward-next/workspace";

const TITLE = "Steward meeting workspace preview · Trust Tai OS";
const DESCRIPTION = "An illustrative meeting-first Steward workspace, with outstanding work, honest coverage and evidence-led completion.";
export const Route = createFileRoute("/mockups/steward-next")({
  head: () => ({ meta: [
    { title: TITLE }, { name: "description", content: DESCRIPTION },
    { property: "og:title", content: TITLE }, { property: "og:description", content: DESCRIPTION },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex" },
  ] }),
  component: () => <AppShell><StewardPreview /></AppShell>,
});