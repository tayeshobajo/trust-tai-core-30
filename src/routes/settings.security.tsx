import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { SectionHeading } from "@/components/tt/primitives";
import { useSettingsIdentity } from "@/components/tt/settings/shell";
import { listMembers } from "@/data/supabase/settings-service";
import { ROLE_LABEL } from "@/domain/access";

export const Route = createFileRoute("/settings/security")({
  component: SecuritySettings,
});

function SecuritySettings() {
  const identity = useSettingsIdentity();
  const members = useQuery({
    queryKey: ["settings", "members", identity.organizationId],
    queryFn: () => listMembers(identity.organizationId),
  });

  const admins = (members.data ?? []).filter(
    (member) => member.role === "owner" || member.role === "admin",
  );
  const deactivated = (members.data ?? []).filter((member) => member.status !== "active");

  return (
    <>
      <div className="tt-surface p-6">
        <SectionHeading
          eyebrow="Organization"
          title="Security"
          description="How this workspace is protected, stated plainly. Nothing here is decorative."
        />

        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-border p-4">
            <dt className="tt-eyebrow">Sign-in</dt>
            <dd className="mt-1 text-sm text-foreground">Email magic link</dd>
            <dd className="mt-1 text-xs text-muted-foreground">
              No password is stored. A link is valid once and expires quickly.
            </dd>
          </div>
          <div className="rounded-xl border border-border p-4">
            <dt className="tt-eyebrow">Workspace boundary</dt>
            <dd className="mt-1 text-sm text-foreground">Membership verified on every read</dd>
            <dd className="mt-1 text-xs text-muted-foreground">
              An authenticated person with no active membership sees nothing. Access is never
              created automatically.
            </dd>
          </div>
          <div className="rounded-xl border border-border p-4">
            <dt className="tt-eyebrow">People with full authority</dt>
            <dd className="mt-1 text-sm text-foreground">
              {members.isPending ? "…" : `${admins.length} owner or admin`}
            </dd>
            <dd className="mt-1 text-xs text-muted-foreground">
              {admins.map((member) => `${member.name} (${ROLE_LABEL[member.role]})`).join(", ") ||
                "None recorded"}
            </dd>
          </div>
          <div className="rounded-xl border border-border p-4">
            <dt className="tt-eyebrow">Deactivated accounts</dt>
            <dd className="mt-1 text-sm text-foreground">
              {members.isPending ? "…" : String(deactivated.length)}
            </dd>
            <dd className="mt-1 text-xs text-muted-foreground">
              History is kept. Room access ends immediately.
            </dd>
          </div>
        </dl>
      </div>

      <div className="tt-surface p-6">
        <SectionHeading
          title="Audit trail"
          description="Invitations, role changes, access changes and deactivations are written to the shared activity stream."
        />
        <Link to="/modules/activity" search={{ view: "today", page: 1, kind: "all", q: "", from: "", to: "" }} className="text-[13px] text-royal hover:underline">
          Open the activity stream
        </Link>
      </div>
    </>
  );
}
