import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { SectionHeading, TTButton, TTField, TTInput } from "@/components/tt/primitives";
import { PersonChip, TTSelect } from "@/components/tt/settings/pieces";
import { useSettingsIdentity } from "@/components/tt/settings/shell";
import { readProfile, saveProfile, type ProfileDetail } from "@/data/supabase/settings-service";
import { ROLE_LABEL, normalizeRole } from "@/domain/access";

export const Route = createFileRoute("/settings/profile")({
  component: ProfileSettings,
});

const TIMEZONES = [
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Africa/Lagos",
  "Asia/Dubai",
  "Asia/Singapore",
  "Australia/Sydney",
];

const LANGUAGES = [
  { value: "en-GB", label: "English (United Kingdom)" },
  { value: "en-US", label: "English (United States)" },
  { value: "fr-FR", label: "French" },
  { value: "es-ES", label: "Spanish" },
];

function ProfileSettings() {
  const identity = useSettingsIdentity();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ProfileDetail | null>(null);
  const [dropped, setDropped] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  const profile = useQuery({
    queryKey: ["settings", "profile", identity.userId],
    queryFn: () => readProfile(identity.userId, identity.email),
  });

  useEffect(() => {
    if (profile.data && !draft) setDraft(profile.data);
  }, [profile.data, draft]);

  const save = useMutation({
    mutationFn: async (value: ProfileDetail) => saveProfile(value),
    onSuccess: (missing) => {
      setDropped(missing);
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  if (!draft) {
    return (
      <div className="tt-surface p-6 text-sm text-muted-foreground" role="status">
        Reading your profile…
      </div>
    );
  }

  const set = (patch: Partial<ProfileDetail>) => {
    setSaved(false);
    setDraft({ ...draft, ...patch });
  };

  const preview =
    draft.displayName.trim() ||
    [draft.firstName, draft.lastName].filter(Boolean).join(" ").trim() ||
    identity.name;

  return (
    <>
      <div className="tt-surface p-6">
        <SectionHeading
          eyebrow="Personal"
          title="My profile"
          description="This is the identity Trust Tai OS uses everywhere: greetings, avatars, ownership and audit history."
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <TTField label="First name">
            <TTInput
              value={draft.firstName}
              onChange={(event) => set({ firstName: event.target.value })}
            />
          </TTField>
          <TTField label="Last name">
            <TTInput
              value={draft.lastName}
              onChange={(event) => set({ lastName: event.target.value })}
            />
          </TTField>
          <TTField label="Display name" hint="How your name appears across the suite.">
            <TTInput
              value={draft.displayName}
              onChange={(event) => set({ displayName: event.target.value })}
            />
          </TTField>
          <TTField label="Preferred name" optional hint="What colleagues actually call you.">
            <TTInput
              value={draft.preferredName}
              onChange={(event) => set({ preferredName: event.target.value })}
            />
          </TTField>
          <TTField label="Email" hint="Your sign-in address is managed by authentication.">
            <TTInput value={draft.email} readOnly className="bg-secondary" />
          </TTField>
          <TTField label="Job title" optional>
            <TTInput
              value={draft.jobTitle}
              onChange={(event) => set({ jobTitle: event.target.value })}
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
          <TTField label="Preferred language">
            <TTSelect
              value={draft.locale}
              onChange={(event) => set({ locale: event.target.value })}
            >
              <option value="">Not set</option>
              {LANGUAGES.map((language) => (
                <option key={language.value} value={language.value}>
                  {language.label}
                </option>
              ))}
            </TTSelect>
          </TTField>
          <TTField label="Profile photo URL" optional hint="A square image reads best.">
            <TTInput
              value={draft.avatarUrl}
              onChange={(event) => set({ avatarUrl: event.target.value })}
              placeholder="https://"
            />
          </TTField>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <TTButton onClick={() => save.mutate(draft)} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save profile"}
          </TTButton>
          {saved ? (
            <span className="text-sm text-success" role="status">
              Saved. Your name and photo update across the OS.
            </span>
          ) : null}
          {save.error ? (
            <span className="text-sm text-destructive" role="alert">
              {(save.error as Error).message}
            </span>
          ) : null}
        </div>

        {dropped.length > 0 ? (
          <p className="mt-4 text-xs text-muted-foreground">
            Saved what this database supports. Not stored yet:{" "}
            <span className="font-mono">{dropped.join(", ")}</span>. Apply{" "}
            <span className="font-mono">docs/settings-schema.sql</span> to keep those fields.
          </p>
        ) : null}
      </div>

      <div className="tt-surface p-6">
        <SectionHeading
          title="How you appear"
          description="A preview of the identity other people see in shared rooms."
        />
        <div className="rounded-xl border border-border bg-secondary/40 p-4">
          <PersonChip
            name={preview}
            avatarUrl={draft.avatarUrl || null}
            supporting={
              [draft.jobTitle, ROLE_LABEL[normalizeRole(identity.role)]]
                .filter(Boolean)
                .join(" · ") || identity.email
            }
          />
        </div>
      </div>
    </>
  );
}
