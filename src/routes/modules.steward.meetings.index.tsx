/**
 * Steward, Meetings.
 *
 * Read a conversation, see exactly what Steward heard, then decide. Reading is
 * a server call to the connected source; confirming is a separate, deliberate
 * act. When no source is connected the room says so and offers the labelled
 * rehearsal transcript instead of pretending.
 */

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { AppHero } from "@/components/tt/app-hero";
import { AppShell } from "@/components/tt/app-shell";
import { MetaPill, TTButton, TTInput } from "@/components/tt/primitives";
import { ProposalReview } from "@/components/tt/steward/proposal-review";
import { StewardTabs } from "@/components/tt/steward/steward-tabs";
import { StewardUnavailable } from "@/components/tt/steward/unavailable";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { readConversation, readRehearsal, readSourceState, type ReadResult } from "@/data/steward/ingest";
import { REHEARSAL_NOTICE } from "@/data/steward/fixture";
import { stewardService } from "@/data/supabase/steward-service";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Steward · Meetings · Trust Tai OS";
const DESCRIPTION =
  "Read a call transcript, see what Steward heard, and confirm only what a person agrees actually happened.";

export const Route = createFileRoute("/modules/steward/meetings/")({
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
  component: MeetingsRoute,
});

function MeetingsRoute() {
  return (
    <WorkspaceGate appId="steward">
      {(identity) => (
        <AppShell identity={identity}>
          <Meetings identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function Meetings({ identity }: { identity: WorkspaceIdentity }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [link, setLink] = useState("");
  const [result, setResult] = useState<ReadResult | null>(null);
  const [rehearsal, setRehearsal] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const source = useQuery({
    queryKey: ["steward", "source", identity.organizationId],
    queryFn: () => readSourceState(identity.organizationId),
  });

  const stored = useQuery({
    queryKey: ["steward", "conversations", identity.organizationId],
    queryFn: () => stewardService.conversations(identity.organizationId),
  });

  const read = useMutation({
    mutationFn: (sourceUrl: string) =>
      readConversation({ organizationId: identity.organizationId, sourceUrl }),
    onSuccess: (value) => {
      setRehearsal(false);
      setResult(value);
      setMessage(null);
    },
    onError: (error: unknown) =>
      setMessage(error instanceof Error ? error.message : "Steward could not read that link."),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!result) throw new Error("Nothing has been read yet.");
      return stewardService.saveConversation({
        organizationId: identity.organizationId,
        userId: identity.userId,
        conversation: result.conversation,
      });
    },
    onSuccess: async (conversation) => {
      await queryClient.invalidateQueries({
        queryKey: ["steward", "conversations", identity.organizationId],
      });
      setResult(null);
      navigate({
        to: "/modules/steward/meetings/$conversationId",
        params: { conversationId: conversation.id },
      });
    },
    onError: (error: unknown) =>
      setMessage(error instanceof Error ? error.message : "Steward could not save that conversation."),
  });

  return (
    <div className="space-y-8">
      <AppHero
        appId="steward"
        eyebrow="Steward · Meetings"
        title="Read a conversation."
        supporting="Paste a call link. Steward reads the transcript, shows what it heard with the line it heard it on, and waits for you to decide."
      />

      <StewardTabs active="meetings" />

      <section className="tt-surface p-6">
        <p className="tt-eyebrow">Source</p>
        {source.isLoading ? (
          <p className="mt-3 text-sm text-muted-foreground">Checking what Steward can read…</p>
        ) : source.isError ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {source.error instanceof Error ? source.error.message : "The source could not be checked."}
          </p>
        ) : (
          <p className="mt-3 max-w-reading text-sm text-muted-foreground">
            {source.data?.status.because}
          </p>
        )}

        <form
          className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            if (link.trim()) read.mutate(link.trim());
          }}
        >
          <label className="block">
            <span className="sr-only">Call link</span>
            <TTInput
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="https://fathom.video/calls/…"
              disabled={source.data?.status.configured !== true}
            />
          </label>
          <TTButton
            type="submit"
            disabled={source.data?.status.configured !== true || read.isPending || !link.trim()}
          >
            {read.isPending ? "Reading…" : "Read this call"}
          </TTButton>
        </form>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <TTButton
            type="button"
            variant="secondary"
            onClick={() => {
              setRehearsal(true);
              setResult(readRehearsal());
              setMessage(null);
            }}
          >
            Walk the rehearsal transcript
          </TTButton>
          <p className="text-[13px] text-muted-foreground">{REHEARSAL_NOTICE}</p>
        </div>

        {message ? <p className="mt-4 text-sm text-destructive">{message}</p> : null}

        {(source.data?.recent.length ?? 0) > 0 ? (
          <ul className="mt-6 space-y-2 border-t border-border pt-4">
            {source.data?.recent.map((call) => (
              <li key={call.url} className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-foreground">
                  {call.title}
                  <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {call.occurredAt.slice(0, 10)}
                  </span>
                </span>
                <TTButton
                  type="button"
                  variant="secondary"
                  disabled={!call.hasTranscript || read.isPending}
                  onClick={() => {
                    setLink(call.url);
                    read.mutate(call.url);
                  }}
                >
                  {call.hasTranscript ? "Read" : "No transcript"}
                </TTButton>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {result ? (
        <section className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="tt-eyebrow">What Steward heard</p>
              <h2 className="mt-2 font-display text-2xl text-foreground">
                {result.conversation.title}
              </h2>
            </div>
            {rehearsal ? (
              <MetaPill>Rehearsal only</MetaPill>
            ) : (
              <TTButton type="button" onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save to the workspace"}
              </TTButton>
            )}
          </div>
          <ProposalReview
            conversation={result.conversation}
            proposals={result.proposals}
            confirmedKeys={new Set()}
            readOnlyBecause={
              rehearsal
                ? "This is the rehearsal transcript, so nothing here can become workspace truth."
                : "Save the conversation first, then confirm what actually happened."
            }
          />
        </section>
      ) : null}

      <section>
        <h2 className="tt-eyebrow">Saved conversations</h2>
        {stored.isError ? (
          <div className="mt-4">
            <StewardUnavailable error={stored.error} />
          </div>
        ) : (stored.data?.length ?? 0) === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing has been read into the workspace yet.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {stored.data?.map((conversation) => (
              <li key={conversation.id} className="tt-surface flex flex-wrap items-center justify-between gap-3 p-5">
                <div>
                  <Link
                    to="/modules/steward/meetings/$conversationId"
                    params={{ conversationId: conversation.id }}
                    className="text-[15px] text-foreground underline-offset-4 hover:underline"
                  >
                    {conversation.title}
                  </Link>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {conversation.occurredAt.slice(0, 10)} · {conversation.provider}
                  </p>
                </div>
                <MetaPill>{conversation.participants.length} in the room</MetaPill>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
