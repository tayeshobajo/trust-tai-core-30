import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings2 } from "lucide-react";
import { useState } from "react";

import { AppHero } from "@/components/tt/app-hero";
import { AppShell } from "@/components/tt/app-shell";
import { ProspectCard } from "@/components/tt/prospect-card";
import { MetaPill, SectionHeading, TTButton } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { scoutService } from "@/data/supabase/scout-service";
import { SCOUT_STARTER_PROMPTS, type ScoutSearchResult } from "@/domain/scout";
import type { WorkspaceIdentity } from "@/lib/workspace";

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
  return (
    <WorkspaceGate>
      {(identity) => (
        <AppShell identity={identity}>
          <Scout identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function Scout({ identity }: { identity: WorkspaceIdentity }) {
  const { organizationId, userId } = identity;
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ScoutSearchResult | null>(null);

  const icp = useQuery({
    queryKey: ["scout", "icp", organizationId],
    queryFn: () => scoutService.icp(organizationId),
  });

  const saved = useQuery({
    queryKey: ["scout", "prospects", organizationId],
    queryFn: () => scoutService.list(organizationId),
  });

  const search = useMutation({
    mutationFn: (text: string) => scoutService.search({ organizationId, userId, query: text }),
    onSuccess: async (found) => {
      setResult(found);
      await queryClient.invalidateQueries({ queryKey: ["scout", "prospects", organizationId] });
    },
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ready_for_comms" | "passed" }) =>
      scoutService.setStatus(id, status, { organizationId, userId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["scout", "prospects", organizationId] });
    },
  });

  function run(next: string) {
    const text = next.trim();
    if (!text) return;
    setQuery(text);
    search.mutate(text);
  }

  const persisted = saved.data ?? [];
  const byId = new Map(persisted.map((c) => [c.prospect.id, c]));
  const candidates = result
    ? result.candidates.map((c) => byId.get(c.prospect.id) ?? c)
    : persisted;
  const qualified = candidates.filter(
    (c) => c.prospect.status === "ready_for_comms" || c.prospect.status === "qualified",
  ).length;

  const error = (search.error ?? setStatus.error ?? saved.error) as Error | null;

  return (
    <div className="space-y-12">
      <AppHero
        appId="scout"
        eyebrow="Trust Tai OS / Scout"
        title="Find the companies that look like our best clients."
        supporting="Describe who we are looking for in plain English. Scout returns a small set of candidates, each with what it observed, what it inferred, and one clear move."
        action={
          <TTButton asChild variant="secondary" size="sm">
            <Link to="/modules/scout/settings">
              <Settings2 aria-hidden />
              ICP settings
            </Link>
          </TTButton>
        }
      />

      <section>
        <SectionHeading
          eyebrow="Small input"
          title="Who are we looking for?"
          description="One sentence is enough. No filters, no forms."
          action={
            icp.data ? (
              <MetaPill>Using ICP v{icp.data.version}</MetaPill>
            ) : icp.isPending ? null : (
              <MetaPill>No ICP saved</MetaPill>
            )
          }
        />
        <form
          className="tt-surface p-6"
          onSubmit={(event) => {
            event.preventDefault();
            run(query);
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
            <TTButton type="submit" disabled={search.isPending || !query.trim()}>
              {search.isPending ? "Looking…" : "Find candidates"}
            </TTButton>
            <p className="text-xs text-muted-foreground">
              Preview demo source. No external service is searched and no AI scoring is applied.
            </p>
          </div>

          <div className="mt-6 border-t border-border pt-5">
            <p className="tt-eyebrow">Start from</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SCOUT_STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => run(prompt)}
                  className="rounded-full border border-border bg-card px-4 py-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </form>

        {error ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error.message}
          </p>
        ) : null}
      </section>

      {candidates.length > 0 ? (
        <section>
          <SectionHeading
            eyebrow="Clear output"
            title={`${candidates.length} candidate${candidates.length === 1 ? "" : "s"} worth a look`}
            description={
              result
                ? `For “${result.request.query}”. ${result.source.note}`
                : "Saved in your workspace from earlier preview runs. Sourcing is still preview only."
            }
            action={
              <div className="flex flex-wrap gap-2">
                <MetaPill>Preview demo source</MetaPill>
                {qualified > 0 ? <MetaPill>{qualified} ready for Comms</MetaPill> : null}
              </div>
            }
          />
          <div className="grid gap-5 lg:grid-cols-2">
            {candidates.map((candidate) => (
              <ProspectCard
                key={candidate.prospect.id}
                candidate={candidate}
                onQualify={(id) => setStatus.mutate({ id, status: "ready_for_comms" })}
                onPass={(id) => setStatus.mutate({ id, status: "passed" })}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
