import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { SectionHeading } from "@/components/tt/primitives";
import { Health } from "@/components/tt/settings/pieces";
import { useSettingsIdentity } from "@/components/tt/settings/shell";
import { readIntegrations, type IntegrationHealth } from "@/data/supabase/settings-integrations";

export const Route = createFileRoute("/settings/integrations")({
  component: IntegrationSettings,
});

const TONE: Record<IntegrationHealth, "good" | "caution" | "neutral"> = {
  connected: "good",
  needs_attention: "caution",
  disconnected: "neutral",
};

const LABEL: Record<IntegrationHealth, string> = {
  connected: "Connected",
  needs_attention: "Needs attention",
  disconnected: "Disconnected",
};

function when(value: string | null): string {
  if (!value) return "No sync recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No sync recorded";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function IntegrationSettings() {
  const identity = useSettingsIdentity();
  const integrations = useQuery({
    queryKey: ["settings", "integrations", identity.organizationId],
    queryFn: () => readIntegrations(identity.organizationId),
  });

  return (
    <div className="tt-surface p-6">
      <SectionHeading
        eyebrow="Workspace"
        title="Integrations"
        description="The outside systems this workspace depends on, with their real state. Credentials are never shown here."
      />

      {integrations.isPending ? (
        <p className="text-sm text-muted-foreground">Checking connection health…</p>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border">
          {(integrations.data ?? []).map((integration) => (
            <div key={integration.id} className="flex flex-wrap items-center gap-4 px-4 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{integration.name}</p>
                  <Health tone={TONE[integration.health]}>{LABEL[integration.health]}</Health>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{integration.purpose}</p>
                <p className="mt-1 text-xs text-muted-foreground">{integration.detail}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {integration.usedBy}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Last sync · {when(integration.lastSyncAt)}
                </p>
                <Link
                  to={integration.manageTo}
                  className="mt-1 inline-block text-[13px] text-royal hover:underline"
                >
                  Manage
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Agents connected through Paperclip are a workforce, not workspace members. They never appear
        in People &amp; access.
      </p>
    </div>
  );
}
