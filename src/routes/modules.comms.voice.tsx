/**
 * Voice DNA settings.
 *
 * How Tai sounds is organization intelligence, not a prompt buried in code.
 * Owner and admin members edit it; every member can read it. Drafting reads
 * this row as its policy document.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { AppShell } from "@/components/tt/app-shell";
import { CommsTabs } from "@/components/tt/comms/comms-tabs";
import { Markdown } from "@/components/tt/markdown";
import { MetaPill, PageHeader, SectionHeading, TTButton } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { getVoiceProfile, saveVoiceProfile, type VoiceProfile } from "@/data/supabase/comms-voice";
import { checkVoice } from "@/data/voice-policy";
import { DEFAULT_VOICE_DOCUMENT, VOICE_RULES } from "@/domain/voice";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Voice DNA · Comms · Trust Tai OS";
const DESCRIPTION =
  "The drafting policy every Comms message is written under: warmth through specificity, authority through brevity.";

export const Route = createFileRoute("/modules/comms/voice")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VoiceRoute,
});

function VoiceRoute() {
  return (
    <WorkspaceGate>
      {(identity) => (
        <AppShell identity={identity}>
          <VoiceSettings identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function VoiceSettings({ identity }: { identity: WorkspaceIdentity }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [draft, setDraft] = useState("");
  const [sample, setSample] = useState("");

  const voiceQuery = useQuery({
    queryKey: ["comms", "voice", identity.organizationId],
    queryFn: () => getVoiceProfile(identity.organizationId),
  });

  const save = useMutation({
    mutationFn: (current: VoiceProfile | null) =>
      saveVoiceProfile({
        organizationId: identity.organizationId,
        current,
        contentMarkdown: draft,
        userId: identity.userId,
      }),
    onSuccess: async (next) => {
      queryClient.setQueryData(["comms", "voice", identity.organizationId], next);
      setMode("preview");
    },
  });

  if (voiceQuery.isError) {
    return (
      <div className="mx-auto max-w-reading px-6 py-10">
        <PageHeader
          appId="comms"
          eyebrow="Comms"
          title="The Voice DNA could not be read."
          supporting={(voiceQuery.error as Error).message}
        />
      </div>
    );
  }

  const profile = voiceQuery.data ?? null;
  const content = profile?.contentMarkdown?.trim() || DEFAULT_VOICE_DOCUMENT;
  const verdict = sample.trim()
    ? checkVoice(sample, { register: "follow_up", requireSignoff: false })
    : null;

  return (
    <div className="mx-auto w-full max-w-canvas px-4 py-8 lg:px-8">
      <PageHeader
        appId="comms"
        eyebrow="Comms"
        title="How Tai sounds."
        supporting="Every draft is written under this document and checked against the rules below before a person can approve it."
      />

      <div className="mt-6">
        <CommsTabs active="voice" />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="tt-surface p-6">
          <SectionHeading
            eyebrow={profile ? `Version ${profile.version}` : "Not saved yet"}
            title="Voice DNA"
            description={
              profile?.updatedAt
                ? `Last updated ${new Date(profile.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.`
                : "This is the Trust Tai starting document. Save it to make it yours."
            }
            action={
              identity.canManage ? (
                mode === "preview" ? (
                  <TTButton
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setDraft(content);
                      setMode("edit");
                    }}
                  >
                    Edit
                  </TTButton>
                ) : (
                  <div className="flex gap-2">
                    <TTButton
                      size="sm"
                      disabled={save.isPending}
                      onClick={() => save.mutate(profile)}
                    >
                      {save.isPending ? "Saving" : "Save"}
                    </TTButton>
                    <TTButton size="sm" variant="quiet" onClick={() => setMode("preview")}>
                      Cancel
                    </TTButton>
                  </div>
                )
              ) : (
                <MetaPill>View only</MetaPill>
              )
            }
          />

          {mode === "edit" ? (
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={26}
              aria-label="Voice DNA content"
              className="w-full rounded-lg border border-input bg-card p-4 font-mono text-[13px] text-foreground"
            />
          ) : (
            <Markdown content={content} />
          )}

          {save.isError ? (
            <p className="mt-3 text-[13px] text-destructive">{(save.error as Error).message}</p>
          ) : null}
        </section>

        <aside className="space-y-6">
          <div className="tt-surface p-5">
            <p className="tt-eyebrow">Rules the policy enforces</p>
            <ul className="mt-3 space-y-2.5">
              {Object.values(VOICE_RULES).map((rule) => (
                <li key={rule.id}>
                  <p className="text-[13px] text-foreground">{rule.because}</p>
                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {rule.severity === "block" ? "Blocks approval" : "Flags for review"}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div className="tt-surface p-5">
            <p className="tt-eyebrow">Check a passage</p>
            <textarea
              value={sample}
              onChange={(event) => setSample(event.target.value)}
              rows={6}
              placeholder="Paste anything you are about to send."
              aria-label="Check a passage against the voice policy"
              className="mt-3 w-full rounded-lg border border-input bg-card p-3 text-[13px] text-foreground"
            />
            {verdict ? (
              verdict.violations.length === 0 ? (
                <p className="mt-3 text-[13px] text-success">This reads like Tai.</p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {verdict.violations.map((violation, index) => (
                    <li
                      key={`${violation.ruleId}-${index}`}
                      className={
                        violation.severity === "block"
                          ? "text-[13px] text-destructive"
                          : "text-[13px] text-warning"
                      }
                    >
                      {violation.because}
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
