/**
 * Comms, the relationship room.
 *
 * Relationships on the left, the relationship itself in the middle, and its
 * intelligence on the right. Reading a relationship should feel like
 * continuing a conversation, not administering a record.
 *
 * Comms remembers what happened, holds what was promised, and only suggests
 * outreach when there is a real reason. Every write goes to Supabase under the
 * caller's own access. Nothing is sent from here; a person always sends.
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
import { ReplyRecordBar } from "@/components/tt/comms/reply-record";
import { RelationshipRail } from "@/components/tt/comms/relationship-rail";
import { AddInteraction, type InteractionSubmission } from "@/components/tt/comms/add-interaction";
import { SequenceInRoadmap } from "@/components/tt/roadmap/sequence-button";
import { roadmapHandoffReadiness } from "@/data/comms-roadmap-handoff";
import { EmptyState, PageHeader, TTButton } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { commsService, type RelationshipInput } from "@/data/supabase/comms-service";
import { deriveConversationHealth, relationshipStrength } from "@/data/comms-health";
import { conversationTimeline, groupByDay } from "@/data/comms-timeline";
import { inboxEntries, inboxView, type InboxTab } from "@/data/comms-inbox";
import { nextRelationshipMove } from "@/data/comms-next-move";
import type { ConversationHealthStatus } from "@/domain/comms-health";
import type { MemoryItem, Relationship, Touch } from "@/domain/comms";
import {
  COMMITMENT_CATEGORY,
  interactionDefinition,
  manualProvenance,
  type Commitment,
} from "@/domain/comms-interactions";
import type { VoiceRegister } from "@/domain/voice";
import { supabase } from "@/integrations/trust-tai/supabase";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Comms · relationships kept warm · Trust Tai OS";
const DESCRIPTION =
  "Trust Tai's relationship room: what happened, what was promised, what needs attention, and the next thoughtful move.";

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
  const [interacting, setInteracting] = useState(false);

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

  // The context drawer is a small-screen affordance: Escape closes it, and it
  // never lingers once the rail has room to sit beside the conversation again.
  useEffect(() => {
    if (!contextOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setContextOpen(false);
    }
    const wide = window.matchMedia("(min-width: 1280px)");
    function onWide(event: MediaQueryListEvent) {
      if (event.matches) setContextOpen(false);
    }
    window.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => {
      window.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
    };
  }, [contextOpen]);



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
  const health = selected ? deriveConversationHealth(selected, selectedTouches) : null;
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

  /**
   * Record something that happened elsewhere. The touch keeps Tai's name on
   * it, and only the derived facts a person ticked are written to memory.
   */
  const recordInteraction = useMutation({
    mutationFn: async (submission: InteractionSubmission) => {
      const relationship = selected!;
      const definition = interactionDefinition(submission.type);
      const provenance = manualProvenance(identity.name);

      await commsService.logTouch(
        {
          relationship,
          channel: definition.channel,
          direction: definition.direction,
          summary: `${submission.summary} · ${provenance.label}`,
          body: submission.body,
          occurredAt: submission.occurredAt,
        },
        context,
      );

      for (const entry of submission.confirmed) {
        await commsService.remember(
          relationship,
          {
            label: entry.kind === "commitment" ? "Promise" : "Worth remembering",
            value: entry.text,
            tier: "decided",
            evidence: [provenance, { label: `From: ${entry.because}`, kind: "human" }],
            ...(entry.kind === "commitment"
              ? {
                  category: COMMITMENT_CATEGORY,
                  status: "open" as const,
                  owner: entry.owner ?? "us",
                  ...(entry.due ? { due: entry.due } : {}),
                }
              : { category: entry.kind === "next_move" ? "Important context" : "What they care about" }),
            addedBy: provenance.label,
          },
          context,
        );
      }
    },
    onSuccess: async () => {
      setInteracting(false);
      await refresh();
    },
  });

  const settleCommitment = useMutation({
    mutationFn: (input: { commitment: Commitment; status: "kept" | "released" }) =>
      commsService.settleCommitment(
        selected!,
        { text: input.commitment.text, at: input.commitment.at },
        input.status,
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

  const move = selected ? nextRelationshipMove(selected) : null;

  const rail =
    selected && health && strength && move ? (
      <RelationshipRail
        relationship={selected}
        health={health}
        strength={strength}
        move={move}
        onRemember={() => setInteracting(true)}
        onPrepareMove={() => void compose("follow_up", move.action)}
        onRemindLater={() => update.mutate({ nextAction: move.action })}
        onNotNeeded={() => update.mutate({ nextAction: null })}
        onSettleCommitment={(commitment, status) =>
          settleCommitment.mutate({ commitment, status })
        }
      />
    ) : null;

  return (
    <AppShell
      identity={identity}
      sidebar={
        <CommsSidebarPanels
          view={view}
          health={healthFilter}
          tab={tab}
          onHealth={setHealthFilter}
          onTab={setTab}
          onAdd={() => setCapturing(true)}
        />

      }
    >
    <div className="-mx-4 -mt-8 w-auto bg-[linear-gradient(180deg,var(--cloud)_0%,transparent_200px)] px-4 py-6 sm:-mx-6 sm:px-6 lg:-mx-10 lg:-mt-10 lg:px-8">

      <PageHeader
        appId="comms"
        eyebrow="Comms"
        title="Relationships, kept warm."
        supporting="Comms remembers interactions, helps Tai decide the next move, and drafts in Tai's voice so every relationship stays cared for."
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
            {selected ? (
              <TTButton variant="quiet" onClick={() => setInteracting(true)}>
                Add interaction
              </TTButton>
            ) : null}
            <TTButton onClick={() => setCapturing((value) => !value)}>
              {capturing ? "Close" : "Add relationship"}
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

      <div className="mt-5 grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(520px,1fr)_300px] 2xl:grid-cols-[340px_minmax(520px,1fr)_320px]">
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

      {/*
        Below xl the rail becomes a drawer so the conversation column stays the
        dominant thing on screen. Escape closes it; the scrim is a real button.
      */}
      {contextOpen && rail ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Conversation context"
          className="fixed inset-0 z-50 flex justify-end bg-foreground/25 backdrop-blur-sm xl:hidden"
        >
          <button
            type="button"
            aria-label="Close context"
            className="flex-1"
            onClick={() => setContextOpen(false)}
          />
          <div className="tt-rise flex h-full w-[min(380px,92vw)] flex-col overflow-y-auto border-l border-border bg-card">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-4 py-3">
              <p className="tt-eyebrow">Context</p>
              <button
                type="button"
                onClick={() => setContextOpen(false)}
                className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
