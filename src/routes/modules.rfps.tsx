import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { AppShell } from "@/components/tt/app-shell";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { RfpWorkspace } from "@/components/tt/rfps/workspace";
import { rfpService } from "@/data/supabase/rfps";
import { canWorkIn, type WorkspaceIdentity } from "@/lib/workspace";
export const Route = createFileRoute("/modules/rfps")({
  head: () => ({
    meta: [{ title: "RFPs & Grants · Trust Tai OS" }, { name: "robots", content: "noindex" }],
  }),
  component: RfpRoute,
});
function RfpRoute() {
  return (
    <WorkspaceGate appId="rfps">
      {(identity) => (
        <AppShell identity={identity} canvas="workroom">
          <Room key={identity.organizationId + identity.userId} identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}
function Room({ identity }: { identity: WorkspaceIdentity }) {
  const service = useMemo(() => rfpService(identity.organizationId), [identity.organizationId]);
  const query = useQuery({
    queryKey: ["rfps", identity.organizationId, identity.userId],
    queryFn: () => service.load(),
    retry: false,
  });
  return (
    <RfpWorkspace
      data={query.data}
      loading={query.isLoading}
      error={query.error?.message}
      canWork={canWorkIn(identity, "rfps")}
      service={service}
      refresh={() => query.refetch({ throwOnError: true })}
    />
  );
}
