import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { SectionHeading, TTButton } from "@/components/tt/primitives";
import { NotProvisioned, Toggle } from "@/components/tt/settings/pieces";
import { useSettingsIdentity } from "@/components/tt/settings/shell";
import {
  readNotificationPreferences,
  saveNotificationPreferences,
  type NotificationPreferences,
} from "@/data/supabase/settings-service";
import { canSeeApp } from "@/lib/workspace";

export const Route = createFileRoute("/settings/notifications")({
  component: NotificationSettings,
});

/**
 * Only events the suite genuinely produces, grouped by the room that produces
 * them. Delivery is in-app today, so no channel is offered that does not exist.
 */
const GROUPS: {
  appId: string;
  title: string;
  items: { key: string; label: string; note: string }[];
}[] = [
  {
    appId: "steward",
    title: "Steward",
    items: [
      { key: "steward.task_assigned", label: "A task is assigned to me", note: "" },
      { key: "steward.commitment_overdue", label: "A commitment I own is overdue", note: "" },
      { key: "steward.reassigned", label: "Work is reassigned to or from me", note: "" },
      { key: "steward.daily_summary", label: "Daily summary of what needs me", note: "Optional" },
    ],
  },
  {
    appId: "projects",
    title: "Projects",
    items: [
      { key: "projects.blocked", label: "A project I own becomes blocked", note: "" },
      { key: "projects.assigned", label: "A project is assigned to me", note: "" },
      { key: "projects.review_requested", label: "A review is requested from me", note: "" },
    ],
  },
  {
    appId: "comms",
    title: "Comms",
    items: [
      { key: "comms.attention", label: "A relationship needs attention", note: "" },
      { key: "comms.client_reply", label: "A client replies", note: "" },
      { key: "comms.draft_review", label: "A draft is waiting for my review", note: "" },
    ],
  },
  {
    appId: "steward",
    title: "Agents",
    items: [
      { key: "agents.approval_needed", label: "An agent needs my approval", note: "" },
      { key: "agents.failure", label: "An agent run fails", note: "" },
      { key: "agents.completed", label: "An agent run completes", note: "Optional" },
    ],
  },
];

function NotificationSettings() {
  const identity = useSettingsIdentity();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<NotificationPreferences | null>(null);
  const [saved, setSaved] = useState(false);

  const stored = useQuery({
    queryKey: ["settings", "notifications", identity.userId, identity.organizationId],
    queryFn: () => readNotificationPreferences(identity.userId, identity.organizationId),
  });

  useEffect(() => {
    if (stored.data && !draft) setDraft(stored.data.value);
  }, [stored.data, draft]);

  const save = useMutation({
    mutationFn: async (preferences: NotificationPreferences) =>
      saveNotificationPreferences({
        userId: identity.userId,
        organizationId: identity.organizationId,
        preferences,
      }),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ["settings", "notifications"] });
    },
  });

  const provisioned = stored.data?.provisioned ?? false;
  const groups = GROUPS.filter((group) => canSeeApp(identity, group.appId));

  return (
    <div className="tt-surface p-6">
      <SectionHeading
        eyebrow="Personal"
        title="Notifications"
        description="Choose what reaches you in Trust Tai OS. Only rooms you can see are listed."
      />

      {stored.isPending ? (
        <p className="text-sm text-muted-foreground">Reading your preferences…</p>
      ) : (
        <>
          {provisioned ? null : (
            <div className="mb-5">
              <NotProvisioned what="Notification preferences" file="docs/settings-schema.sql" />
            </div>
          )}

          <div className="space-y-6">
            {groups.map((group) => (
              <div key={group.title}>
                <p className="tt-eyebrow mb-2">{group.title}</p>
                <div className="divide-y divide-border rounded-xl border border-border">
                  {group.items.map((item) => {
                    const checked = (draft ?? {})[item.key] ?? true;
                    return (
                      <div key={item.key} className="flex items-center gap-4 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-foreground">{item.label}</p>
                          {item.note ? (
                            <p className="text-xs text-muted-foreground">{item.note}</p>
                          ) : null}
                        </div>
                        <Toggle
                          label={item.label}
                          checked={checked}
                          disabled={!provisioned}
                          onChange={(next) => {
                            setSaved(false);
                            setDraft({ ...(draft ?? {}), [item.key]: next });
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-center gap-3">
            <TTButton
              onClick={() => save.mutate(draft ?? {})}
              disabled={!provisioned || save.isPending}
            >
              {save.isPending ? "Saving…" : "Save preferences"}
            </TTButton>
            {saved ? (
              <span className="text-sm text-success" role="status">
                Saved.
              </span>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
