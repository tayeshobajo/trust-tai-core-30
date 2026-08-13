import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppShell } from "@/components/tt/app-shell";
import { ScoutTabs } from "@/components/tt/scout-tabs";
import { ProspectWorkspace } from "@/components/tt/prospect-workspace";
import { EmptyState, TTButton } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { scoutService } from "@/data/supabase/scout-service";
import type { FitLight } from "@/domain/scout-fit";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Prospect — Scout — Trust Tai OS";
const DESCRIPTION =
  "The full prospect workspace: ICP fit reasoning, observed evidence, the opportunity, and the next move.";

type Section = "scout" | "qualified" | "research";
type Fit = "all" | FitLight;

function parseSection(value: unknown): Section {
  return value === "qualified" || value === "research" ? value : "scout";
}

function parseFit(value: unknown): Fit {
  return value === "green" || value === "yellow" || value === "red" || value === "neutral"
    ? value
    : "all";
}

export const Route = createFileRoute("/modules/scout/prospects/$prospectId")({
  validateSearch: (search: Record<string, unknown>) => ({
    section: parseSection(search["section"]),
    fit: parseFit(search["fit"]),
  }),
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
  component: ProspectRoute,
});

function ProspectRoute() {
  const { prospectId } = Route.useParams();
  const search = Route.useSearch();
  return (
    <WorkspaceGate>
      {(identity) => (
        <AppShell identity={identity}>
          <div className="space-y-8">
            <ScoutTabs active={search.section === "research" ? "research" : search.section} />
            <ProspectDetail identity={identity} prospectId={prospectId} backSearch={search} />
          </div>
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function ProspectDetail({
  identity,
  prospectId,
  backSearch,
}: {
  identity: WorkspaceIdentity;
  prospectId: string;
  backSearch: { section: Section; fit: Fit };
}) {
  const { organizationId, userId } = identity;
  const queryClient = useQueryClient();

  const icp = useQuery({
    queryKey: ["scout", "icp", organizationId],
    queryFn: () => scoutService.icp(organizationId),
  });

  const saved = useQuery({
    queryKey: ["scout", "prospects", organizationId],
    queryFn: () => scoutService.list(organizationId),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["scout", "prospects", organizationId] });

  const research = useMutation({
    mutationFn: (websiteUrl: string) =>
      scoutService.research({ organizationId, userId, websiteUrl }),
    onSuccess: refresh,
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "qualified" | "passed" }) =>
      scoutService.setStatus(id, status, { organizationId, userId }),
    onSuccess: refresh,
  });

  const override = useMutation({
    mutationFn: ({ id, light }: { id: string; light: FitLight | null }) =>
      scoutService.overrideFit(id, light, { organizationId, userId }),
    onSuccess: refresh,
  });

  const candidate = (saved.data ?? []).find((c) => c.prospect.id === prospectId) ?? null;
  const error = (research.error ?? setStatus.error ?? override.error ?? saved.error) as Error | null;
  const busy = research.isPending || setStatus.isPending || override.isPending;

  if (saved.isPending) {
    return (
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        Opening the prospect workspace…
      </p>
    );
  }

  if (!candidate) {
    return (
      <EmptyState
        title="That prospect is not on your board"
        belongsHere="Prospects are scoped to your organization. This one may have been removed, or it belongs to another workspace."
        whyItMatters="Scout never shows records outside the organization you are signed in to."
        action={
          <TTButton asChild variant="secondary">
            <Link to="/modules/scout" search={backSearch}>
              Back to Scout
            </Link>
          </TTButton>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {research.isPending ? (
        <div
          role="status"
          aria-live="polite"
          className="tt-surface flex items-center gap-3 p-4 text-sm text-muted-foreground"
        >
          <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-royal" />
          Re-reading the public pages on {candidate.prospect.domain}. This takes a few moments.
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      ) : null}

      <ProspectWorkspace
        candidate={candidate}
        activeIcpVersion={icp.data?.version ?? null}
        backSearch={backSearch}
        onQualify={(id) => setStatus.mutate({ id, status: "qualified" })}
        onPass={(id) => setStatus.mutate({ id, status: "passed" })}
        onResearch={(websiteUrl) => research.mutate(websiteUrl)}
        onOverride={(id, light) => override.mutate({ id, light })}
        busy={busy}
      />
    </div>
  );
}
