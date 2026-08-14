/**
 * Steward — Memory.
 *
 * What Steward believes, where each belief came from, and every correction a
 * person has made. Grouped so a person can see the shape of what Steward
 * understands: the people, what they recurringly carry, how work passes
 * between them, and what a human being has put right.
 *
 * Progressive disclosure: groups collapse, each belief reads as one calm
 * sentence, and the evidence behind it opens only when a person asks for it.
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

/** Order of the shelves, and the one line that says what each shelf holds. */
const GROUPS: { kind: MemoryKind; blurb: string }[] = [
  {
    kind: "person",
    blurb: "Who someone is at work — their title, their pod, the context they operate in.",
  },
  {
    kind: "responsibility",
    blurb: "What a person recurringly carries, seen enough times to be worth remembering.",
  },
  {
    kind: "handoff",
    blurb: "How work passes between two people, and who waits on whom.",
  },
  {
    kind: "project",
    blurb: "Context about the work itself, so a reading lands in the right place.",
  },
  {
    kind: "correction",
    blurb: "What a person put right. These outrank anything Steward worked out on its own.",
  },
];

function Disclosure({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden
      className="font-mono text-[10px] text-muted-foreground transition-transform"
      style={{ transform: open ? "rotate(90deg)" : "none", display: "inline-block" }}
    >
      ▸
    </span>
  );
}

function BeliefRow({
  belief,
  onRetire,
  onConfirm,
  onEdit,
  busy,
}: {
  belief: MemoryBelief;
  onRetire?: (because: string) => void;
  onConfirm?: () => void;
  onEdit?: (statement: string) => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(belief.statement);

  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start gap-3 px-1 py-4 text-left hover:bg-muted/40"
      >
        <span className="mt-1">
          <Disclosure open={open} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block max-w-reading text-[15px] text-foreground">
            {belief.statement}
          </span>
          <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {belief.subjectLabel} · {MEMORY_FACET_LABEL[belief.meta.facet]} ·{" "}
            {belief.authority === "human" ? "Taught by a person" : "Read from evidence"}
          </span>
        </span>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {belief.evidence.length > 0 ? `Why · ${belief.evidence.length}` : "Why"}
        </span>
      </button>

      {open ? (
        <div className="pb-5 pl-7 pr-1">
          <div className="flex flex-wrap items-center gap-2">
            <MetaPill>{TRUTH_TIER_LABEL[belief.tier]}</MetaPill>
            <MetaPill>{MEMORY_FACET_LABEL[belief.meta.facet]}</MetaPill>
            {belief.meta.retired ? <MetaPill>No longer consulted</MetaPill> : null}
          </div>

          {belief.meta.original && belief.meta.corrected ? (
            <p className="mt-3 max-w-reading text-[13px] text-muted-foreground">
              Steward had “{belief.meta.original || "nothing"}”. You said “{belief.meta.corrected}”.
            </p>
          ) : null}

          {belief.meta.sourceConversationIds && belief.meta.sourceConversationIds.length > 0 ? (
            <p className="mt-2 text-[13px] text-muted-foreground">
              Held after {belief.meta.sourceConversationIds.length} separate conversations said the
              same thing.
            </p>
          ) : null}

          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {belief.recordedBy} · {belief.recordedAt.slice(0, 10)}
          </p>

          {belief.evidence.length > 0 ? (
            <>
              <p className="mt-4 tt-eyebrow">What this rests on</p>
              <ul className="mt-2 space-y-1">
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
            </>
          ) : (
            <p className="mt-4 text-[13px] text-muted-foreground">
              No source page or conversation is attached to this belief.
            </p>
          )}

          {/*
            Explicit feedback. Confirming something Steward only inferred turns
            it into a person's word; editing records both the old sentence and
            the new one. Nothing is overwritten either way.
          */}
          {editing ? (
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="tt-eyebrow">Say it in your own words</span>
                <TTInput
                  className="mt-2"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <TTButton
                  type="button"
                  disabled={busy || draft.trim().length === 0}
                  onClick={() => {
                    setEditing(false);
                    onEdit?.(draft.trim());
                  }}
                >
                  {busy ? "Recording…" : "Save & confirm"}
                </TTButton>
                <TTButton
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setDraft(belief.statement);
                    setEditing(false);
                  }}
                >
                  Cancel
                </TTButton>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {onConfirm && belief.tier !== "decided" ? (
                <TTButton type="button" variant="secondary" disabled={busy} onClick={onConfirm}>
                  Confirm as true
                </TTButton>
              ) : null}
              {onEdit ? (
                <TTButton
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setEditing(true)}
                >
                  Edit &amp; confirm
                </TTButton>
              ) : null}
            </div>
          )}

          {onRetire ? (
            asking ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
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
        </div>
      ) : null}
    </li>
  );
}

function MemoryGroup({
  kind,
  blurb,
  beliefs,
  defaultOpen,
  onRetire,
  onConfirm,
  onEdit,
  busy,
}: {
  kind: MemoryKind;
  blurb: string;
  beliefs: MemoryBelief[];
  defaultOpen: boolean;
  onRetire: (belief: MemoryBelief, because: string) => void;
  onConfirm: (belief: MemoryBelief) => void;
  onEdit: (belief: MemoryBelief, statement: string) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="tt-surface px-6 py-5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 text-left"
      >
        <Disclosure open={open} />
        <span className="flex-1">
          <span className="tt-eyebrow block">
            {MEMORY_KIND_LABEL[kind]} · {beliefs.length}
          </span>
          <span className="mt-1 block max-w-reading text-[13px] text-muted-foreground">{blurb}</span>
        </span>
      </button>

      {open ? (
        <ul className="mt-4 border-t border-border">
          {beliefs.map((belief) => (
            <BeliefRow
              key={belief.id}
              belief={belief}
              busy={busy}
              onRetire={(because) => onRetire(belief, because)}
              onConfirm={() => onConfirm(belief)}
              onEdit={(statement) => onEdit(belief, statement)}
            />
          ))}
        </ul>
      ) : null}
    </section>
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

  const groups = GROUPS.map((group) => ({
    ...group,
    beliefs: rows.filter((belief) => belief.meta.kind === group.kind),
  })).filter((group) => group.beliefs.length > 0);

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
              <h3 className="tt-eyebrow">Steward has noticed a pattern · {noticed.length}</h3>
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
            <div className="space-y-4">
              {groups.map((group, index) => (
                <MemoryGroup
                  key={group.kind}
                  kind={group.kind}
                  blurb={group.blurb}
                  beliefs={group.beliefs}
                  defaultOpen={index === 0}
                  busy={retire.isPending || remember.isPending}
                  onRetire={(belief, because) => retire.mutate({ belief, because })}
                  onConfirm={(belief) => remember.mutate(endorseBeliefDraft(belief))}
                  onEdit={(belief, statement) =>
                    remember.mutate(editBeliefDraft(belief, statement))
                  }
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
