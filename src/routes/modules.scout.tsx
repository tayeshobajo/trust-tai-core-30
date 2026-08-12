import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { AppHero } from "@/components/tt/app-hero";
import { AppShell } from "@/components/tt/app-shell";
import { LockedWorkspace } from "@/components/tt/locked-workspace";
import { ProspectCard } from "@/components/tt/prospect-card";
import { MetaPill, SectionHeading, TTButton } from "@/components/tt/primitives";
import { memorySource } from "@/data/memory-source";
import { SCOUT_STARTER_PROMPTS, type ScoutSearchResult } from "@/domain/scout";
import { resolveAccess } from "@/lib/auth-boundary";

const TITLE = "Scout — Trust Tai OS";
const DESCRIPTION =
  "Describe the kind of company we are looking for and Scout returns a small set of candidates with the evidence behind each one.";

export const Route = createFileRoute("/modules/scout")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ScoutRoute,
});

function ScoutRoute() {
  const access = resolveAccess();
  if (access.state !== "authenticated") {
    return (
      <LockedWorkspace
        reason={
          access.state === "unconfigured"
            ? access.reason
            : "You are signed out of Trust Tai."
        }
      />
    );
  }
  return (
    <AppShell>
      <Scout organizationId={access.organizationId} userId={access.userId} />
    </AppShell>
  );
}

function Scout({ organizationId, userId }: { organizationId: string; userId: string }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ScoutSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [version, setVersion] = useState(0);

  async function run(next: string) {
    const text = next.trim();
    if (!text) return;
    setQuery(text);
    setSearching(true);
    const found = await memorySource.scout.search({ organizationId, userId, query: text });
    setResult(found);
    setSearching(false);
  }

  async function setStatus(id: string, status: "qualified" | "passed") {
    await memorySource.scout.setStatus(id, status, { organizationId, userId });
    setVersion((v) => v + 1);
  }

  const candidates = result?.candidates ?? [];
  const qualified = candidates.filter((c) => c.prospect.status === "qualified").length;

  return (
    <div className="space-y-12" key={version}>
      <AppHero
        appId="scout"
        eyebrow="Trust Tai OS / Scout"
        title="Find the companies that look like our best clients."
        supporting="Describe who we are looking for in plain English. Scout returns a small set of candidates, each with what it observed, what it inferred, and one clear move."
      />

      <section>
        <SectionHeading
          eyebrow="Small input"
          title="Who are we looking for?"
          description="One sentence is enough. No filters, no forms."
        />
        <form
          className="tt-surface p-6"
          onSubmit={(event) => {
            event.preventDefault();
            void run(query);
          }}
        >
          <label htmlFor="scout-query" className="sr-only">
            Describe the kind of company we are looking for
          </label>
          <textarea
            id="scout-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            rows={3}
            placeholder="US professional-services firms with dated WordPress websites"
            className="w-full resize-none rounded-lg border border-input bg-card p-4 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <TTButton type="submit" disabled={searching || !query.trim()}>
              {searching ? "Looking…" : "Find candidates"}
            </TTButton>
            <p className="text-xs text-muted-foreground">
              Preview demo source. No external service is searched.
            </p>
          </div>

          <div className="mt-6 border-t border-border pt-5">
            <p className="tt-eyebrow">Start from</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SCOUT_STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void run(prompt)}
                  className="rounded-full border border-border bg-card px-4 py-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </form>
      </section>

      {result ? (
        <section>
          <SectionHeading
            eyebrow="Clear output"
            title={`${candidates.length} candidates worth a look`}
            description={`For “${result.request.query}”. ${result.source.note}`}
            action={
              <div className="flex flex-wrap gap-2">
                <MetaPill>{result.source.label}</MetaPill>
                {qualified > 0 ? <MetaPill>{qualified} ready for Comms</MetaPill> : null}
              </div>
            }
          />
          <div className="grid gap-5 lg:grid-cols-2">
            {candidates.map((candidate) => (
              <ProspectCard
                key={candidate.prospect.id}
                candidate={candidate}
                onQualify={(id) => void setStatus(id, "qualified")}
                onPass={(id) => void setStatus(id, "passed")}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
