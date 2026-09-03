import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, MessagesSquare, ScrollText, SquareStack } from "lucide-react";

import { AppShell } from "@/components/tt/app-shell";
import { ContinueSection, type ContinueItem } from "@/components/tt/home/continue-section";
import { GuidanceCard } from "@/components/tt/home/guidance-card";
import { HomeHero } from "@/components/tt/home/home-hero";
import { SuiteRoomsGrid } from "@/components/tt/home/suite-rooms-grid";
import { TodaySummary, type TodayItem } from "@/components/tt/home/today-summary";
import { memorySource } from "@/data/memory-source";
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

  const todayItems = useMemo<TodayItem[]>(() => {
    const items: TodayItem[] = [];
    const openDecisions = (data?.decisions ?? []).filter((d) => d.status === "open").length;
    if (openDecisions > 0) {
      items.push({
        key: "decisions",
        count: openDecisions,
        label: openDecisions === 1 ? "decision waiting on you" : "decisions waiting on you",
        icon: ScrollText,
        slug: "conductor",
      });
    }

    const activeProjects = (data?.projects ?? []).filter(
      (p) => p.status === "in_build" || p.status === "live",
    ).length;
    if (activeProjects > 0) {
      items.push({
        key: "projects",
        count: activeProjects,
        label: activeProjects === 1 ? "project in motion" : "projects in motion",
        icon: SquareStack,
        slug: "projects",
      });
    }

    const conversationSignals = (data?.activity ?? []).filter(
      (event) => event.provenance.appId === "comms",
    ).length;
    if (conversationSignals > 0) {
      items.push({
        key: "comms",
        count: conversationSignals,
        label:
          conversationSignals === 1
            ? "conversation moved recently"
            : "conversations moved recently",
        icon: MessagesSquare,
        slug: "comms",
      });
    }

    return items.slice(0, 3);
  }, [data]);

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

      <TodaySummary items={todayItems} />

      <SuiteRoomsGrid />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <ContinueSection items={continueItems} />
        <GuidanceCard />
      </div>
    </div>
  );
}
