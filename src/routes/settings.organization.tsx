import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { SectionHeading, TTButton, TTField, TTInput } from "@/components/tt/primitives";
import { TTSelect } from "@/components/tt/settings/pieces";
import { useSettingsIdentity } from "@/components/tt/settings/shell";
import {
  readOrganization,
  saveOrganization,
  type OrganizationDetail,
} from "@/data/supabase/settings-service";

export const Route = createFileRoute("/settings/organization")({
  component: OrganizationSettings,
});

const TIMEZONES = ["Europe/London", "Europe/Paris", "America/New_York", "America/Los_Angeles"];

function OrganizationSettings() {
  const identity = useSettingsIdentity();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<OrganizationDetail | null>(null);
  const [saved, setSaved] = useState(false);

  const organization = useQuery({
    queryKey: ["settings", "organization", identity.organizationId],
    queryFn: () => readOrganization(identity.organizationId),
  });

  useEffect(() => {
    if (organization.data && !draft) setDraft(organization.data);
  }, [organization.data, draft]);

  const save = useMutation({
    mutationFn: async (value: OrganizationDetail) =>
      saveOrganization({ ...value, actorUserId: identity.userId }),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ["settings", "organization"] });
      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  if (!identity.canManage) {
    return (
      <div className="tt-surface p-6">
        <SectionHeading
          eyebrow="Organization"
          title="Organization profile"
          description="Only owners and admins can change the organization profile."
        />
        <p className="text-sm text-foreground">{identity.organizationName}</p>
        <p className="mt-1 text-xs text-muted-foreground">{identity.organizationSlug}</p>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="tt-surface p-6 text-sm text-muted-foreground" role="status">
        Reading the organization…
      </div>
    );
  }

  const set = (patch: Partial<OrganizationDetail>) => {
    setSaved(false);
    setDraft({ ...draft, ...patch });
  };

  return (
    <div className="tt-surface p-6">
      <SectionHeading
        eyebrow="Organization"
        title="Organization profile"
        description="The workspace identity people see in the shell, in exports and in shared briefs."
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <TTField label="Organization name">
          <TTInput value={draft.name} onChange={(event) => set({ name: event.target.value })} />
        </TTField>
        <TTField label="Workspace slug" hint="Used in links and references.">
          <TTInput value={draft.slug} onChange={(event) => set({ slug: event.target.value })} />
        </TTField>
        <TTField label="Website" optional>
          <TTInput
            value={draft.websiteUrl}
            placeholder="https://"
            onChange={(event) => set({ websiteUrl: event.target.value })}
          />
        </TTField>
        <TTField label="Logo URL" optional hint="Used as the shell mark where a logo is supported.">
          <TTInput
            value={draft.logoUrl}
            placeholder="https://"
            onChange={(event) => set({ logoUrl: event.target.value })}
          />
        </TTField>
        <TTField label="Timezone">
          <TTSelect
            value={draft.timezone}
            onChange={(event) => set({ timezone: event.target.value })}
          >
            <option value="">Not set</option>
            {TIMEZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace("_", " ")}
              </option>
            ))}
          </TTSelect>
        </TTField>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <TTButton onClick={() => save.mutate(draft)} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save organization"}
        </TTButton>
        {saved ? (
          <span className="text-sm text-success" role="status">
            Saved.
          </span>
        ) : null}
        {save.error ? (
          <span className="text-sm text-destructive" role="alert">
            {(save.error as Error).message}
          </span>
        ) : null}
      </div>
    </div>
  );
}
