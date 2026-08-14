/**
 * Comms — the relationship room.
 *
 * Three panes: who needs you, the person themselves, and the next move. Every
 * write goes to Supabase under the caller's own access. Nothing is sent from
 * here; a person always writes the message.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/tt/app-shell";
import { CommsTabs } from "@/components/tt/comms/comms-tabs";
import { CaptureForm } from "@/components/tt/comms/capture-form";
import { MailboxImport } from "@/components/tt/comms/mailbox-import";

import {
  CoverageStrip,
  RelationshipQueue,
} from "@/components/tt/comms/relationship-queue";
import { NextMoveRail, type DraftPreview } from "@/components/tt/comms/next-move-rail";
import { RelationshipWorkspace } from "@/components/tt/comms/relationship-workspace";
import { SequenceInRoadmap } from "@/components/tt/roadmap/sequence-button";
import { EmptyState, PageHeader, TTButton } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { commsService, type RelationshipInput } from "@/data/supabase/comms-service";
import type { CommsDraft, MemoryItem, Relationship } from "@/domain/comms";
import type { VoiceRegister } from "@/domain/voice";
import { supabase } from "@/integrations/trust-tai/supabase";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Comms — relationships kept warm — Trust Tai OS";
const DESCRIPTION =
  "Trust Tai's relationship room: who needs a reply, who has gone quiet, and a truthful reason to reach out.";

export const Route = createFileRoute("/modules/comms/")({
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
  component: CommsRoute,
});

function CommsRoute() {
  return (
    <WorkspaceGate>
      {(identity) => (
        <AppShell identity={identity}>
          <CommsRoom identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function CommsRoom({ identity }: { identity: WorkspaceIdentity }) {
  const queryClient = useQueryClient();
  const context = { organizationId: identity.organizationId, userId: identity.userId };

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [preview, setPreview] = useState<DraftPreview | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const relationshipsQuery = useQuery({
    queryKey: ["comms", "relationships", identity.organizationId],
    queryFn: () => commsService.list(identity.organizationId),
  });

  const relationships = relationshipsQuery.data ?? [];
  const selected: Relationship | null =
    relationships.find((entry) => entry.id === selectedId) ?? relationships[0] ?? null;

  useEffect(() => {
    if (!selectedId && selected) setSelectedId(selected.id);
  }, [selected, selectedId]);

  const touchesQuery = useQuery({
    queryKey: ["comms", "touches", selected?.id],
    enabled: Boolean(selected),
    queryFn: () => commsService.listTouches(selected!.id),
  });

  const draftsQuery = useQuery({
    queryKey: ["comms", "drafts", selected?.id],
    enabled: Boolean(selected),
    queryFn: () => commsService.listDrafts(selected!.id),
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["comms"] });
  }

  const create = useMutation({
    mutationFn: (input: RelationshipInput) => commsService.create(input, context),
    onSuccess: async (relationship) => {
      setSelectedId(relationship.id);
      setCapturing(false);
      await refresh();
    },
  });

  const update = useMutation({
    mutationFn: (input: Parameters<typeof commsService.update>[1]) =>
      commsService.update(selected!.id, input, context),
    onSuccess: refresh,
  });

  const logTouch = useMutation({
    mutationFn: (input: {
      channel: Parameters<typeof commsService.logTouch>[0]["channel"];
      direction: "inbound" | "outbound";
      summary: string;
    }) => commsService.logTouch({ relationship: selected!, ...input }, context),
    onSuccess: refresh,
  });

  const remember = useMutation({
    mutationFn: (item: Omit<MemoryItem, "at">) =>
      commsService.remember(selected!, item, context),
    onSuccess: refresh,
  });

  const saveDraft = useMutation({
    mutationFn: (draft: DraftPreview) =>
      commsService.saveDraft(
        {
          relationship: selected!,
          register: draft.register,
          intent: draft.subject || "Message",
          subject: draft.subject,
          body: draft.body,
          reviewState: draft.reviewState,
          rationale: { violations: draft.violations },
          evidence: draft.usedEvidence.map((entry) => ({
            label: `${entry.label} (${entry.tier})`,
            kind: entry.tier === "decided" ? "human" : "computed",
          })),
        },
        context,
      ),
    onSuccess: async () => {
      setPreview(null);
      await refresh();
    },
  });

  const markSent = useMutation({
    mutationFn: (draft: CommsDraft) =>
      commsService.setDraftState(draft, "sent", selected!, context),
    onSuccess: async () => {
      if (selected) {
        await commsService.logTouch(
          {
            relationship: selected,
            channel: "email",
            direction: "outbound",
            summary: "Sent an approved draft.",
          },
          context,
        );
      }
      await refresh();
    },
  });

  const [drafting, setDrafting] = useState(false);

  async function compose(register: VoiceRegister, purpose: string) {
    if (!selected) return;
    setDrafting(true);
    setDraftError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Your session expired. Sign in again.");
      const response = await fetch("/api/public/comms/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ relationshipId: selected.id, register, purpose }),
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok) throw new Error(String(payload["error"] ?? "That draft could not be prepared."));
      setPreview(payload as unknown as DraftPreview);
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : "That draft could not be prepared.");
    } finally {
      setDrafting(false);
    }
  }

  if (relationshipsQuery.isError) {
    return (
      <div className="mx-auto max-w-reading px-6 py-10">
        <PageHeader
          appId="comms"
          eyebrow="Comms"
          title="Comms could not be read."
          supporting={(relationshipsQuery.error as Error).message}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-canvas px-4 py-8 lg:px-8">
      <PageHeader
        appId="comms"
        eyebrow="Comms"
        title="Relationships, kept warm."
        supporting="Who is waiting on you, who has gone quiet, and a truthful reason to reach out. Nothing is sent from here."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {selected ? (
              <SequenceInRoadmap
                subject={{
                  kind: "relationship",
                  id: selected.id,
                  label: selected.companyName || selected.fullName,
                }}
                objective={`Turn the relationship with ${selected.companyName || selected.fullName} into a sequenced path both sides have agreed.`}
                context={{
                  organizationId: identity.organizationId,
                  userId: identity.userId,
                  userLabel: identity.name,
                }}
              />
            ) : null}
            <TTButton onClick={() => setCapturing((value) => !value)}>
              {capturing ? "Close" : "Add someone you met"}
            </TTButton>
          </div>
        }
      />

      <div className="mt-6">
        <CommsTabs active="relationships" />
      </div>

      <div className="mt-6">
        <CoverageStrip relationships={relationships} />
      </div>

      {capturing ? (
        <div className="tt-surface mt-6 space-y-5 p-6">
          <CaptureForm
            onCreate={(input) => create.mutate(input)}
            busy={create.isPending}
            onCancel={() => setCapturing(false)}
          />
          <MailboxImport
            organizationId={identity.organizationId}
            onImport={(input) => create.mutate(input)}
            busy={create.isPending}
          />
          {create.isError ? (
            <p className="text-[13px] text-destructive">
              {(create.error as Error).message}
            </p>
          ) : null}
        </div>
      ) : null}


      <div className="mt-6 grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)_320px]">
        <aside className="tt-surface max-h-[70vh] overflow-hidden p-0 lg:sticky lg:top-20">
          <RelationshipQueue
            relationships={relationships}
            selectedId={selected?.id ?? null}
            onSelect={(id) => {
              setSelectedId(id);
              setPreview(null);
              setDraftError(null);
            }}
            query={query}
            onQuery={setQuery}
          />
        </aside>

        <main className="tt-surface flex min-h-[60vh] flex-col overflow-hidden p-0">
          {relationshipsQuery.isLoading ? (
            <p className="p-8 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Reading your relationships…
            </p>
          ) : selected ? (
            <RelationshipWorkspace
              relationship={selected}
              touches={touchesQuery.data ?? []}
              busy={update.isPending || logTouch.isPending || remember.isPending}
              onStage={(stage) => update.mutate({ stage })}
              onNextAction={(value) => update.mutate({ nextAction: value || null })}
              onLogTouch={(input) => logTouch.mutate(input)}
              onRemember={(item) => remember.mutate(item)}
            />
          ) : (
            <div className="p-8">
              <EmptyState
                title="No relationships yet."
                belongsHere="The people behind the work: clients, prospects, and everyone you meet at an event."
                whyItMatters="Add the last person you met, with where you met and one thing worth remembering. Comms carries it from there."
                action={
                  <TTButton onClick={() => setCapturing(true)}>Add someone you met</TTButton>
                }
              />
            </div>
          )}
        </main>

        <aside className="tt-surface flex max-h-[70vh] flex-col overflow-hidden p-0 lg:sticky lg:top-20">
          {selected ? (
            <NextMoveRail
              relationship={selected}
              drafts={draftsQuery.data ?? []}
              preview={preview}
              drafting={drafting}
              draftError={draftError}
              onDraft={(register, purpose) => void compose(register, purpose)}
              onSave={(value) => saveDraft.mutate(value)}
              onDiscard={() => setPreview(null)}
              onMarkSent={(draft) => markSent.mutate(draft)}
            />
          ) : (
            <p className="p-5 text-[13px] text-muted-foreground">
              Select a relationship to see why it is worth reaching out.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
