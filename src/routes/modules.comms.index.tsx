/**
 * Comms, the relationship room.
 *
 * Relationships on the left, the relationship itself owning the rest.
 * Intelligence appears when called, in an overlay context drawer — never a
 * permanent third column taxing the reading width. Reading a relationship
 * should feel like continuing a conversation, not administering a record.
 *
 * Comms remembers what happened, holds what was promised, and only suggests
 * outreach when there is a real reason. Every write goes to Supabase under the
 * caller's own access. Nothing is sent from here; a person always sends.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

import { AppShell } from "@/components/tt/app-shell";
import { CommsTabs } from "@/components/tt/comms/comms-tabs";
import { CaptureForm } from "@/components/tt/comms/capture-form";
import { MailboxImport } from "@/components/tt/comms/mailbox-import";
import { CommsInbox } from "@/components/tt/comms/comms-inbox";
import { CommsSidebarPanels } from "@/components/tt/comms/comms-sidebar";
import { ConversationRoom } from "@/components/tt/comms/conversation-room";
import { ReplyRecordBar } from "@/components/tt/comms/reply-record";
import { SendComposer } from "@/components/tt/comms/send-composer";
import { RelationshipRail } from "@/components/tt/comms/relationship-rail";
import { AddInteraction, type InteractionSubmission } from "@/components/tt/comms/add-interaction";
import { SequenceInRoadmap } from "@/components/tt/roadmap/sequence-button";
import { roadmapHandoffReadiness } from "@/data/comms-roadmap-handoff";
import { detectRoadmapOpportunity } from "@/data/relationship-development";
import { EmptyState, PageHeader, TTButton } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { commsService, type RelationshipInput } from "@/data/supabase/comms-service";
import { gmailDownloadAttachment, gmailSync } from "@/data/supabase/comms-gmail";
import { addMailboxCandidateToComms, ONBOARDING_BACKFILL_DAYS } from "@/data/comms-onboarding";
import { listRelationshipMessages } from "@/data/supabase/comms-messages";
import { deriveConversationHealth, relationshipStrength } from "@/data/comms-health";
import { conversationTimeline, groupByDay } from "@/data/comms-timeline";
import {
  inboxEntries,
  inboxPage,
  inboxView,
  pageSelection,
  type InboxTab,
} from "@/data/comms-inbox";
import { nextRelationshipMove } from "@/data/comms-next-move";
import { relationshipsWorthAttention } from "@/data/comms-attention";
import {
  clearAttentionDecision,
  loadAttentionState,
  markReviewed,
  saveAttentionState,
  snoozeRelationship,
  snoozeUntil,
  splitAttention,
  EMPTY_ATTENTION_STATE,
  type AttentionState,
  type SnoozeChoice,
} from "@/data/comms-attention-state";
import { EditInteraction, type InteractionEdit } from "@/components/tt/comms/edit-interaction";
import { RelationshipExport } from "@/components/tt/comms/relationship-export";
import type { ConversationHealthStatus } from "@/domain/comms-health";
import type { MemoryItem, Relationship, Touch } from "@/domain/comms";
import {
  writeCommunicationJudgment,
  writeDraftGrounding,
  type CommunicationJudgment,
  type DraftGroundingSummary,
} from "@/domain/comms-judgment";
import {
  COMMITMENT_CATEGORY,
  interactionDefinition,
  manualProvenance,
  type Commitment,
} from "@/domain/comms-interactions";
import type { VoiceRegister } from "@/domain/voice";
import { supabase } from "@/integrations/trust-tai/supabase";
import type { WorkspaceIdentity } from "@/lib/workspace";

/** States in which the composer replaces the prepare bar: a draft is in hand. */
const COMPOSER_STATES = new Set(["draft", "needs_human_review", "approved", "sending", "send_failed"]);

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
  /** The communication judgment the draft was written from, when one exists. */
  judgment?: CommunicationJudgment | null;
  /** What the draft stands on, and what would sharpen it. Shown before send. */
  grounding?: DraftGroundingSummary | null;
}

function CommsRoute() {
  return <WorkspaceGate appId="comms">{(identity) => <CommsRoom identity={identity} />}</WorkspaceGate>;
}

function CommsRoom({ identity }: { identity: WorkspaceIdentity }) {
  const queryClient = useQueryClient();
  const context = { organizationId: identity.organizationId, userId: identity.userId };

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<InboxTab>("all");
  const [healthFilter, setHealthFilter] = useState<ConversationHealthStatus | null>(null);
  const [page, setPage] = useState(1);
  const [capturing, setCapturing] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  /**
   * Whether the draft editor is open is a person's choice, never a derived
   * fact: an existing draft must not trap the thread. Keyed by
   * relationship AND draft, so switching people can never leak one person's
   * draft state into another's room. Close is not discard — closing here
   * only returns to the conversation; the draft stays on record.
   */
  const [openDraftKey, setOpenDraftKey] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [editingTouchId, setEditingTouchId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  /**
   * What a person set aside today. Kept on this device: it is a decision about
   * their own attention, not a fact about the relationship.
   */
  const [attentionState, setAttentionState] = useState<AttentionState>(EMPTY_ATTENTION_STATE);

  useEffect(() => {
    setAttentionState(loadAttentionState(identity.organizationId));
  }, [identity.organizationId]);

  function decideAttention(next: AttentionState) {
    setAttentionState(next);
    saveAttentionState(identity.organizationId, next);
  }

  const relationshipsQuery = useQuery({
    queryKey: ["comms", "relationships", identity.organizationId],
    queryFn: () => commsService.list(identity.organizationId),
  });

  const orgTouchesQuery = useQuery({
    queryKey: ["comms", "org-touches", identity.organizationId],
    queryFn: () => commsService.listRecentTouches(identity.organizationId),
  });

  const relationships = useMemo(() => relationshipsQuery.data ?? [], [relationshipsQuery.data]);

  const touchesByRelationship = useMemo(() => {
    const map: Record<string, Touch[]> = {};
    for (const touch of orgTouchesQuery.data ?? []) {
      const list = map[touch.relationshipId] ?? [];
      list.push(touch);
      map[touch.relationshipId] = list;
    }
    return map;
  }, [orgTouchesQuery.data]);

  const entries = useMemo(
    () => inboxEntries(relationships, touchesByRelationship),
    [relationships, touchesByRelationship],
  );

  const view = useMemo(
    () => inboxView(entries, { tab, query, health: healthFilter }),
    [entries, tab, query, healthFilter],
  );

  /**
   * The view is always derived in full — search, filters, counts, and tabs
   * describe the whole view — and only the rendered list is paged.
   */
  const pageView = useMemo(() => inboxPage(view, page), [view, page]);

  /**
   * A view change (tab, search, health filter) always returns to page one,
   * and the open conversation falls back to the first row of that page when
   * the person is no longer on it.
   */
  function changeView(next: { tab?: InboxTab; query?: string; health?: ConversationHealthStatus | null }) {
    const nextTab = next.tab ?? tab;
    const nextQuery = next.query ?? query;
    const nextHealth = next.health !== undefined ? next.health : healthFilter;
    setTab(nextTab);
    setQuery(nextQuery);
    setHealthFilter(nextHealth);
    setPage(1);
    const firstPage = inboxPage(
      inboxView(entries, { tab: nextTab, query: nextQuery, health: nextHealth }),
      1,
    );
    const keep = pageSelection(firstPage.rows, selectedId);
    if (keep !== selectedId) setSelectedId(keep);
  }

  function changePage(next: number) {
    const target = inboxPage(view, next);
    setPage(target.page);
    const keep = pageSelection(target.rows, selectedId);
    if (keep !== selectedId) setSelectedId(keep);
  }

  /**
   * The open conversation defaults to the first person on the current page,
   * so the room never shows someone the list is not showing — unless the
   * person was opened directly (from the sidebar), which always wins.
   */
  const selected: Relationship | null =
    (selectedId ? relationships.find((entry) => entry.id === selectedId) : null) ??
    relationships.find((entry) => entry.id === pageSelection(pageView.rows, null)) ??
    null;

  useEffect(() => {
    if (!selectedId && selected) setSelectedId(selected.id);
  }, [selected, selectedId]);

  // Relationship context is an overlay drawer at every size — the room grid
  // keeps only inbox + conversation. Escape closes it, focus returns to the
  // control that opened it, and the drawer always reflects the currently
  // selected relationship because the rail derives from `selected`.
  useEffect(() => {
    if (!contextOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setContextOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
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

  // Mail the sync already stored for this person. Folds into the same thread
  // as manual touches; it is never re-written as touches.
  const messagesQuery = useQuery({
    queryKey: ["comms", "messages", selected?.id],
    enabled: Boolean(selected),
    queryFn: () => listRelationshipMessages(identity.organizationId, selected!.id),
  });

  const selectedTouches = touchesQuery.data ?? touchesByRelationship[selected?.id ?? ""] ?? [];
  const drafts = draftsQuery.data ?? [];
  const selectedMessages = messagesQuery.data ?? [];
  const health = selected ? deriveConversationHealth(selected, selectedTouches) : null;
  const strength = selected ? relationshipStrength(selected, selectedTouches) : null;
  const days = useMemo(
    () => groupByDay(conversationTimeline(selectedTouches, drafts, selectedMessages)),
    [selectedTouches, drafts, selectedMessages],
  );

  /**
   * Roadmap is recognized from revealed need, never forced. This read runs
   * over what the conversation and interactions actually said; it recommends
   * nothing and creates nothing. Tai decides whether to propose a roadmap.
   */
  const roadmapSignal = useMemo(() => {
    if (!selected) return null;
    const texts = [
      ...selectedMessages.map((message) => ({
        text: [message.subject ?? "", message.bodyText ?? message.snippet ?? ""].join("\n"),
        source: message.direction === "inbound" ? "Their email" : "Our email",
      })),
      ...selectedTouches.map((touch) => ({
        text: [touch.summary, touch.body ?? ""].join("\n"),
        source: touch.direction === "inbound" ? "Their words" : "Logged interaction",
      })),
    ];
    return detectRoadmapOpportunity(texts);
  }, [selected, selectedMessages, selectedTouches]);
  const savedDraft = drafts.find((draft) => draft.reviewState !== "discarded");
  /** The open editor is this relationship's draft AND a person's choice. */
  const activeDraft =
    selected && savedDraft && COMPOSER_STATES.has(savedDraft.reviewState) ? savedDraft : null;
  const draftKey = selected && activeDraft ? `${selected.id}:${activeDraft.id}` : null;
  const editorOpen = draftKey !== null && openDraftKey === draftKey;

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

  /**
   * Add to Comms from the labeled-candidate list. Creation runs exactly as a
   * manual capture; immediately after, one member-authorized bounded backfill
   * (30 days, label-gated, read-only) brings the person's existing labeled
   * history in — from the same mailbox the candidate was discovered in. A
   * backfill failure never removes the relationship — it only leaves a
   * warning asking to sync again.
   */
  const [importPhase, setImportPhase] = useState<"creating" | "backfilling" | null>(null);
  const [importWarning, setImportWarning] = useState<string | null>(null);
  const importFromMailbox = useMutation({
    mutationFn: (input: {
      relationship: RelationshipInput;
      integrationId?: string;
      /**
       * Bulk imports set keepOpen: the capture panel must stay where it is
       * while several people are added one after another — no selection
       * jump, no panel close, one quiet refresh per person.
       */
      keepOpen?: boolean;
    }) =>
      addMailboxCandidateToComms(input.relationship, {
        createRelationship: async (value) => {
          setImportPhase("creating");
          return commsService.create(value, context);
        },
        backfillHistory: async () => {
          setImportPhase("backfilling");
          await gmailSync(
            identity.organizationId,
            ONBOARDING_BACKFILL_DAYS,
            input.integrationId,
          );
        },
      }),
    onSuccess: async ({ relationship, historyWarning }, variables) => {
      if (variables.keepOpen) {
        await refresh();
        return;
      }
      setSelectedId(relationship.id);
      setImportWarning(historyWarning);
      // With history in, the panel steps aside; with a warning, it stays open
      // so the message is seen next to the person it concerns.
      if (!historyWarning) setCapturing(false);
      await refresh();
    },
    onSettled: () => setImportPhase(null),
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

  const editTouch = useMutation({
    mutationFn: (input: { touchId: string; edit: InteractionEdit }) => {
      const touch = selectedTouches.find((entry) => entry.id === input.touchId);
      if (!touch) throw new Error("That interaction is no longer on screen.");
      return commsService.editTouch(
        {
          touch,
          relationship: selected!,
          summary: input.edit.summary,
          ...(input.edit.body !== undefined ? { body: input.edit.body } : {}),
          editedBy: identity.name,
        },
        context,
      );
    },
    onSuccess: () => {
      setEditingTouchId(null);
      refresh();
    },
  });

  const retractTouch = useMutation({
    mutationFn: (input: { touchId: string; because?: string; restore?: boolean }) => {
      const touch = selectedTouches.find((entry) => entry.id === input.touchId);
      if (!touch) throw new Error("That interaction is no longer on screen.");
      return commsService.retractTouch(
        {
          touch,
          relationship: selected!,
          retractedBy: identity.name,
          ...(input.because ? { because: input.because } : {}),
          ...(input.restore ? { restore: true } : {}),
        },
        context,
      );
    },
    onSuccess: () => {
      setEditingTouchId(null);
      refresh();
    },
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
          rationale: draft.judgment
            ? writeDraftGrounding(
                writeCommunicationJudgment({ violations: draft.violations }, draft.judgment),
                draft.grounding,
              )
            : { violations: draft.violations },
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
   * Discard is the only destructive act on a draft, and it is always a
   * separate, explicit, confirmed choice — never a side effect of closing.
   */
  const discardDraft = useMutation({
    mutationFn: (draft: NonNullable<typeof activeDraft>) =>
      commsService.setDraftState(draft, "discarded", selected!, context),
    onSuccess: async () => {
      setConfirmDiscard(false);
      setOpenDraftKey(null);
      await refresh();
    },
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
      const saved = await saveDraft.mutateAsync(payload as unknown as DraftPreview);
      // A freshly prepared draft opens for review; an existing one never
      // forces the editor open on its own.
      setConfirmDiscard(false);
      setOpenDraftKey(`${selected.id}:${saved.id}`);
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
  const attentionSplit = splitAttention(
    relationshipsWorthAttention(relationships),
    attentionState,
  );
  const editingTouch = editingTouchId
    ? (selectedTouches.find((entry) => entry.id === editingTouchId) ?? null)
    : null;

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
        onGraduate={() => update.mutate({ stage: "client" })}
        onMoveToNurture={() => update.mutate({ stage: "nurture" })}
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
          onHealth={(status) => changeView({ health: status })}
          onTab={(next) => changeView({ tab: next })}
          onAdd={() => setCapturing(true)}
          attention={attentionSplit.shown}
          setAside={attentionSplit.set_aside}
          onSnooze={(id, choice: SnoozeChoice) =>
            decideAttention(snoozeRelationship(attentionState, id, snoozeUntil(choice)))
          }
          onMarkReviewed={(id) => decideAttention(markReviewed(attentionState, id))}
          onRestoreAttention={(id) => decideAttention(clearAttentionDecision(attentionState, id))}
          onOpenRelationship={(id) => setSelectedId(id)}
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
            <TTButton
              onClick={() => {
                setImportWarning(null);
                setCapturing((value) => !value);
              }}
            >
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
            onImport={async (input, integrationId, options) => {
              await importFromMailbox.mutateAsync({
                relationship: input,
                ...(integrationId ? { integrationId } : {}),
                ...(options?.keepOpen ? { keepOpen: true } : {}),
              });
            }}
            busy={importFromMailbox.isPending}
            busyLabel={
              importPhase === "backfilling" ? "Bringing in labeled history…" : "Adding to Comms…"
            }
          />
          {create.isError ? (
            <p className="text-[13px] text-destructive">{(create.error as Error).message}</p>
          ) : null}
          {importFromMailbox.isError ? (
            <p className="text-[13px] text-destructive">
              {(importFromMailbox.error as Error).message}
            </p>
          ) : null}
          {importWarning ? (
            <p className="text-[13px] text-destructive">{importWarning}</p>
          ) : null}
        </div>
      ) : null}

      {/* Inbox finds the person; conversation owns the room. Intelligence
          appears when called — context is an overlay drawer, never a column. */}
      <div className="mt-5 grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="tt-surface max-h-[78vh] overflow-hidden p-0 lg:sticky lg:top-20">
          <CommsInbox
            view={view}
            page={pageView}
            onPage={changePage}
            tab={tab}
            onTab={(next) => changeView({ tab: next })}
            query={query}
            onQuery={(value) => changeView({ query: value })}
            health={healthFilter}
            onHealth={(status) => changeView({ health: status })}
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
              organizationId={context.organizationId}
              onViewProfile={() => setProfileOpen((value) => !value)}
              onOpenContext={() => setContextOpen(true)}
              onAddInteraction={() => setInteracting(true)}
              onExportSummary={() => setExporting(true)}
              onEditTouch={(touchId) => setEditingTouchId(touchId)}
              onRetractTouch={(touchId) => setEditingTouchId(touchId)}
              onRestoreTouch={(touchId) => retractTouch.mutate({ touchId, restore: true })}
              onDownloadAttachment={(event, file) => {
                if (!event.messageId || !file.attachmentId) return;
                void gmailDownloadAttachment({
                  organizationId: context.organizationId,
                  messageId: event.messageId,
                  attachmentId: file.attachmentId,
                  filename: file.filename,
                });
              }}
            >
              {roadmapSignal?.emerging ? (
                <div className="border-t border-border bg-violet-50/60 px-5 py-4">
                  <p className="tt-eyebrow text-violet-700">Roadmap opportunity emerging</p>
                  <p className="mt-2 text-[13px] text-muted-foreground">{roadmapSignal.because}</p>
                  <ul className="mt-2 space-y-1">
                    {roadmapSignal.needs.map((need) => (
                      <li key={need.kind} className="text-[13px] text-foreground">
                        <span className="font-medium">{need.label}</span>
                        <span className="text-muted-foreground"> — {need.evidence}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    Recognition, not a pitch. Whether to propose a roadmap stays your call, in the
                    conversation.
                  </p>
                </div>
              ) : null}

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

              {activeDraft && editorOpen ? (
                <SendComposer
                  draft={activeDraft}
                  relationship={selected}
                  context={context}
                  messages={selectedMessages}
                  onChanged={refresh}
                  onClose={() => setOpenDraftKey(null)}
                />
              ) : (
                <>
                  {/* A draft exists but the editor is closed: the thread stays
                      readable, and this quiet strip is the way back in. The
                      draft is never discarded by closing — only by the
                      explicit, confirmed choice here. */}
                  {activeDraft ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-cloud/40 px-4 py-2 sm:px-5">
                      <p className="min-w-0 truncate text-[12px] text-muted-foreground">
                        <span className="font-medium text-foreground">Draft saved</span>
                        {activeDraft.subject?.trim() ? ` · ${activeDraft.subject.trim()}` : ""}
                      </p>
                      <div className="flex items-center gap-2">
                        {confirmDiscard ? (
                          <>
                            <span className="text-[12px] text-muted-foreground">
                              Discard this draft? This cannot be undone.
                            </span>
                            <TTButton
                              variant="quiet"
                              size="sm"
                              type="button"
                              disabled={discardDraft.isPending}
                              onClick={() => discardDraft.mutate(activeDraft)}
                            >
                              {discardDraft.isPending ? "Discarding…" : "Confirm discard"}
                            </TTButton>
                            <TTButton
                              variant="quiet"
                              size="sm"
                              type="button"
                              onClick={() => setConfirmDiscard(false)}
                            >
                              Keep it
                            </TTButton>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDiscard(true)}
                            className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            Discard
                          </button>
                        )}
                        <TTButton
                          variant="quiet"
                          size="sm"
                          type="button"
                          onClick={() => {
                            setConfirmDiscard(false);
                            setOpenDraftKey(draftKey);
                          }}
                        >
                          Resume draft
                        </TTButton>
                      </div>
                    </div>
                  ) : null}
                  <ReplyRecordBar
                    drafting={drafting}
                    busy={recordInteraction.isPending || saveDraft.isPending}
                    error={draftError}
                    purposeHint={move?.needed ? move.action : null}
                    onPrepareDraft={(register, purpose) => void compose(register, purpose)}
                    onRecordInteraction={() => setInteracting(true)}
                  />
                </>
              )}
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

      </div>

      {/*
        Relationship intelligence lives in an overlay drawer at every size, so
        the conversation keeps the full width it is owed. Escape closes it,
        the scrim is a real button, and switching relationships re-derives the
        rail in place — context can never go stale.
      */}
      {contextOpen && rail ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Relationship context"
          className="fixed inset-0 z-50 flex justify-end bg-foreground/25 backdrop-blur-sm"
        >
          <button
            type="button"
            aria-label="Close context"
            className="flex-1"
            onClick={() => setContextOpen(false)}
          />
          <div className="tt-rise flex h-full w-[min(400px,92vw)] flex-col overflow-y-auto border-l border-border bg-card">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-4 py-3">
              <p className="tt-eyebrow">Relationship context</p>
              <button
                type="button"
                autoFocus
                onClick={() => setContextOpen(false)}
                aria-label="Close relationship context"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-3 w-3" aria-hidden />
                Close
              </button>
            </div>
            {rail}
          </div>
        </div>
      ) : null}

      {editingTouch && selected ? (
        <EditInteraction
          touch={editingTouch}
          personName={selected.fullName}
          userLabel={identity.name}
          busy={editTouch.isPending || retractTouch.isPending}
          onCancel={() => setEditingTouchId(null)}
          onSave={(edit) => editTouch.mutate({ touchId: editingTouch.id, edit })}
          onRetract={(because) =>
            retractTouch.mutate({ touchId: editingTouch.id, ...(because ? { because } : {}) })
          }
          onRestore={() => retractTouch.mutate({ touchId: editingTouch.id, restore: true })}
        />
      ) : null}

      {exporting && selected && health && strength && move ? (
        <RelationshipExport
          input={{
            relationship: selected,
            health,
            strength,
            move,
            touches: selectedTouches,
            exportedBy: identity.name,
          }}
          onClose={() => setExporting(false)}
        />
      ) : null}

      {interacting && selected ? (
        <AddInteraction
          personName={selected.fullName}
          userLabel={identity.name}
          busy={recordInteraction.isPending}
          onCancel={() => setInteracting(false)}
          onSave={(submission) => recordInteraction.mutate(submission)}
        />
      ) : null}
    </div>
    </AppShell>
  );
}
