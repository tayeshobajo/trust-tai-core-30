/**
 * Comms — the conversation room.
 *
 * Inbox on the left, the conversation itself in the middle, and a quiet rail of
 * context on the right. Reading a relationship should feel like continuing a
 * conversation, not administering a record.
 *
 * Every write goes to Supabase under the caller's own access. Nothing is sent
 * from here; a person always writes and sends the message.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/tt/app-shell";
import { CommsTabs } from "@/components/tt/comms/comms-tabs";
import { CaptureForm } from "@/components/tt/comms/capture-form";
import { MailboxImport } from "@/components/tt/comms/mailbox-import";
import { CommsInbox } from "@/components/tt/comms/comms-inbox";
import { CommsSidebarPanels } from "@/components/tt/comms/comms-sidebar";
import { ConversationRoom } from "@/components/tt/comms/conversation-room";
import { ConversationComposer } from "@/components/tt/comms/conversation-composer";
import { ConversationContext } from "@/components/tt/comms/conversation-context";
import { SequenceInRoadmap } from "@/components/tt/roadmap/sequence-button";
import { roadmapHandoffReadiness } from "@/data/comms-roadmap-handoff";
import { EmptyState, PageHeader, TTButton } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { commsService, type RelationshipInput } from "@/data/supabase/comms-service";
import { conversationHealth, relationshipStrength } from "@/data/comms-health";
import { conversationTimeline, groupByDay } from "@/data/comms-timeline";
import { inboxEntries, inboxView, type InboxTab } from "@/data/comms-inbox";
import { reasonsToReconnect } from "@/data/comms-reminders";
import type { ConversationHealthStatus } from "@/domain/comms-health";
import type { MemoryItem, Relationship, Touch } from "@/domain/comms";
import type { VoiceRegister } from "@/domain/voice";
import { supabase } from "@/integrations/trust-tai/supabase";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Comms — conversations kept warm — Trust Tai OS";
const DESCRIPTION =
  "Trust Tai's conversation room: the whole thread, why it matters, and how the conversation is moving.";

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

interface DraftPreview {
  subject: string;
  body: string;
  register: VoiceRegister;
  reviewState: "draft" | "needs_human_review";
  violations: { ruleId: string; severity: "block" | "flag"; excerpt: string; because: string }[];
  usedEvidence: { label: string; value: string; tier: string }[];
}

function CommsRoute() {
  return <WorkspaceGate>{(identity) => <CommsRoom identity={identity} />}</WorkspaceGate>;
}

function CommsRoom({ identity }: { identity: WorkspaceIdentity }) {
  const queryClient = useQueryClient();
  const context = { organizationId: identity.organizationId, userId: identity.userId };

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<InboxTab>("all");
  const [healthFilter, setHealthFilter] = useState<ConversationHealthStatus | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const relationshipsQuery = useQuery({
    queryKey: ["comms", "relationships", identity.organizationId],
    queryFn: () => commsService.list(identity.organizationId),
  });

  const orgTouchesQuery = useQuery({
    queryKey: ["comms", "org-touches", identity.organizationId],
    queryFn: () => commsService.listRecentTouches(identity.organizationId),
  });

  const relationships = useMemo(() => relationshipsQuery.data ?? [], [relationshipsQuery.data]);
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

  const touchesByRelationship = useMemo(() => {
    const map: Record<string, Touch[]> = {};
    for (const touch of orgTouchesQuery.data ?? []) {
      const list = map[touch.relationshipId] ?? [];
      list.push(touch);
      map[touch.relationshipId] = list;
    }
    return map;
  }, [orgTouchesQuery.data]);

  const view = useMemo(
    () =>
      inboxView(inboxEntries(relationships, touchesByRelationship), {
        tab,
        query,
        health: healthFilter,
      }),
    [relationships, touchesByRelationship, tab, query, healthFilter],
  );

  const selectedTouches = touchesQuery.data ?? touchesByRelationship[selected?.id ?? ""] ?? [];
  const drafts = draftsQuery.data ?? [];
  const health = selected ? conversationHealth(selected, selectedTouches) : null;
  const strength = selected ? relationshipStrength(selected, selectedTouches) : null;
  const days = useMemo(
    () => groupByDay(conversationTimeline(selectedTouches, drafts)),
    [selectedTouches, drafts],
  );
  const savedDraft = drafts.find((draft) => draft.reviewState !== "discarded");

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

  const remember = useMutation({
    mutationFn: (item: Omit<MemoryItem, "at">) =>
      commsService.remember(selected!, item, context),
    onSuccess: refresh,
  });

  const logNote = useMutation({
    mutationFn: (value: string) =>
      commsService.logTouch(
        {
          relationship: selected!,
          channel: "note",
          direction: "outbound",
          summary: value,
        },
        context,
      ),
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
    onSuccess: refresh,
  });

  /**
   * Composing produces a draft that lands inline in the thread. It is never
   * sent: a person reads it there and decides what happens next.
   */
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
      if (!response.ok) {
        throw new Error(String(payload["error"] ?? "That draft could not be prepared."));
      }
      await saveDraft.mutateAsync(payload as unknown as DraftPreview);
    } catch (error) {
      setDraftError(
        error instanceof Error ? error.message : "That draft could not be prepared.",
      );
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

  const rail =
    selected && health && strength ? (
      <ConversationContext
        relationship={selected}
        health={health}
        strength={strength}
        reasons={reasonsToReconnect(selected)}
        savedDraft={savedDraft}
        busy={update.isPending}
        onNextAction={(value) => update.mutate({ nextAction: value || null })}
      />
    ) : null;

  return (
    <AppShell
      identity={identity}
      sidebar={
        <CommsSidebarPanels
          view={view}
          health={healthFilter}
          onHealth={setHealthFilter}
          onAdd={() => setCapturing(true)}
        />
      }
    >
    <div className="-mx-4 -mt-8 w-auto bg-[linear-gradient(180deg,var(--cloud)_0%,transparent_200px)] px-4 py-6 sm:-mx-6 sm:px-6 lg:-mx-10 lg:-mt-10 lg:px-8">

      <PageHeader
        appId="comms"
        eyebrow="Comms"
        title="Conversations, kept warm."
        supporting="The whole thread in one place, with the reason it matters beside it. Nothing is sent from here."
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
                blockedBecause={
                  roadmapHandoffReadiness(selected).ready
                    ? null
                    : roadmapHandoffReadiness(selected).because
                }
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

      <div className="mt-5">
        <CommsTabs active="relationships" />
      </div>

      {capturing ? (
        <div className="tt-surface mt-5 space-y-5 p-6">
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
            <p className="text-[13px] text-destructive">{(create.error as Error).message}</p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[24%_minmax(0,1fr)] xl:grid-cols-[24%_minmax(0,52%)_24%]">
        <aside className="tt-surface max-h-[78vh] overflow-hidden p-0 lg:sticky lg:top-20">
          <CommsInbox
            view={view}
            tab={tab}
            onTab={setTab}
            query={query}
            onQuery={setQuery}
            health={healthFilter}
            onHealth={setHealthFilter}
            selectedId={selected?.id ?? null}
            onSelect={(id) => {
              setSelectedId(id);
              setDraftError(null);
              setProfileOpen(false);
            }}
            empty={relationships.length === 0}
          />
        </aside>

        <main className="tt-surface flex h-[78vh] min-h-[560px] flex-col overflow-hidden p-0">
          {relationshipsQuery.isLoading ? (
            <p className="p-8 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Opening your conversations…
            </p>
          ) : selected && health ? (
            <ConversationRoom
              relationship={selected}
              days={days}
              health={health}
              onViewProfile={() => setProfileOpen((value) => !value)}
              onOpenContext={() => setContextOpen(true)}
            >
              {profileOpen ? (
                <div className="border-t border-border bg-secondary/30 px-5 py-4">
                  <p className="tt-eyebrow">Profile</p>
                  <p className="mt-2 text-[13px] text-muted-foreground">
                    {[
                      selected.email,
                      selected.companyName,
                      selected.metWhere ? `Met at ${selected.metWhere}` : null,
                      selected.metAt
                        ? `Met ${new Date(selected.metAt).toLocaleDateString()}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Nothing else on record yet."}
                  </p>
                  <div className="mt-3">
                    <TTButton
                      variant="quiet"
                      onClick={() =>
                        remember.mutate({
                          label: "Worth remembering",
                          value: "Reviewed this profile.",
                          tier: "decided",
                          evidence: [{ label: "Entered by a person", kind: "human" }],
                        })
                      }
                      disabled={remember.isPending}
                    >
                      Note this review
                    </TTButton>
                  </div>
                </div>
              ) : null}

              <ConversationComposer
                drafting={drafting}
                busy={logNote.isPending || saveDraft.isPending}
                error={draftError}
                onCompose={(register, purpose) => void compose(register, purpose)}
                onNote={(value) => logNote.mutate(value)}
                onInsertInsight={() => reasonsToReconnect(selected)[0]?.reasonText ?? null}
              />
            </ConversationRoom>
          ) : (
            <div className="p-8">
              <EmptyState
                title="No conversations yet."
                belongsHere="The people behind the work: clients, prospects, and everyone you meet."
                whyItMatters="Add the last person you met and Comms carries the conversation from there."
                action={
                  <TTButton onClick={() => setCapturing(true)}>Add someone you met</TTButton>
                }
              />
            </div>
          )}
        </main>

        <aside className="tt-surface hidden max-h-[78vh] flex-col overflow-hidden p-0 xl:sticky xl:top-20 xl:flex">
          {rail ?? (
            <p className="p-4 text-[13px] text-muted-foreground">
              Open a conversation to see why it matters.
            </p>
          )}
        </aside>
      </div>

      {contextOpen && rail ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-background/60 backdrop-blur-sm xl:hidden">
          <button
            type="button"
            aria-label="Close context"
            className="flex-1"
            onClick={() => setContextOpen(false)}
          />
          <div className="flex h-full w-[min(360px,90vw)] flex-col border-l border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <p className="tt-eyebrow">Context</p>
              <button
                type="button"
                onClick={() => setContextOpen(false)}
                className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>
            {rail}
          </div>
        </div>
      ) : null}
    </div>
    </AppShell>
  );
}
