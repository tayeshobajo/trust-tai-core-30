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
import {
  getVoiceProfile,
  listVoiceSnapshots,
  saveVoiceProfile,
  VoiceConflictError,
  type VoiceProfile,
} from "@/data/supabase/comms-voice";

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
    <WorkspaceGate appId="comms">
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

  const snapshotsQuery = useQuery({
    queryKey: ["comms", "voice-snapshots", identity.organizationId],
    queryFn: () => listVoiceSnapshots(identity.organizationId),
  });

  const save = useMutation({
    mutationFn: (vars: { current: VoiceProfile | null; reset?: boolean }) =>
      saveVoiceProfile({
        organizationId: identity.organizationId,
        current: vars.current,
        contentMarkdown: draft,
        userId: identity.userId,
        ...(vars.reset ? { reset: true } : {}),
      }),
    onSuccess: async (next) => {
      queryClient.setQueryData(["comms", "voice", identity.organizationId], next);
      /* Changing how Tai sounds changes what every open review was measured
         against. Anything that reports readiness has to ask again rather than
         keep showing an answer that was true under the old rules. */
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["comms", "send-readiness"] }),
        queryClient.invalidateQueries({ queryKey: ["comms", "review"] }),
        queryClient.invalidateQueries({ queryKey: ["comms", "reviews", identity.organizationId] }),
        queryClient.invalidateQueries({
          queryKey: ["comms", "voice-snapshots", identity.organizationId],
        }),
      ]);
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
                      onClick={() => save.mutate({ current: profile })}
                    >
                      {save.isPending ? "Saving" : "Save"}
                    </TTButton>
                    <TTButton
                      size="sm"
                      variant="quiet"
                      disabled={save.isPending}
                      onClick={() => setDraft(DEFAULT_VOICE_DOCUMENT)}
                    >
                      Reset to starting document
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
            <div className="mt-3 rounded-lg border border-destructive/40 p-3">
              <p className="text-[13px] text-destructive">{(save.error as Error).message}</p>
              {save.error instanceof VoiceConflictError && save.error.latest ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {/* Nothing the person wrote is thrown away: they choose. */}
                  <TTButton
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const latest = (save.error as VoiceConflictError).latest;
                      if (latest) {
                        queryClient.setQueryData(
                          ["comms", "voice", identity.organizationId],
                          latest,
                        );
                        save.reset();
                      }
                    }}
                  >
                    Keep my writing, compare with theirs
                  </TTButton>
                  <span className="text-[12px] text-muted-foreground">
                    Their version {save.error.latest.version} is shown in preview once you switch
                    back.
                  </span>
                </div>
              ) : null}
            </div>
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

          <div className="tt-surface p-5">
            <p className="tt-eyebrow">Versions reviews were built from</p>
            {snapshotsQuery.isLoading ? (
              <p className="mt-3 text-[13px] text-muted-foreground">Reading review records…</p>
            ) : snapshotsQuery.isError ? (
              <p className="mt-3 text-[13px] text-destructive">
                {(snapshotsQuery.error as Error).message} Nothing is shown rather than a guess.
              </p>
            ) : (snapshotsQuery.data?.snapshots ?? []).length === 0 ? (
              <p className="mt-3 text-[13px] text-muted-foreground">
                No review has been built from this document yet, so there is no snapshot to show.
                There is no separate edit history: a version only leaves a record once a review
                actually captured it.
              </p>
            ) : (
              <>
                <ul className="mt-3 space-y-3">
                  {(snapshotsQuery.data?.snapshots ?? []).map((snapshot) => (
                    <li key={`${snapshot.profileId}-${snapshot.version}-${snapshot.checksum}`}>
                      <p className="text-[13px] text-foreground">
                        {snapshot.version === null
                          ? "Version not recorded"
                          : `Version ${snapshot.version}`}
                        {" · "}
                        {snapshot.capturedRuns} captured ·{" "}
                        {snapshot.completedRuns === 0
                          ? "none evaluated"
                          : `${snapshot.completedRuns} evaluated`}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        {snapshot.checksum
                          ? `sha256 ${snapshot.checksum.slice(0, 12)}`
                          : "no checksum"}
                        {snapshot.textRetained ? " · exact text kept" : " · text not kept"}
                      </p>
                      {snapshot.lastUsedAt ? (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Last used {new Date(snapshot.lastUsedAt).toLocaleString()}
                        </p>
                      ) : null}
                      {snapshot.rulesText ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[11px] text-muted-foreground underline">
                            Read the exact rules kept with these runs
                          </summary>
                          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-muted/30 p-2 text-[11px] text-foreground">
                            {snapshot.rulesText}
                          </pre>
                        </details>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  {snapshotsQuery.data?.bounded
                    ? `This is the most recent ${snapshotsQuery.data.windowSize} runs, not the whole record. Older runs exist beyond this window.`
                    : `Read from all ${snapshotsQuery.data?.runsRead ?? 0} runs on record.`}{" "}
                  Captured means the rules were frozen with the run; evaluated means the review
                  actually completed against them.
                </p>
              </>
            )}

            <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
              Reviews use this workspace&apos;s own rules only. No message written to another client
              is ever borrowed as an example: those carry other people&apos;s names, prices and
              promises.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
