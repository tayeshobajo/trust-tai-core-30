/**
 * Studio · Audience. The trusttai.com newsletter list, read-only.
 * No copy is kept, no consent is changed, nothing is sent from here.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { AppShell } from "@/components/tt/app-shell";
import { RoomHero } from "@/components/tt/room-hero";
import { EmptyState, TTButton, TTCard, TonePill } from "@/components/tt/primitives";
import { StudioNav } from "@/components/tt/studio/studio-nav";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { getStudioAudience } from "@/data/studio-audience.functions";
import {
  AUDIENCE_FAILURE_TEXT,
  describeCount,
  scopeNote,
  type AudienceFilter,
} from "@/domain/studio-audience";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Studio · Audience · Trust Tai OS";
const DESCRIPTION =
  "The trusttai.com newsletter audience, read-only: who signed up, who confirmed and who left, with honest counts.";

export const Route = createFileRoute("/modules/studio/audience")({
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
  component: () => (
    <WorkspaceGate appId="studio">{(identity) => <Audience identity={identity} />}</WorkspaceGate>
  ),
});

const FILTERS: { id: AudienceFilter; label: string }[] = [
  { id: "all", label: "Everyone" },
  { id: "confirmed", label: "Confirmed" },
  { id: "pending", label: "Pending" },
  { id: "unsubscribed", label: "Unsubscribed" },
];

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function Audience({ identity }: { identity: WorkspaceIdentity }) {
  const [filter, setFilter] = useState<AudienceFilter>("all");
  const [page, setPage] = useState(1);
  const read = useServerFn(getStudioAudience);
  const q = useQuery({
    queryKey: ["studio-audience", identity.organizationId, filter, page],
    queryFn: () => read({ data: { organizationId: identity.organizationId, filter, page } }),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 60_000,
  });

  const result = q.data;
  return (
    <AppShell identity={identity}>
      <div className="mb-6">
        <StudioNav current="audience" />
      </div>
      <RoomHero
        eyebrow="Studio"
        title="Who is listening."
        supporting="The trusttai.com newsletter list, read straight from the website. Studio keeps no copy, changes no one's consent and sends nothing."
      />

      {q.isPending ? (
        <TTCard className="mt-6 bg-card" aria-busy="true">
          <p className="text-sm text-muted-foreground">Reading the audience from trusttai.com…</p>
        </TTCard>
      ) : q.isError ? (
        <TTCard className="mt-6 bg-card" role="alert">
          <p className="text-sm font-medium">Studio couldn't reach its own server.</p>
          <p className="mt-1 text-sm text-muted-foreground">This is not an empty list.</p>
          <TTButton className="mt-4" variant="secondary" onClick={() => q.refetch()}>
            Try again
          </TTButton>
        </TTCard>
      ) : result && !result.ok ? (
        <TTCard className="mt-6 bg-card" role="alert">
          <p className="text-sm font-medium">The audience isn't shown.</p>
          <p className="mt-1 text-sm text-muted-foreground">{AUDIENCE_FAILURE_TEXT[result.failure]}</p>
          {result.failure.startsWith("source_") ? (
            <TTButton className="mt-4" variant="secondary" onClick={() => q.refetch()}>
              Try again
            </TTButton>
          ) : null}
        </TTCard>
      ) : result && result.ok ? (
        <>
          <section aria-label="Audience counts" className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["Total", result.feed.counts.total],
                ["Confirmed", result.feed.counts.confirmed],
                ["Pending", result.feed.counts.pending],
                ["Unsubscribed", result.feed.counts.unsubscribed],
              ] as const
            ).map(([label, value]) => (
              <TTCard key={label} className="bg-card p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {describeCount(value, result.feed.scope, result.feed.likelyCapped)}
                </p>
              </TTCard>
            ))}
          </section>
          <p className="mt-2 text-xs text-muted-foreground">
            {filter === "all"
              ? scopeNote(result.feed, result.returned)
              : `Counts reflect the ${FILTERS.find((f) => f.id === filter)?.label.toLowerCase()} view the website returned, not the whole audience.`}{" "}
            Read {when(result.fetchedAt)}.
          </p>

          <TTCard className="mt-6 bg-card p-0">
            <div role="radiogroup" aria-label="Filter by status" className="flex flex-wrap gap-2 border-b border-border p-4">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={filter === f.id}
                  onClick={() => {
                    setFilter(f.id);
                    setPage(1);
                  }}
                  className={`rounded-full border px-3 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    filter === f.id ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {result.matching === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="No one here yet"
                  belongsHere="People who sign up on trusttai.com appear here with their status."
                  whyItMatters="The website answered and this view is genuinely empty."
                />
              </div>
            ) : (
              <ul className="divide-y divide-border" aria-busy={q.isFetching}>
                {result.rows.map((s) => (
                  <li key={`${s.email}-${s.createdAt}`} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{s.email}</p>
                      <p className="text-xs text-muted-foreground">
                        Joined {when(s.createdAt)}
                        {s.confirmedAt ? ` · Confirmed ${when(s.confirmedAt)}` : ""}
                        {s.source ? ` · From ${s.source}` : ""}
                        {s.providerSyncState ? ` · Sync: ${s.providerSyncState}` : ""}
                      </p>
                    </div>
                    <TonePill tone={s.status === "confirmed" ? "good" : s.status === "unsubscribed" ? "neutral" : "caution"}>
                      {s.status === "unknown" ? "Unknown" : s.status[0]!.toUpperCase() + s.status.slice(1)}
                    </TonePill>
                  </li>
                ))}
              </ul>
            )}

            <nav aria-label="Audience pages" className="flex items-center justify-between gap-3 border-t border-border p-4 text-sm">
              <span className="text-muted-foreground">
                Page {result.page} of {result.pageCount} · {result.matching.toLocaleString("en-US")} {result.matching === 1 ? "person" : "people"} in this view
              </span>
              <div className="flex gap-2">
                <TTButton variant="secondary" disabled={result.page <= 1} onClick={() => setPage(result.page - 1)}>
                  Previous
                </TTButton>
                <TTButton variant="secondary" disabled={result.page >= result.pageCount} onClick={() => setPage(result.page + 1)}>
                  Next
                </TTButton>
              </div>
            </nav>
          </TTCard>
        </>
      ) : null}
    </AppShell>
  );
}
