import { createFileRoute } from "@tanstack/react-router";
import { AppHero } from "@/components/tt/app-hero";
import { PageHeader } from "@/components/tt/primitives";
import { APP_AMBIENT_THEMES } from "@/domain/ambient-theme";

export const Route = createFileRoute("/ambient-qa")({ component: () => (
  <div className="mx-auto max-w-canvas space-y-8 p-6">
    {Object.keys(APP_AMBIENT_THEMES).map((id) => (
      <AppHero key={id} appId={id} eyebrow={`Trust Tai OS / ${id}`} title={`${id} room`} supporting="Ambient identity wash QA." />
    ))}
    <PageHeader appId="scout" eyebrow="Trust Tai OS / Scout" title="Ideal Client Profile" supporting="Header wash QA." />
    <PageHeader appId="scout" contextAccent="#B96D52" eyebrow="Contextual" title="Company colour" supporting="Contextual accent QA." />
  </div>
) });
