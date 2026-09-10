import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, Gauge, ScrollText, SquareStack } from "lucide-react";

import { AppShell } from "@/components/tt/app-shell";
import { ContinueSection, type ContinueItem } from "@/components/tt/home/continue-section";
import { GuidanceCard } from "@/components/tt/home/guidance-card";
import { HomeHero } from "@/components/tt/home/home-hero";
import { SuiteRoomsGrid } from "@/components/tt/home/suite-rooms-grid";
import { ThisWeek } from "@/components/tt/home/this-week";
import { TodaySummary, type TodayItem } from "@/components/tt/home/today-summary";
import { memorySource } from "@/data/memory-source";
import { readWeeklySnapshot, weeklySnapshotKey } from "@/data/weekly-snapshot";
import { orderToday, type TodayCandidate } from "@/domain/today-ordering";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Trust Tai OS · one operating system for how Trust Tai works";
const DESCRIPTION =
  "Welcome home: one shared foundation for clients, projects, conversations, operations, and intelligence across the Trust Tai suite.";

export const Route = createFileRoute("/")({
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
  component: HomeRoute,
});

function HomeRoute() {
  return (
    <WorkspaceGate appId="home">
      {(identity) => (
        <AppShell identity={identity} sidebar={<SystemStatus identity={identity} />}>
          <Home identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

/** Real state only: the shell can read the workspace, so it says so. */
function SystemStatus({ identity }: { identity: WorkspaceIdentity }) {
  const { isSuccess, isError } = useQuery({
    queryKey: ["home-status", identity.organizationId],
    queryFn: () =>
      memorySource.activity.list({ organizationId: identity.organizationId, limit: 1 }),
  });

  if (!isSuccess && !isError) return null;

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <CircleCheck
          className={isError ? "size-4 text-warning" : "size-4 text-success"}
          aria-hidden
        />
        {isError ? "Workspace unreachable" : "All systems operational"}
      </p>
    </div>
  );
}

function Home({ identity }: { identity: WorkspaceIdentity }) {
  const { organizationId, userId } = identity;

  const { data } = useQuery({
    queryKey: ["home", organizationId, userId],
    queryFn: async () => {
      const [decisions, projects, activity] = await Promise.all([
        memorySource.decisions.list(organizationId),
        memorySource.projects.list(organizationId),
        memorySource.activity.list({ organizationId, limit: 8 }),
      ]);
      return { decisions, projects, activity };
    },
  });

  /**
   * The one canonical weekly snapshot every room reads, composed once by the
   * shared adapter. Home derives nothing of its own from the week, so Home,
   * Clients and any later room cannot disagree about the same seven days.
   */
  const week = useQuery({
    queryKey: weeklySnapshotKey(organizationId),
    queryFn: () => readWeeklySnapshot(organizationId),
  });

  const snapshot = week.data ?? null;

  const todayItems = useMemo<TodayItem[]>(() => {
    /**
     * Today obeys one order (P2-05): an obligation already at risk, then a
     * breached weekly floor, then a decision worth making. Nothing is invented,
     * an absence produces no card at all, and a source that could not be read
     * produces no card either, because unknown is not a breach.
     */
    const candidates: TodayCandidate[] = [];

    const blocked = (data?.projects ?? []).filter((p) => p.status === "blocked").length;
    if (blocked > 0) {
      candidates.push({
        key: "blocked-projects",
        kind: "obligation_at_risk",
        count: blocked,
        label: blocked === 1 ? "promise blocked in delivery" : "promises blocked in delivery",
        slug: "projects",
      });
    }

    if (snapshot) candidates.push(...snapshot.floorCandidates);

    const openDecisions = (data?.decisions ?? []).filter((d) => d.status === "open").length;
    if (openDecisions > 0) {
      candidates.push({
        key: "decisions",
        kind: "decision_opportunity",
        count: openDecisions,
        label: openDecisions === 1 ? "decision waiting on you" : "decisions waiting on you",
        slug: "approvals",
      });
    }

    const icons: Record<string, typeof ScrollText> = {
      "blocked-projects": SquareStack,
      decisions: ScrollText,
    };

    return orderToday(candidates)
      .slice(0, 3)
      .map((entry) => ({
        key: entry.key,
        count: entry.count,
        label: entry.label,
        icon: icons[entry.key] ?? Gauge,
        slug: entry.slug,
      }));
  }, [data, snapshot]);

  const continueItems = useMemo<ContinueItem[]>(
    () =>
      (data?.activity ?? []).slice(0, 4).map((event) => ({
        id: event.id,
        appId: event.provenance.appId,
        title: event.summary,
        meta: event.name,
      })),
    [data],
  );

  return (
    <div className="w-full space-y-16 pb-8">
      <HomeHero firstName={identity.firstName} />

      <TodaySummary
        items={todayItems}
        empty={
          week.isSuccess && data
            ? "Nothing is at risk, no floor is breached and no decision is waiting. Open Clients to pick the next move."
            : undefined
        }
      />

      <ThisWeek
        numbers={snapshot?.numbers ?? []}
        note={snapshot?.note ?? null}
        loading={week.isPending}
      />

      <SuiteRoomsGrid />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <ContinueSection items={continueItems} />
        <GuidanceCard />
      </div>
    </div>
  );
}
