/**
 * Steward, one conversation.
 *
 * Everything Steward heard, line-referenced, with a person deciding which
 * proposals become commitments the organization actually carries.
 */

import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppHero } from "@/components/tt/app-hero";
import { AppShell } from "@/components/tt/app-shell";
import { MetaPill, TTButton } from "@/components/tt/primitives";
import { ProposalReview, type ConfirmInput } from "@/components/tt/steward/proposal-review";
import { SemanticReview } from "@/components/tt/steward/semantic-review";
import { StewardTabs } from "@/components/tt/steward/steward-tabs";
import { StewardUnavailable } from "@/components/tt/steward/unavailable";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { readMeetingProcesses } from "@/data/supabase/steward-meeting-process";
import { extractProposals } from "@/data/steward/extract";
import { interpretConversation } from "@/data/steward/ingest";
import { correctionToDraft, outcomeToDraft, patternKeyForSignal } from "@/data/steward/learning";
import type { CorrectionDraft, MemoryDraft } from "@/domain/steward-memory";
import { stewardService } from "@/data/supabase/steward-service";

import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Steward · Conversation review · Trust Tai OS";
const DESCRIPTION =
  "Review what was said, confirm the promises that were really made, and give each one an owner.";

export const Route = createFileRoute("/modules/steward/meetings/$conversationId")({
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
  component: ConversationRoute,
});

function ConversationRoute() {
  return (
    <WorkspaceGate appId="steward">
      {(identity) => (
        <AppShell identity={identity}>
          <ConversationReview identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function ConversationReview({ identity }: { identity: WorkspaceIdentity }) {
  const { conversationId } = useParams({ from: "/modules/steward/meetings/$conversationId" });
  const queryClient = useQueryClient();

  const conversation = useQuery({
    queryKey: ["steward", "conversation", conversationId],
    queryFn: () => stewardService.conversation(conversationId),
  });

  const commitments = useQuery({
    queryKey: ["steward", "commitments", identity.organizationId],
    queryFn: () => stewardService.commitments(identity.organizationId),
  });

  const savedReading = useQuery({
    queryKey: [
      "steward",
      "meeting-processes",
      identity.organizationId,
      identity.userId,
      conversationId,
      conversation.data,
    ],
    enabled: !!conversation.data,
    queryFn: () => readMeetingProcesses(identity.organizationId, [conversation.data!]),
  });
  /* Interpretation is deliberate: a person asks for it, it never runs on open. */
  const interpretation = useQuery({
    queryKey: [
      "steward",
      "interpretation",
      identity.organizationId,
      identity.userId,
      conversationId,
      conversation.data?.conversation,
    ],
    enabled: false,
    retry: false,
    staleTime: Infinity,
    queryFn: async () => {
      const result = await interpretConversation({
        organizationId: identity.organizationId,
        conversationId,
        conversation: conversation.data!.conversation,
      });
      await queryClient.invalidateQueries({
        queryKey: ["steward", "meeting-processes", identity.organizationId],
      });
      return result;
    },
  });

  const comparison = useMutation({
    mutationFn: () =>
      interpretConversation({
        organizationId: identity.organizationId,
        conversationId,
        conversation: conversation.data!.conversation,
        previewOnly: true,
      }),
  });

  const confirm = useMutation({
    mutationFn: (input: ConfirmInput) =>
      stewardService.confirm({
        organizationId: identity.organizationId,
        userId: identity.userId,
        conversationId,
        proposal: input.proposal,
        ...(input.distinctObligationReason
          ? { distinctObligationReason: input.distinctObligationReason }
          : {}),
        ownerName: input.ownerName,
        dueAt: input.dueAt,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["steward", "commitments", identity.organizationId],
      });
    },
  });

  /**
   * A correction is a gift of context. It is written before the confirmation
   * lands, as decided truth attributed to the person who taught it, and it
   * never overwrites what Steward previously believed.
   */
  const learn = useMutation({
    mutationFn: (corrections: CorrectionDraft[]) =>
      stewardService.remember({
        organizationId: identity.organizationId,
        userId: identity.userId,
        userName: identity.name,
        drafts: corrections.map((correction) =>
          correctionToDraft({ ...correction, conversationId }),
        ),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["steward", "memory", identity.organizationId],
      });
    },
  });

  /**
   * Explicit feedback, on the record.
   *
   * Confirming, dismissing as context, or settling a disagreement are all
   * written to the same append-only ledger, attributed and dated, so a person
   * can see their decision landed rather than trusting that it did.
   */
  const record_outcome = useMutation({
    mutationFn: (draft: MemoryDraft) =>
      stewardService.remember({
        organizationId: identity.organizationId,
        userId: identity.userId,
        userName: identity.name,
        drafts: [draft],
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["steward", "memory", identity.organizationId],
      });
    },
  });

  if (conversation.isError) return <StewardUnavailable error={conversation.error} />;
  if (conversation.isLoading || !conversation.data) {
    return <p className="text-sm text-muted-foreground">Opening the conversation…</p>;
  }

  const reading = interpretation.data ?? savedReading.data?.get(conversationId)?.result;
  const record = conversation.data;
  const proposals = extractProposals(record.conversation);
  const confirmedKeys = new Set(
    (commitments.data ?? [])
      .filter((commitment) => commitment.conversationId === record.id)
      .map((commitment) => commitment.sourceKey),
  );
  const names = Array.from(
    new Set([
      ...record.conversation.participants.map((person) => person.name),
      ...record.conversation.segments.map((segment) => segment.speaker),
    ]),
  );

  return (
    <div className="space-y-8">
      <AppHero
        appId="steward"
        eyebrow="Steward · Conversation"
        title={record.title}
        supporting={`${record.occurredAt.slice(0, 10)} · ${record.participants
          .map((person) => person.name)
          .join(", ")}`}
        action={
          <TTButton asChild variant="secondary">
            <Link to="/modules/steward/meetings">Back to meetings</Link>
          </TTButton>
        }
      />

      <StewardTabs active="meetings" />

      {savedReading.isError ? (
        <p role="alert">
          Saved reasoning could not be read. Retry before treating this meeting as unprocessed.
        </p>
      ) : null}
      {confirm.isError ? (
        <p role="alert" className="text-destructive">
          {confirm.error.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <MetaPill>{record.provider}</MetaPill>
        <MetaPill>{proposals.length} passages heard</MetaPill>
        <MetaPill>{confirmedKeys.size} confirmed</MetaPill>
      </div>

      {reading ? (
        <section className="tt-surface p-4 text-sm">
          <TTButton
            type="button"
            variant="secondary"
            disabled={
              comparison.isPending ||
              !identity.apps.some((app) => app.appId === "steward" && app.canWork)
            }
            onClick={() => comparison.mutate()}
          >
            {comparison.isPending
              ? "Reading the full transcript…"
              : "Compare a fresh model reading"}
          </TTButton>
          <p className="mt-2 text-muted-foreground">
            A comparison keeps the saved review and tasks unchanged.
          </p>
          {comparison.isError ? (
            <p role="alert" className="mt-2 text-destructive">
              {comparison.error.message}
            </p>
          ) : null}
          {comparison.data ? (
            <details open className="mt-4">
              <summary className="cursor-pointer font-medium">Unsaved model comparison</summary>
              <SemanticReview
                run={comparison.data.run}
                names={names}
                confirmedKeys={confirmedKeys}
                readOnlyBecause="Comparison only. Reconcile against the saved review below before accepting changes."
              />
            </details>
          ) : null}
        </section>
      ) : null}
      {reading ? (
        <SemanticReview
          run={reading.run}
          names={names}
          confirmedKeys={confirmedKeys}
          stateChanges={reading.stateChanges}
          conflicts={reading.conflicts}
          memoryUsed={reading.memoryUsed}
          memoryConsidered={reading.memoryConsidered}
          suppressedCount={reading.suppressedCount}
          onConfirm={async (input) => {
            await confirm.mutateAsync(input);
          }}
          readOnlyBecause={
            !identity.apps.some((app) => app.appId === "steward" && app.canWork)
              ? "Your access permits review only."
              : !reading.run.memory.available
                ? "Existing work could not be fully reconciled. Resolve that read before creating a task."
                : undefined
          }
          onCorrect={async (corrections) => {
            await learn.mutateAsync(corrections);
          }}
          onDismiss={(signal) =>
            record_outcome.mutate(
              outcomeToDraft({
                outcome: "dismissed_as_context",
                subjectKey: signal.ownerName
                  ? signal.ownerName.trim().toLowerCase()
                  : "this conversation",
                subjectLabel: signal.ownerName?.trim() || record.title,
                about: signal.normalizedMeaning,
                patternKey: patternKeyForSignal(signal),
                ...(signal.ownerName ? { personName: signal.ownerName } : {}),
                conversationId,
                candidateId: signal.candidateId,
              }),
            )
          }
          onResolveConflict={(conflict, keep) =>
            record_outcome.mutate(
              outcomeToDraft({
                /* Keeping memory confirms it; choosing the transcript corrects it. */
                outcome: keep === "memory" ? "belief_confirmed" : "belief_corrected",
                subjectKey: conflict.subjectKey ?? "this conversation",
                subjectLabel: conflict.subjectLabel ?? record.title,
                about:
                  keep === "memory"
                    ? conflict.memorySays
                    : (conflict.transcriptStatement ?? conflict.transcriptSays),
                ...(conflict.patternKey ? { patternKey: conflict.patternKey } : {}),
                conversationId,
                note:
                  keep === "memory"
                    ? "Memory is still right; this conversation was read differently."
                    : "This conversation is right; memory was out of date.",
              }),
            )
          }
        />
      ) : (
        <>
          <p className="tt-surface p-5 text-sm text-muted-foreground">
            {interpretation.isFetching
              ? "Steward is reading every stored transcript turn, then reconciling deliverables, decisions, owners, timelines and dependencies. Nothing is confirmed automatically."
              : interpretation.isError
                ? `Interpretation is unavailable, so Steward is showing only the raw passages its rules found. Nothing below has been read for meaning. ${
                    interpretation.error instanceof Error ? interpretation.error.message : ""
                  }`
                : "Steward has not interpreted this conversation yet. Below are the raw passages its rules found, not yet read for meaning."}
          </p>
          <div>
            <TTButton
              type="button"
              disabled={
                interpretation.isFetching ||
                savedReading.isPending ||
                savedReading.isError ||
                !identity.apps.some((app) => app.appId === "steward" && app.canWork)
              }
              onClick={() => void interpretation.refetch()}
            >
              {interpretation.isFetching ? "Reading…" : "Extract meeting deliverables"}
            </TTButton>
          </div>
          <ProposalReview
            conversation={record.conversation}
            proposals={proposals}
            confirmedKeys={confirmedKeys}
            readOnlyBecause="Steward will not turn an uninterpreted passage into a commitment. Read the conversation for meaning first."
          />
        </>
      )}
    </div>
  );
}
