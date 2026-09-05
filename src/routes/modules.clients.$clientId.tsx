/**
 * One client, the shell every other room hangs off.
 *
 * The page answers, in order: who this company is, what they are on and
 * worth, when they are next reviewed and renew, and then, tab by tab, what
 * each owning room has recorded about them. Nothing on this page is invented:
 * a room that could not be read says so, and a room with nothing recorded
 * says that instead, never dressed as health.
 *
 * Every day here is a day in the organization's own timezone.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { AppShell } from "@/components/tt/app-shell";
import { ClientHeader, ClientTabs } from "@/components/tt/clients/shell";
import {
  FilesTab,
  OverviewTab,
  ProjectsTab,
  RelationshipTab,
  RoadmapTab,
  SiteTab,
} from "@/components/tt/clients/tabs";
import { EmptyState } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { buildClientBook } from "@/data/clients/book-projection";
import {
  eventsAbout,
  readClientApprovals,
  readClientHistory,
  readClientRoadmaps,
} from "@/data/clients/shell-reads";
import {
  listProposals,
  readClientCommercialRecord,
  readOrganizationTimeZoneResolved,
} from "@/data/supabase/commercial-service";
import { commsService } from "@/data/supabase/comms-service";
import { projectsService } from "@/data/supabase/projects-service";
import {
  answered,
  approvalEntityIds,
  approvalsForClient,
  clientHeaderFacts,
  parseClientTab,
  projectsForClient,
  relationshipSnapshotFor,
  reviewCadenceFor,
  roadmapOutcomeFor,
  roadmapsForClient,
  unreadable,
  type ClientTab,
  type RoomRead,
} from "@/domain/client-shell";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Client · Trust Tai OS";
const DESCRIPTION =
  "One company: tier, commercial value, next review, delivery in flight, the people we know there, and what has happened.";

export const Route = createFileRoute("/modules/clients/$clientId")({
  /* Overview is the door; it carries no `tab` so plain client links stay clean. */
  validateSearch: (search: Record<string, unknown>): { tab?: ClientTab } => {
    const tab = parseClientTab(search["tab"]);
    return tab === "overview" ? {} : { tab };
  },
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
  component: ClientRoute,
});

function ClientRoute() {
  const { clientId } = Route.useParams();
  const { tab } = Route.useSearch();
  return (
    <WorkspaceGate appId="clients">
      {(identity) => (
        <ClientShell identity={identity} clientId={clientId} tab={tab ?? "overview"} />
      )}
    </WorkspaceGate>
  );
}

/** Turn a query into a room read: answered, unreadable, or still on its way. */
function readOf<T>(query: { data: T | undefined; isError: boolean; error: unknown }): RoomRead<T> | null {
  if (query.isError) {
    return unreadable(query.error instanceof Error ? query.error.message : "The read failed.");
  }
  return query.data === undefined ? null : answered(query.data);
}

function ClientShell({
  identity,
  clientId,
  tab,
}: {
  identity: WorkspaceIdentity;
  clientId: string;
  tab: ClientTab;
}) {
  const now = useMemo(() => new Date(), []);
  const organizationId = identity.organizationId;

  const zoneQuery = useQuery({
    queryKey: ["organization", "timezone", organizationId],
    queryFn: () => readOrganizationTimeZoneResolved(organizationId),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const timeZone = zoneQuery.data?.timeZone ?? null;

  const clientQuery = useQuery({
    queryKey: ["clients", "record", organizationId, clientId],
    queryFn: () => readClientCommercialRecord(clientId, organizationId),
    retry: false,
  });
  const proposalsQuery = useQuery({
    queryKey: ["clients", "proposals", organizationId],
    queryFn: () => listProposals(organizationId),
    retry: false,
  });
  const projectsQuery = useQuery({
    queryKey: ["clients", "projects", organizationId],
    queryFn: () => projectsService.list(organizationId),
    retry: false,
  });
  const roadmapsQuery = useQuery({
    queryKey: ["clients", "roadmaps", organizationId],
    queryFn: () => readClientRoadmaps(organizationId),
    retry: false,
  });
  const relationshipsQuery = useQuery({
    queryKey: ["clients", "relationships", organizationId],
    queryFn: () => commsService.list(organizationId),
    retry: false,
  });
  const historyQuery = useQuery({
    queryKey: ["clients", "history", organizationId],
    queryFn: () => readClientHistory(organizationId),
    retry: false,
  });

  const record = clientQuery.data ?? null;

  /* Canonical ids this company is known by across rooms. */
  const roadmaps = useMemo(
    () => roadmapsForClient(roadmapsQuery.data?.roadmaps ?? [], clientId),
    [roadmapsQuery.data, clientId],
  );
  const projects = useMemo(
    () => projectsForClient(projectsQuery.data ?? [], clientId),
    [projectsQuery.data, clientId],
  );
  const relationshipIds = useMemo(
    () =>
      (relationshipsQuery.data ?? [])
        .filter((relationship) => relationship.clientId === clientId)
        .map((relationship) => relationship.id),
    [relationshipsQuery.data, clientId],
  );
  const links = useMemo(
    () => ({
      clientId,
      roadmapIds: roadmaps.map((roadmap) => roadmap.id),
      projectIds: projects.map((project) => project.id),
      relationshipIds,
    }),
    [clientId, roadmaps, projects, relationshipIds],
  );
  const entityIds = useMemo(() => approvalEntityIds(links), [links]);

  /* Approvals are asked only once the ids they could be filed under are known. */
  const linksSettled =
    (roadmapsQuery.isSuccess || roadmapsQuery.isError) &&
    (projectsQuery.isSuccess || projectsQuery.isError) &&
    (relationshipsQuery.isSuccess || relationshipsQuery.isError);
  const approvalsQuery = useQuery({
    queryKey: ["clients", "approvals", organizationId, clientId, entityIds],
    queryFn: () => readClientApprovals({ organizationId, userId: identity.userId }, entityIds),
    enabled: linksSettled,
    retry: false,
  });

  const card = useMemo(() => {
    if (!record || !timeZone) return null;
    return (
      buildClientBook(
        {
          clients: [record],
          proposals: proposalsQuery.isError ? null : (proposalsQuery.data ?? []),
          projects: projectsQuery.isError ? null : (projectsQuery.data ?? []),
        },
        now,
        timeZone,
      )[0] ?? null
    );
  }, [record, timeZone, proposalsQuery.data, proposalsQuery.isError, projectsQuery.data, projectsQuery.isError, now]);

  if (zoneQuery.isLoading || clientQuery.isLoading) {
    return (
      <AppShell identity={identity}>
        <p className="text-sm text-muted-foreground">Reading this company.</p>
      </AppShell>
    );
  }

  if (zoneQuery.isError || !timeZone) {
    return (
      <AppShell identity={identity}>
        <EmptyState
          title="The organization's timezone could not be read"
          belongsHere="Every date on a client page is a day in your organization's own timezone."
          whyItMatters="Without it a review date could land on the wrong day, so nothing is shown instead."
          action={<BackToClients />}
        />
      </AppShell>
    );
  }

  if (clientQuery.isError) {
    return (
      <AppShell identity={identity}>
        <EmptyState
          title="This company could not be read"
          belongsHere="This page reads the canonical client record for your organization."
          whyItMatters={
            clientQuery.error instanceof Error
              ? clientQuery.error.message
              : "The client record did not answer, so nothing here is guessed."
          }
          action={<BackToClients />}
        />
      </AppShell>
    );
  }

  if (!record || !card) {
    return (
      <AppShell identity={identity}>
        <EmptyState
          title="That company is not in the book"
          belongsHere="This page reads the canonical client record for your organization."
          whyItMatters="A client you cannot see here is either not recorded yet, or belongs to another organization."
          action={<BackToClients />}
        />
      </AppShell>
    );
  }

  const facts = clientHeaderFacts(card, now, timeZone);
  const cadence = reviewCadenceFor(record, now, timeZone);

  /* Each room's answer, or the fact that it could not be asked. */
  const roadmapRead = readOf(roadmapsQuery);
  const roadmapOutcomes: RoomRead<ReturnType<typeof roadmapOutcomeFor>[]> | null =
    roadmapRead === null
      ? null
      : roadmapRead.available
        ? answered(
            roadmaps.map((roadmap) =>
              roadmapOutcomeFor(
                roadmap,
                roadmapRead.value.stagesByRoadmap[roadmap.id] ?? [],
                roadmapRead.value.openDecisions,
              ),
            ),
          )
        : roadmapRead;
  const projectsRead = readOf(projectsQuery);
  const projectsForTab: RoomRead<typeof projects> | null =
    projectsRead === null ? null : projectsRead.available ? answered(projects) : projectsRead;
  const relationshipsRead = readOf(relationshipsQuery);
  const relationshipRead: RoomRead<ReturnType<typeof relationshipSnapshotFor>> | null =
    relationshipsRead === null
      ? null
      : relationshipsRead.available
        ? answered(relationshipSnapshotFor(relationshipsRead.value, clientId, now, timeZone))
        : relationshipsRead;
  const approvalsRaw = readOf(approvalsQuery);
  const approvalsRead: typeof approvalsRaw =
    approvalsRaw === null
      ? null
      : approvalsRaw.available && approvalsRaw.value.ready
        ? answered({
            ready: true as const,
            requests: approvalsForClient(approvalsRaw.value.requests, links),
          })
        : approvalsRaw;
  const historyRaw = readOf(historyQuery);
  const historyRead: typeof historyRaw =
    historyRaw === null
      ? null
      : historyRaw.available
        ? answered(eventsAbout(historyRaw.value, entityIds))
        : historyRaw;

  return (
    <AppShell identity={identity}>
      <div className="space-y-8">
        <ClientHeader
          card={card}
          facts={facts}
          websiteUrl={record.websiteUrl}
          warnings={card.warnings}
        />

        <ClientTabs clientId={clientId} active={tab} />

        <div role="tabpanel" aria-label={tab}>
          {tab === "overview" ? (
            <OverviewTab
              reads={{
                roadmap:
                  roadmapOutcomes === null
                    ? null
                    : roadmapOutcomes.available
                      ? answered(roadmapOutcomes.value[0] ?? null)
                      : roadmapOutcomes,
                projects: projectsForTab,
                approvals: approvalsRead,
                relationship: relationshipRead,
                history: historyRead,
                loading: {
                  roadmap: roadmapsQuery.isLoading,
                  projects: projectsQuery.isLoading,
                  approvals: !linksSettled || approvalsQuery.isLoading,
                  relationship: relationshipsQuery.isLoading,
                  history: historyQuery.isLoading,
                },
              }}
              cadence={cadence}
              now={now}
              timeZone={timeZone}
            />
          ) : null}
          {tab === "roadmap" ? (
            <RoadmapTab read={roadmapOutcomes} loading={roadmapsQuery.isLoading} />
          ) : null}
          {tab === "projects" ? (
            <ProjectsTab read={projectsForTab} loading={projectsQuery.isLoading} timeZone={timeZone} />
          ) : null}
          {tab === "relationship" ? (
            <RelationshipTab
              read={relationshipRead}
              loading={relationshipsQuery.isLoading}
              now={now}
              timeZone={timeZone}
            />
          ) : null}
          {tab === "site" ? <SiteTab /> : null}
          {tab === "files" ? <FilesTab /> : null}
        </div>
      </div>
    </AppShell>
  );
}

function BackToClients() {
  return (
    <Link to="/modules/clients" className="text-sm font-medium text-royal">
      Back to clients
    </Link>
  );
}
