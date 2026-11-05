import { useQuery } from "@tanstack/react-query";
import { contentCommandService } from "@/data/supabase/content-request-service";
import { studioBriefService } from "@/data/supabase/studio-brief-service";
import { contentService } from "@/data/supabase/content-service";
import type { WorkspaceIdentity } from "@/lib/workspace";
export function useStudioSources(identity: WorkspaceIdentity) {
  return useQuery({
    queryKey: ["studio-workspace", "sources", identity.organizationId],
    queryFn: async () => ({
      provisioned: await contentCommandService.schemaReady(identity.organizationId),
      value: await contentCommandService.listSources(identity.organizationId),
    }),
    retry: false,
  });
}
export function useStudioBriefs(identity: WorkspaceIdentity) {
  return useQuery({
    queryKey: ["studio", "briefs", identity.organizationId],
    queryFn: () => studioBriefService.listBriefs(identity.organizationId),
    retry: false,
  });
}
export function useStudioBatches(identity: WorkspaceIdentity) {
  return useQuery({
    queryKey: ["studio-workspace", "batches", identity.organizationId],
    queryFn: async () => ({
      provisioned: await contentService.schemaReady(identity.organizationId),
      value: await contentService.listBatches(identity, 20),
    }),
    retry: false,
  });
}
