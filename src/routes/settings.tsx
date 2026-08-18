import { createFileRoute, Outlet } from "@tanstack/react-router";

import { AppShell } from "@/components/tt/app-shell";
import { PageHeader } from "@/components/tt/primitives";
import { SettingsCanvas, SettingsIdentityProvider } from "@/components/tt/settings/shell";
import { WorkspaceGate } from "@/components/tt/workspace-gate";

const TITLE = "Settings · Trust Tai OS";
const DESCRIPTION =
  "Identity, people, permissions, application visibility, integrations and security for your Trust Tai workspace.";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SettingsLayout,
});

function SettingsLayout() {
  return (
    <WorkspaceGate
      preview={{
        room: "Settings",
        purpose:
          "Settings is the control room for identity, people, permissions and application access.",
        unavailable: ["People and access", "Application visibility", "Integrations", "Security"],
        returnTo: "/settings",
      }}
    >
      {(identity) => (
        <AppShell identity={identity}>
          <SettingsIdentityProvider identity={identity}>
            <PageHeader
              appId="home"
              eyebrow="Trust Tai OS · Settings"
              title="The control room for your workspace."
              supporting={`${identity.organizationName}. Who is here, what they can see, and what the workspace is connected to.`}
            />
            <SettingsCanvas canManage={identity.canManage}>
              <Outlet />
            </SettingsCanvas>
          </SettingsIdentityProvider>
        </AppShell>
      )}
    </WorkspaceGate>
  );
}
