import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { AppShell } from "@/components/tt/app-shell";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { HiringWorkspace } from "@/components/tt/hiring/workspace";
import { hiringService } from "@/data/supabase/hiring";
import type { WorkspaceIdentity } from "@/lib/workspace";
export const Route = createFileRoute("/modules/hiring")({
  validateSearch: (search: Record<string, unknown>) => ({
    application: typeof search["application"] === "string" ? search["application"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Hiring · Trust Tai CMD" },
      {
        name: "description",
        content:
          "Private application review, role management and clear next steps in Trust Tai CMD Hiring.",
      },
      { property: "og:title", content: "Hiring · Trust Tai CMD" },
      {
        property: "og:description",
        content:
          "Private application review, role management and clear next steps in Trust Tai CMD Hiring.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: HiringRoute,
});
function HiringRoute() {
  return (
    <WorkspaceGate>
      {(identity) => (
        <AppShell identity={identity} canvas="workroom">
          <Room key={identity.userId + identity.organizationId} identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}
function Room({ identity }: { identity: WorkspaceIdentity }) {
  const search = Route.useSearch();
  const service = useMemo(() => hiringService(identity.organizationId), [identity.organizationId]);
  const q = useQuery({
    queryKey: ["hiring", identity.organizationId, identity.userId],
    queryFn: () => service.load(),
    retry: false,
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
  });
  return (
    <HiringWorkspace
      initialId={search.application}
      data={q.error ? undefined : q.data}
      service={service}
      refresh={() => q.refetch({ throwOnError: true })}
      loading={q.isLoading}
      error={q.error?.message}
    />
  );
}
