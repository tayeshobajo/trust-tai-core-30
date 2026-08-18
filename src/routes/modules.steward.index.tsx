/**
 * Steward, Today, the Judgment surface.
 *
 * One question, answered plainly: what deserves your attention now? Most days
 * that is one thing, sometimes three, and often nothing at all. Everything
 * else Steward is carrying stays quiet until it earns an interruption.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppHero } from "@/components/tt/app-hero";
import { AppShell } from "@/components/tt/app-shell";
import { AttentionCard } from "@/components/tt/steward/attention-card";
import { StewardTabs } from "@/components/tt/steward/steward-tabs";
import { StewardUnavailable } from "@/components/tt/steward/unavailable";
import { MetaPill, TTButton } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { judge } from "@/data/steward/judgment";
import { outcomeRecordsFromBeliefs, suppressedPatterns } from "@/data/steward/learning";
import { loadSuiteSnapshot } from "@/data/intelligence/service";
import { stewardService } from "@/data/supabase/steward-service";
import { readOpsEvents } from "@/domain/ops";
import type { CommitmentStatus } from "@/domain/steward";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Steward · Today · Trust Tai OS";
const DESCRIPTION =
  "What deserves your attention right now, why it matters today, and nothing else. Read from real conversations, projects and promises.";

export const Route = createFileRoute("/modules/steward/")({
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
  component: StewardTodayRoute,
});

function StewardTodayRoute() {
  return (
    <WorkspaceGate>
      {(identity) => (
        <AppShell identity={identity}>
          <StewardToday identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function StewardToday({ identity }: { identity: WorkspaceIdentity }) {
  const queryClient = useQueryClient();
  const queryKey = ["steward", "judgment", identity.organizationId, identity.userId];

  const judgment = useQuery({
    queryKey,
    queryFn: async () => {
      const [snapshot, memory] = await Promise.all([
        loadSuiteSnapshot(identity.organizationId),
        stewardService.memory(identity.organizationId).catch(() => []),
      ]);
      return judge({
        organizationId: identity.organizationId,
        now: new Date().toISOString(),
        viewer: {
          personKey: identity.email.toLowerCase(),
          name: identity.name,
          userId: identity.userId,
        },
        commitments: snapshot.steward.commitments,
        projects: snapshot.projects,
        relationships: snapshot.relationships,
        opsEvents: readOpsEvents(
          [...snapshot.events, ...snapshot.opsActivities],
          identity.organizationId,
        ),
        memory,
        suppressedPatternKeys: suppressedPatterns(outcomeRecordsFromBeliefs(memory)),
      });
    },
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: CommitmentStatus }) =>
      stewardService.setStatus(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const read = judgment.data;

  return (
    <div className="space-y-8">
      <AppHero
        appId="steward"
        eyebrow="Steward"
        greeting={`Welcome, ${identity.firstName}`}
        title={read ? read.headline : "What deserves you now."}
        supporting="Steward reads your promises, your work and what changed around it, then tells you the smallest number of things that genuinely need you."
        action={
          <TTButton asChild>
            <Link to="/modules/steward/meetings">Read a conversation</Link>
          </TTButton>
        }
      />

      <StewardTabs active="today" />

      {judgment.isError ? (
        <StewardUnavailable error={judgment.error} />
      ) : judgment.isLoading || !read ? (
        <p className="text-sm text-muted-foreground">Reading what changed…</p>
      ) : (
        <div className="space-y-10">
          {read.items.length > 0 ? (
            <section>
              <h2 className="tt-eyebrow">{read.headline}</h2>
              <ul className="mt-4 space-y-3">
                {read.items.map((item) => (
                  <AttentionCard
                    key={item.id}
                    item={item}
                    actions={
                      item.refs.commitmentId ? (
                        <>
                          <TTButton
                            type="button"
                            onClick={() =>
                              setStatus.mutate({ id: item.refs.commitmentId!, status: "kept" })
                            }
                          >
                            Mark kept
                          </TTButton>
                          <TTButton
                            type="button"
                            variant="secondary"
                            onClick={() =>
                              setStatus.mutate({ id: item.refs.commitmentId!, status: "waiting" })
                            }
                          >
                            Waiting on someone
                          </TTButton>
                        </>
                      ) : null
                    }
                  />
                ))}
              </ul>
              {read.deferred > 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  {read.deferred} more could qualify. Steward is holding {read.deferred === 1 ? "it" : "them"} back
                  until these are settled.
                </p>
              ) : null}
            </section>
          ) : (
            <section className="tt-surface p-8">
              <p className="tt-eyebrow">Today</p>
              <h2 className="mt-3 max-w-reading font-display text-2xl text-foreground sm:text-3xl">
                Nothing needs you right now.
              </h2>
              <p className="mt-4 max-w-reading text-sm text-muted-foreground">
                Nothing you carry is overdue, and nobody is held up waiting on you. Steward will
                bring something back the moment that changes.
              </p>
              {read.watching.length > 0 ? (
                <div className="mt-6 space-y-3 border-t border-border pt-6">
                  <p className="tt-eyebrow">What Steward is watching</p>
                  {read.watching.map((note, index) => (
                    <div key={index}>
                      <p className="max-w-reading text-sm text-foreground">{note.label}</p>
                      <p className="max-w-reading text-sm text-muted-foreground">{note.because}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          )}

          {read.items.length > 0 && read.waiting.length > 0 ? (
            <section>
              <h2 className="tt-eyebrow">Waiting, correctly</h2>
              <p className="mt-2 max-w-reading text-sm text-muted-foreground">
                These are moving through someone else. Nothing to chase.
              </p>
              <ul className="mt-4 space-y-3">
                {read.waiting.map((item) => (
                  <li key={item.id} className="tt-surface p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <MetaPill>Waiting</MetaPill>
                      {item.waitingOn ? <MetaPill>{item.waitingOn.name}</MetaPill> : null}
                    </div>
                    <p className="mt-3 max-w-reading text-sm text-foreground">{item.headline}</p>
                    <p className="mt-1 max-w-reading text-sm text-muted-foreground">{item.whyNow}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
