/**
 * Steward — Memory.
 *
 * What Steward believes, where each belief came from, and every correction a
 * person has made. Grouped so a person can see the shape of what Steward
 * understands: the people, what they recurringly carry, how work passes
 * between them, and what a human being has put right.
 *
 * Corrections supersede; nothing is ever deleted. A belief can be retired,
 * which stops Steward consulting it and leaves the history intact.
 */

import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppHero } from "@/components/tt/app-hero";
import { AppShell } from "@/components/tt/app-shell";
import { EmptyState, MetaPill, TTButton } from "@/components/tt/primitives";
import { StewardTabs } from "@/components/tt/steward/steward-tabs";
import { StewardUnavailable } from "@/components/tt/steward/unavailable";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { accumulatePatterns, observationsFromCommitments } from "@/data/steward/learning";
import { stewardService } from "@/data/supabase/steward-service";
import { TRUTH_TIER_LABEL } from "@/domain/signals";
import {
  MEMORY_FACET_LABEL,
  MEMORY_KIND_LABEL,
  RECURRING_PATTERN_THRESHOLD,
  type MemoryBelief,
  type MemoryDraft,
  type MemoryKind,
} from "@/domain/steward-memory";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Steward — Memory — Trust Tai OS";
const DESCRIPTION =
  "What Steward believes about Trust Tai, what each belief rests on, and every human correction on the record.";

export const Route = createFileRoute("/modules/steward/memory")({
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
  component: MemoryRoute,
});

function MemoryRoute() {
  return (
    <WorkspaceGate>
      {(identity) => (
        <AppShell identity={identity}>
          <Memory identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

const GROUP_ORDER: MemoryKind[] = [
  "correction",
  "responsibility",
  "handoff",
  "person",
  "project",
];

function BeliefCard({
  belief,
  onRetire,
  busy,
}: {
  belief: MemoryBelief;
  onRetire?: (because: string) => void;
  busy?: boolean;
}) {
  const [asking, setAsking] = useState(false);

  return (
    <li className="tt-surface p-6">
      <div className="flex flex-wrap items-center gap-2">
        <MetaPill>{TRUTH_TIER_LABEL[belief.tier]}</MetaPill>
        <MetaPill>
          {belief.authority === "human" ? "Taught by a person" : "Read from evidence"}
        </MetaPill>
        <MetaPill>{MEMORY_FACET_LABEL[belief.meta.facet]}</MetaPill>
        <MetaPill>{belief.subjectLabel}</MetaPill>
      </div>

      <p className="mt-3 max-w-reading text-[15px] text-foreground">{belief.statement}</p>

      {belief.meta.original && belief.meta.corrected ? (
        <p className="mt-2 text-[13px] text-muted-foreground">
          Steward had “{belief.meta.original || "nothing"}”. You said “{belief.meta.corrected}”.
        </p>
      ) : null}

      {belief.meta.sourceConversationIds && belief.meta.sourceConversationIds.length > 0 ? (
        <p className="mt-2 text-[13px] text-muted-foreground">
          Held after {belief.meta.sourceConversationIds.length} separate conversations said the same
          thing.
        </p>
      ) : null}

      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {belief.recordedBy} · {belief.recordedAt.slice(0, 10)}
      </p>

      {belief.evidence.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-border pt-3">
          {belief.evidence.map((item, index) => (
            <li key={index} className="text-[13px] text-muted-foreground">
              {item.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  {item.label}
                </a>
              ) : (
                item.label
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {onRetire ? (
        asking ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <p className="text-[13px] text-muted-foreground">
              Steward will stop using this. It stays on the record.
            </p>
            <TTButton
              type="button"
              disabled={busy}
              onClick={() => onRetire("It no longer reflects how the work runs.")}
            >
              {busy ? "Recording…" : "Yes, stop using it"}
            </TTButton>
            <TTButton type="button" variant="secondary" onClick={() => setAsking(false)}>
              Keep it
            </TTButton>
          </div>
        ) : (
          <button
            type="button"
            className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => setAsking(true)}
          >
            This is no longer true →
          </button>
        )
      ) : null}
    </li>
  );
}

function Memory({ identity }: { identity: WorkspaceIdentity }) {
  const queryClient = useQueryClient();

  const memory = useQuery({
    queryKey: ["steward", "memory", identity.organizationId],
    queryFn: () => stewardService.memory(identity.organizationId),
  });

  const commitments = useQuery({
    queryKey: ["steward", "commitments", identity.organizationId],
    queryFn: () => stewardService.commitments(identity.organizationId),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["steward", "memory", identity.organizationId],
    });
  };

  const remember = useMutation({
    mutationFn: (draft: MemoryDraft) =>
      stewardService.rememberOne({
        organizationId: identity.organizationId,
        userId: identity.userId,
        userName: identity.name,
        draft,
      }),
    onSuccess: invalidate,
  });

  const retire = useMutation({
    mutationFn: (input: { belief: MemoryBelief; because: string }) =>
      stewardService.retireBelief({
        organizationId: identity.organizationId,
        userId: identity.userId,
        userName: identity.name,
        belief: input.belief,
        because: input.because,
      }),
    onSuccess: invalidate,
  });

  const rows = memory.data ?? [];

  /* Repeated evidence, counted from confirmed truth only. Never auto-written. */
  const noticed = accumulatePatterns({
    observations: observationsFromCommitments({ commitments: commitments.data ?? [] }),
    existing: rows,
  });

  return (
    <div className="space-y-8">
      <AppHero
        appId="steward"
        eyebrow="Steward · Memory"
        title="What Steward believes, and why."
        supporting="A human correction always outranks a source. The original stays on the record so the change is visible. Steward remembers how work moves between people — never a judgement about anyone."
      />

      <StewardTabs active="memory" />

      {memory.isError ? (
        <StewardUnavailable error={memory.error} />
      ) : memory.isLoading ? (
        <p className="text-sm text-muted-foreground">Reading the record…</p>
      ) : (
        <>
          {noticed.length > 0 ? (
            <section>
              <h3 className="tt-eyebrow">
                Steward has noticed a pattern · {noticed.length}
              </h3>
              <p className="mt-2 max-w-reading text-[13px] text-muted-foreground">
                Each of these turned up in at least {RECURRING_PATTERN_THRESHOLD} separate
                conversations. Steward will not hold any of them as memory until you say it is
                right.
              </p>
              <ul className="mt-3 space-y-3">
                {noticed.map((draft) => (
                  <li key={draft.meta.patternKey} className="tt-surface p-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <MetaPill>Not remembered yet</MetaPill>
                      <MetaPill>{MEMORY_FACET_LABEL[draft.meta.facet]}</MetaPill>
                      <MetaPill>
                        {draft.meta.sourceConversationIds?.length ?? 0} conversations
                      </MetaPill>
                    </div>
                    <p className="mt-3 max-w-reading text-[15px] text-foreground">
                      {draft.statement}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3 border-t border-border pt-4">
                      <TTButton
                        type="button"
                        disabled={remember.isPending}
                        onClick={() => remember.mutate(draft)}
                      >
                        {remember.isPending ? "Remembering…" : "Yes, remember this"}
                      </TTButton>
                      <TTButton
                        type="button"
                        variant="secondary"
                        disabled={remember.isPending}
                        onClick={() =>
                          remember.mutate({
                            ...draft,
                            statement: `Not true: ${draft.statement}`,
                            tier: "decided",
                            authority: "human",
                            meta: { ...draft.meta, kind: "correction", retired: true },
                          })
                        }
                      >
                        No, and stop suggesting it
                      </TTButton>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {rows.length === 0 ? (
            <EmptyState
              title="Steward has not recorded a belief yet."
              belongsHere="Beliefs about people, projects and cadence build up as conversations are read, corrected and confirmed."
              whyItMatters="Memory is what lets Steward recommend a next move without asking you to explain the business again."
            />
          ) : (
            GROUP_ORDER.filter((kind) => rows.some((belief) => belief.meta.kind === kind)).map(
              (kind) => (
                <section key={kind}>
                  <h3 className="tt-eyebrow">
                    {MEMORY_KIND_LABEL[kind]} ·{" "}
                    {rows.filter((belief) => belief.meta.kind === kind).length}
                  </h3>
                  <ul className="mt-3 space-y-3">
                    {rows
                      .filter((belief) => belief.meta.kind === kind)
                      .map((belief) => (
                        <BeliefCard
                          key={belief.id}
                          belief={belief}
                          busy={retire.isPending}
                          onRetire={(because) => retire.mutate({ belief, because })}
                        />
                      ))}
                  </ul>
                </section>
              ),
            )
          )}
        </>
      )}
    </div>
  );
}
