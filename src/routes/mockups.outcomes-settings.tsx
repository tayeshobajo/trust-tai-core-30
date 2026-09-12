/**
 * MOCKUP ONLY — Outcomes & Volumes settings page.
 *
 * An isolated visual prototype for approval. No production data, no service
 * calls, nothing saved. Deliberately not linked from navigation.
 */

import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/tt/app-shell";
import { SectionHeading, TTButton } from "@/components/tt/primitives";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ActivityVolumesSection,
  CommercialTargetsSection,
  ScoutMessagingSection,
} from "@/components/mockups/outcomes-settings";

const TITLE = "Mockup · Outcomes & Volumes · Trust Tai OS";
const DESCRIPTION =
  "An isolated visual prototype of the Outcomes settings page: commercial targets, activity volumes, and Scout messaging controls. Demo data only.";

export const Route = createFileRoute("/mockups/outcomes-settings")({
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
  component: OutcomesSettingsMockup,
});

function OutcomesSettingsMockup() {
  return (
    <AppShell>
      <div className="mx-auto max-w-canvas px-1 pb-24">
        <header className="border-b border-border pb-8">
          <p className="tt-eyebrow">Mockup · not wired</p>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
            <div>
              <h1 className="tt-title-page text-4xl sm:text-5xl">Outcomes</h1>
              <p className="mt-2 max-w-reading text-base text-muted-foreground">
                Set the targets. The OS reports against them everywhere else.
              </p>
            </div>
          </div>
        </header>

        <div className="mt-8 space-y-6">
          <section className="tt-surface p-6">
            <SectionHeading
              eyebrow="Weekly"
              title="Commercial targets"
              description="What a good week looks like for the business."
            />
            <CommercialTargetsSection />
          </section>

          <section className="tt-surface p-6">
            <SectionHeading
              eyebrow="Ceilings"
              title="Activity volumes"
              description="Daily and weekly output limits for outbound and published work."
            />
            <ActivityVolumesSection />
          </section>

          <section className="tt-surface p-6">
            <SectionHeading
              eyebrow="Scout"
              title="Scout messaging"
              description="Intro email templates, send windows, and weekly caps."
            />
            <ScoutMessagingSection />
          </section>

          <div className="flex justify-end">
            <TooltipProvider delayDuration={120}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <TTButton disabled>Save</TTButton>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Mockup — not wired</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
