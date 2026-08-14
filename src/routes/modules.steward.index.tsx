/**
 * Steward — Today.
 *
 * One question: what did you promise, and what needs you now. The list is
 * derived from real commitment state, ordered by urgency, and every line can
 * say why it is there. When there is nothing, it says so plainly.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppHero } from "@/components/tt/app-hero";
import { AppShell } from "@/components/tt/app-shell";
import { StewardTabs } from "@/components/tt/steward/steward-tabs";
import { StewardUnavailable } from "@/components/tt/steward/unavailable";
import { EmptyState, MetaPill, TTButton } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { buildToday } from "@/data/steward/today";
import { stewardService } from "@/data/supabase/steward-service";
import { MOVE_STATE_LABEL, type CommitmentStatus, type TodayMove } from "@/domain/steward";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Steward — Today — Trust Tai OS";
const DESCRIPTION =
  "What you promised, what needs you now, and who carries the rest. Derived from real conversations, confirmed by people.";

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

function MoveRow({
  move,
  onStatus,
}: {
  move: TodayMove;
  onStatus: (id: string, status: CommitmentStatus) => void;
}) {
  return (
    <li className="tt-surface p-6">
      <div className="flex flex-wrap items-center gap-2">
        <MetaPill>{MOVE_STATE_LABEL[move.state]}</MetaPill>
        <MetaPill>Carried by {move.ownerName}</MetaPill>
        <MetaPill>{move.sourceLabel}</MetaPill>
      </div>
      <p className="mt-3 max-w-reading text-[15px] text-foreground">{move.title}</p>
      <p className="mt-2 max-w-reading text-sm text-muted-foreground">{move.why}</p>

      <details className="group mt-3">
        <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground">
          <span className="group-open:hidden">What this rests on →</span>
          <span className="hidden group-open:inline">Hide</span>
        </summary>
        <ul className="mt-2 space-y-1">
          {move.evidence.map((item, index) => (
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
      </details>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
        <TTButton type="button" onClick={() => onStatus(move.id, "kept")}>
          Mark kept
        </TTButton>
        <TTButton type="button" variant="secondary" onClick={() => onStatus(move.id, "waiting")}>
          Waiting on someone
        </TTButton>
        <TTButton type="button" variant="secondary" onClick={() => onStatus(move.id, "released")}>
          Release
        </TTButton>
      </div>
    </li>
  );
}

function StewardToday({ identity }: { identity: WorkspaceIdentity }) {
  const queryClient = useQueryClient();
  const commitments = useQuery({
    queryKey: ["steward", "commitments", identity.organizationId],
    queryFn: () => stewardService.commitments(identity.organizationId),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: CommitmentStatus }) =>
      stewardService.setStatus(id, status),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["steward", "commitments", identity.organizationId] }),
  });

  const now = new Date().toISOString();
  const rows = commitments.data ?? [];
  const mine = buildToday({ commitments: rows, now, viewerKey: identity.email.toLowerCase() });
  const mineOnly = mine.filter((move) => move.urgency >= 100);
  const others = mine.filter((move) => move.urgency < 100);

  return (
    <div className="space-y-8">
      <AppHero
        appId="steward"
        eyebrow="Steward"
        greeting={`Welcome, ${identity.firstName}`}
        title="What you said you would do."
        supporting="Steward turns conversations into commitments, then keeps them visible until they are kept, released, or genuinely waiting on someone else."
        action={
          <TTButton asChild>
            <Link to="/modules/steward/meetings">Read a conversation</Link>
          </TTButton>
        }
      />

      <StewardTabs active="today" />

      {commitments.isError ? (
        <StewardUnavailable error={commitments.error} />
      ) : commitments.isLoading ? (
        <p className="text-sm text-muted-foreground">Reading your commitments…</p>
      ) : mine.length === 0 ? (
        <EmptyState
          title="Nothing is waiting on anyone."
          belongsHere="Confirmed commitments from real conversations live here, ordered by what needs movement first."
          whyItMatters="A promise that is only in a transcript is a promise nobody is carrying."
          action={
            <TTButton asChild>
              <Link to="/modules/steward/meetings">Read a conversation</Link>
            </TTButton>
          }
        />
      ) : (
        <div className="space-y-10">
          <section>
            <h2 className="tt-eyebrow">Needs you · {mineOnly.length}</h2>
            {mineOnly.length > 0 ? (
              <ul className="mt-4 space-y-3">
                {mineOnly.map((move) => (
                  <MoveRow
                    key={move.id}
                    move={move}
                    onStatus={(id, status) => setStatus.mutate({ id, status })}
                  />
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                Nothing here is yours today. That is a real answer.
              </p>
            )}
          </section>

          {others.length > 0 ? (
            <section>
              <h2 className="tt-eyebrow">Carried by others · {others.length}</h2>
              <ul className="mt-4 space-y-3">
                {others.map((move) => (
                  <MoveRow
                    key={move.id}
                    move={move}
                    onStatus={(id, status) => setStatus.mutate({ id, status })}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
