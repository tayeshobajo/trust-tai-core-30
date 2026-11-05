import type { ReactNode } from "react";
import { AppShell } from "@/components/tt/app-shell";
import type { WorkspaceIdentity } from "@/lib/workspace";
import "./comms-workspace.css";

/** Shared canvas; route bodies retain their existing data and action contracts. */
export function CommsPageShell({
  identity,
  children,
}: {
  identity: WorkspaceIdentity;
  children: ReactNode;
}) {
  return (
    <AppShell appearance="comms" identity={identity}>
      <div className="comms-workspace comms-secondary-workspace">{children}</div>
    </AppShell>
  );
}
