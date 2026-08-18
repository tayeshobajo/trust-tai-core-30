/**
 * Ops, the technical stewardship portfolio.
 *
 * Ops owns its own truth. This room is a synchronized projection of the rows
 * Ops writes into the shared activity stream: what is being maintained, what
 * needs attention, and what moved. Every way into the work is the existing
 * secure handshake, which opens Ops in a new tab and hands the session over in
 * memory. No token ever travels in a URL.
 */

import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/tt/app-shell";
import { OpsPager, OpsSortControl, OpsSystemRow, OpsToolbar } from "@/components/tt/ops/portfolio";
import { MetaPill, SectionHeading, TTButton, TTCard } from "@/components/tt/primitives";
import { RoomHero } from "@/components/tt/room-hero";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import {
  EMPTY_OPS_FILTERS,
  filterOpsSystems,
  opsFreshness,
  opsPortfolio,
  paginateOpsSystems,
  sortOpsSystems,
  type OpsFilters,
  type OpsSortKey,
  type OpsSystem,
} from "@/data/ops/projection";
import { opsPathOf } from "@/data/ops/destination";
import { opsEventsOf } from "@/data/intelligence/derive";
import { loadSuiteSnapshot } from "@/data/intelligence/service";
import { OPS_ORIGIN } from "@/domain/ops";
import { supabase } from "@/integrations/trust-tai/supabase";
import { OPS_LAUNCH_MESSAGE, launchOps, type OpsLaunchFailure } from "@/lib/ops-launch";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Ops · Technical stewardship · Trust Tai OS";
const DESCRIPTION =
  "See the systems Ops is maintaining, what needs attention, and where technical work is moving.";

export const Route = createFileRoute("/modules/ops")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: OpsRoute,
});

function OpsRoute() {
  return (
    <WorkspaceGate appId="ops">
      {(identity) => (
        <AppShell identity={identity}>
          <OpsRoom identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function OpsRoom({ identity }: { identity: WorkspaceIdentity }) {
  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["ops-portfolio", identity.organizationId],
    queryFn: async () => {
      // Two honest sources: the projection Ops pushes, and the shared stream.
      // Neither is fabricated when the other is missing.
      const [snapshot, projection] = await Promise.all([
        loadSuiteSnapshot(identity.organizationId),
        loadOpsProjection(identity.organizationId),
      ]);
      return { events: opsEventsOf(snapshot), projection };
    },
    refetchInterval: 60_000,
  });

  const [filters, setFiltersState] = useState<OpsFilters>(EMPTY_OPS_FILTERS);
  const [sort, setSortState] = useState<OpsSortKey>("attention");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(10);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<OpsLaunchFailure | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  const portfolio = useMemo(
    () => mergeOpsPortfolio(opsPortfolio(data?.events ?? []), data?.projection.rows ?? []),
    [data],
  );
  const lastSyncedAt = useMemo(() => {
    const stamps = (data?.projection.rows ?? []).map((row) => row.lastSyncedAt).sort();
    return stamps.length > 0 ? stamps[stamps.length - 1]! : null;
  }, [data]);
  const connection = opsConnectionState({
    lastSyncedAt,
    projectionReadOk: data?.projection.ok !== false && !isError,
    now: dataUpdatedAt || Date.now(),
  });
  const systems = useMemo(
    () => sortOpsSystems(filterOpsSystems(portfolio.systems, filters), sort),
    [portfolio.systems, filters, sort],
  );
  const pageView = useMemo(
    () => paginateOpsSystems(systems, page, pageSize),
    [systems, page, pageSize],
  );


  // Any change to what is being listed returns to the first page, so the
  // person is never left staring at an empty page that used to have rows.
  function setFilters(next: OpsFilters) {
    setFiltersState(next);
    setPage(1);
  }
  function setSort(next: OpsSortKey) {
    setSortState(next);
    setPage(1);
  }
  function setPageSize(next: number) {
    setPageSizeState(next);
    setPage(1);
  }

  async function open(targetPath?: string, canonicalProjectId?: string) {
    setBusy(true);
    setFailure(null);
    const { data: session } = await supabase.auth.getSession();
    const result = await launchOps({
      accessToken: session.session?.access_token ?? null,
      organizationId: identity.organizationId,
      ...(canonicalProjectId ? { canonicalProjectId } : {}),
      ...(targetPath ? { targetPath } : {}),
      returnContext: "ops-room",
    });
    setBusy(false);
    if (!result.ok) setFailure(result.reason);
  }

  function openSystem(system: OpsSystem) {
    void open(opsPathOf(system.destinationUrl), system.canonicalProjectId);
  }

  const attention = portfolio.attention;
  const lastSuccessAt = dataUpdatedAt ? new Date(dataUpdatedAt) : null;
  const freshness = isError
    ? "Ops sync interrupted"
    : opsFreshness(portfolio.lastEventAt, dataUpdatedAt || Date.now());

  return (
    <div className="space-y-10">
      <RoomHero
        eyebrow="Ops"
        title="Technical stewardship, without losing the thread."
        supporting="See the systems Ops is maintaining, what needs attention, and where work is moving."
        actions={
          <>
            <TTButton disabled={busy} onClick={() => void open()}>
              {busy ? "Opening Ops…" : "Open Ops ↗"}
            </TTButton>
            <TTButton variant="secondary" disabled={busy} onClick={() => void open("/projects/new")}>
              Create in Ops
            </TTButton>
          </>
        }
        metrics={[
          { value: isLoading ? "…" : portfolio.systems.length, label: "Managed systems" },
          { value: isLoading ? "…" : attention.length, label: "Needs attention" },
          {
            value: isLoading
              ? "…"
              : portfolio.systems.reduce((total, system) => total + system.openIssues, 0),
            label: "Open incidents",
          },
          {
            value: isLoading
              ? "…"
              : portfolio.systems.filter((system) => system.health === "healthy").length,
            label: "Healthy",
          },
        ]}
        footer={
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {freshness}
            </span>
            {failure ? (
              <span role="alert" className="text-[13px] text-destructive">
                {OPS_LAUNCH_MESSAGE[failure]}
              </span>
            ) : null}
          </div>
        }
      />

      {isError ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 p-4"
        >
          <p className="text-[15px] text-destructive">Ops sync interrupted</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {lastSuccessAt
              ? `Trust Tai OS could not read the Ops stream just now. The last successful sync was ${lastSuccessAt.toLocaleString()}, so everything below is that snapshot and may have moved on in Ops.`
              : "Trust Tai OS has not completed a single successful read of the Ops stream in this session, so nothing below can be trusted as current."}
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Retrying re-reads the shared activity stream. It does not change anything in Ops, and
            Ops itself may still be running normally while this connection is down.
          </p>
          <TTButton
            className="mt-3"
            variant="secondary"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            {isFetching ? "Retrying…" : "Retry sync"}
          </TTButton>
        </div>
      ) : null}

      <section>
        <SectionHeading
          eyebrow="Needs attention"
          title="What Ops is waiting on"
          description="Issues, approvals and QA results Ops recorded and nothing has cleared."
        />
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Reading the Ops stream.</p>
        ) : attention.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card/60 px-4 py-3 text-sm text-muted-foreground">
            Everything currently managed in Ops is healthy.
          </p>
        ) : (
          <div className="space-y-3">
            {attention.map((item) => (
              <TTCard key={item.key} className="p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <MetaPill>{item.kind.replace("ops.", "").replace(/_/g, " ")}</MetaPill>
                  <MetaPill>{item.systemName}</MetaPill>
                  <MetaPill>{new Date(item.at).toLocaleDateString()}</MetaPill>
                </div>
                <p className="mt-2 text-sm text-foreground">{item.summary}</p>
                <TTButton
                  className="mt-3"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void open(opsPathOf(item.destinationUrl))}
                >
                  Open in Ops ↗
                </TTButton>
              </TTCard>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeading
          eyebrow="Portfolio"
          title="Managed systems"
          description="Grouped from the canonical work Ops reports. Trust Tai OS never edits Ops truth."
        />
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[260px] flex-1">
              <OpsToolbar
                filters={filters}
                onFiltersChange={setFilters}
                companies={portfolio.companies}
                environments={portfolio.environments}
              />
            </div>
            <OpsSortControl value={sort} onChange={setSort} />
          </div>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Reading the Ops stream.</p>
          ) : systems.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border bg-card/60 px-4 py-3 text-sm text-muted-foreground">
              {portfolio.systems.length === 0
                ? "No Ops systems have reported into Trust Tai OS yet. Anything Ops records will appear here."
                : "No system matches these filters."}
            </p>
          ) : (
            <div className="space-y-3">
              {pageView.items.map((system) => (
                <OpsSystemRow key={system.key} system={system} onOpen={openSystem} busy={busy} />
              ))}
              <OpsPager page={pageView} onPageChange={setPage} onPageSizeChange={setPageSize} />
            </div>
          )}
        </div>
      </section>

      <section>
        <SectionHeading
          eyebrow="Recently moved"
          title="What changed in Ops"
          description="The latest rows Ops wrote for your organization."
        />
        {portfolio.recentlyMoved.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card/60 px-4 py-3 text-sm text-muted-foreground">
            Nothing has moved in Ops yet.
          </p>
        ) : (
          <ol className="space-y-2">
            {portfolio.recentlyMoved.map((event) => (
              <li
                key={event.idempotencyKey}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
              >
                <span className="min-w-0">
                  <span className="block text-sm text-foreground">{event.summary}</span>
                  <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    {event.name.replace("ops.", "").replace(/_/g, " ")} ·{" "}
                    {new Date(event.at).toLocaleString()}
                  </span>
                </span>
                <TTButton
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void open(opsPathOf(event.destinationUrl))}
                >
                  Open in Ops ↗
                </TTButton>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <button
          type="button"
          onClick={() => setAboutOpen((open) => !open)}
          aria-expanded={aboutOpen}
          className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground underline underline-offset-4"
        >
          About this connection
        </button>
        {aboutOpen ? (
          <p className="mt-3 max-w-reading text-[13px] text-muted-foreground">
            Ops runs at {OPS_ORIGIN}. Opening it hands your session over in memory once Ops answers
            the handshake, never in a link, and only the target path travels with it. Connection
            settings live in{" "}
            <Link to="/settings/integrations" className="underline underline-offset-4">
              Settings, Integrations
            </Link>
            .
          </p>
        ) : null}
      </section>
    </div>
  );
}
