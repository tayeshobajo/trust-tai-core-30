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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/tt/app-shell";
import { CommercialPanel } from "@/components/tt/clients/commercial-panel";
import { ProposalPanel } from "@/components/tt/clients/proposal-panel";
import { ClientHeader, ClientTabs } from "@/components/tt/clients/shell";
import { OverviewTab } from "@/components/tt/clients/overview";
import { CommercialTab } from "@/components/tt/clients/commercial-tab";
import {
  ClientChatTab,
  type ClientChatAnswer,
  type ClientChatEntry,
  type ClientProposalState,
} from "@/components/tt/clients/chat";
import { FilesTab, RelationshipTab } from "@/components/tt/clients/tabs";
import { ClientProjectWorkspace } from "@/components/tt/clients/project-workspace";
import type { ProjectTab } from "@/components/tt/projects/detail/frame";
import { isProjectSurface } from "@/domain/project-workroom-ia";

import { EmptyState } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { buildClientBook } from "@/data/clients/book-projection";
import { uploadClientLogo } from "@/data/clients/logo";
import {
  eventsAbout,
  readClientApprovals,
  readClientFiles,
  readClientLinkedSources,
  readClientHistory,
  readClientRoadmaps,
  readClientSite,
} from "@/data/clients/shell-reads";
import {
  listProposalNodes,
  readClientCommercialRecord,
  readOrganizationTimeZoneResolved,
  recordProposalOutcome,
  recordProposalSent,
  setClientCommercialState,
} from "@/data/supabase/commercial-service";
import { commsService } from "@/data/supabase/comms-service";
import { projectDelivery } from "@/data/supabase/project-delivery";
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
import { relationshipWindow } from "@/data/clients/relationship-window";
import { listRelationshipMessages } from "@/data/supabase/comms-messages";

import { attentionItems } from "@/domain/client-overview";
import { clientContextPacket } from "@/domain/client-context-packet";
import {
  clientProposalAlreadyApplied,
  clientProposalReceipt,
  clientProposalStale,
  prepareClientProposal,
  type ClientChangeIntent,
  type ClientOtherRoom,
} from "@/domain/client-chat-proposal";
import { supabase } from "@/integrations/trust-tai/supabase";

import type { CommercialFormPatch } from "@/domain/client-commercial-form";
import { projectLinkedToRoadmap } from "@/domain/project-roadmap-link";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Client · Trust Tai OS";
const DESCRIPTION =
  "One company: tier, commercial value, next review, delivery in flight, the people we know there, and what has happened.";

export const Route = createFileRoute("/modules/clients/$clientId")({
  /**
   * Overview is the door; it carries no `tab` so plain client links stay clean.
   * `project` and `view` remember which project is open inside this client and
   * which of its surfaces is showing, so refresh, back/forward and a shared
   * link all land in the same place without leaving the client.
   */
  validateSearch: (
    search: Record<string, unknown>,
  ): { tab?: ClientTab; project?: string; view?: ProjectTab } => {
    const tab = parseClientTab(search["tab"]);
    const project = typeof search["project"] === "string" ? search["project"] : undefined;
    const rawView = search["view"];
    const view = isProjectSurface(rawView) ? rawView : undefined;
    return {
      ...(tab === "overview" ? {} : { tab }),
      ...(project ? { project } : {}),
      ...(view && view !== "overview" ? { view } : {}),
    };
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
  const { tab, project, view } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <WorkspaceGate appId="clients">
      {(identity) => (
        <ClientShell
          identity={identity}
          clientId={clientId}
          tab={tab ?? "overview"}
          selectedProjectId={project ?? null}
          projectSurface={view ?? "overview"}
          onSelectProject={(projectId) =>
            void navigate({ search: (prev) => ({ ...prev, project: projectId }) })
          }
          onProjectSurface={(next) =>
            void navigate({ search: (prev) => ({ ...prev, view: next }) })
          }
        />
      )}
    </WorkspaceGate>
  );
}

/** Turn a query into a room read: answered, unreadable, or still on its way. */
function readOf<T>(query: {
  data: T | undefined;
  isError: boolean;
  error: unknown;
}): RoomRead<T> | null {
  if (query.isError) {
    return unreadable(query.error instanceof Error ? query.error.message : "The read failed.");
  }
  return query.data === undefined ? null : answered(query.data);
}

function ClientShell({
  identity,
  clientId,
  tab,
  selectedProjectId,
  projectSurface,
  onSelectProject,
  onProjectSurface,
}: {
  identity: WorkspaceIdentity;
  clientId: string;
  tab: ClientTab;
  selectedProjectId: string | null;
  projectSurface: ProjectTab;
  onSelectProject: (projectId: string) => void;
  onProjectSurface: (tab: ProjectTab) => void;
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
    queryFn: () => listProposalNodes(organizationId),
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
  const siteQuery = useQuery({
    queryKey: ["clients", "site", organizationId],
    queryFn: () => readClientSite(organizationId),
    retry: false,
  });
  const historyQuery = useQuery({
    queryKey: ["clients", "history", organizationId],
    queryFn: () => readClientHistory(organizationId),
    retry: false,
  });

  const record = clientQuery.data ?? null;
  const queryClient = useQueryClient();
  const [logoProblem, setLogoProblem] = useState<string | null>(null);
  const [commercialProblem, setCommercialProblem] = useState<string | null>(null);
  const [commercialSaved, setCommercialSaved] = useState(false);
  const [proposalProblem, setProposalProblem] = useState<string | null>(null);
  const [proposalSavedId, setProposalSavedId] = useState<string | null>(null);

  /* The one write path into commercial truth, as the signed-in person, under RLS. */
  const saveCommercial = useMutation({
    mutationFn: (patch: CommercialFormPatch) =>
      setClientCommercialState(
        { clientId, ...patch },
        {
          organizationId,
          userId: identity.userId,
          userLabel: identity.name,
        },
      ),
    onSuccess: () => {
      setCommercialProblem(null);
      setCommercialSaved(true);
      void queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (error: unknown) => {
      setCommercialSaved(false);
      setCommercialProblem(
        error instanceof Error ? error.message : "That commercial state could not be saved.",
      );
    },
  });

  /* The human path into proposal truth, on the lineage node that owns it. */
  const proposalContext = {
    organizationId,
    userId: identity.userId,
    userLabel: identity.name,
  };
  const sendProposal = useMutation({
    mutationFn: (input: { roadmapId: string; amountCents: number; sentAt: string }) =>
      recordProposalSent(
        { roadmapId: input.roadmapId, amountCents: input.amountCents, sentAt: input.sentAt },
        proposalContext,
      ),
    onSuccess: (_result, input) => {
      setProposalProblem(null);
      setProposalSavedId(input.roadmapId);
      void queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (error: unknown) => {
      setProposalSavedId(null);
      setProposalProblem(
        error instanceof Error ? error.message : "That proposal could not be recorded.",
      );
    },
  });
  const answerProposal = useMutation({
    mutationFn: (input: { roadmapId: string; outcome: "signed" | "declined"; at: string }) =>
      recordProposalOutcome(input, proposalContext),
    onSuccess: (_result, input) => {
      setProposalProblem(null);
      setProposalSavedId(input.roadmapId);
      void queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (error: unknown) => {
      setProposalSavedId(null);
      setProposalProblem(
        error instanceof Error ? error.message : "That answer could not be recorded.",
      );
    },
  });

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
  /**
   * What has actually been exchanged with these people. Read from Comms, whose
   * messages remain Comms' own record; Clients only reports the counts and the
   * last thing said in each direction.
   */
  const exchangeQuery = useQuery({
    queryKey: ["clients", "exchange", organizationId, relationshipIds.join(",")],
    enabled: relationshipIds.length > 0,
    retry: false,
    queryFn: async () => {
      const entries = await Promise.all(
        relationshipIds.map(
          async (id) => [id, await listRelationshipMessages(organizationId, id)] as const,
        ),
      );
      return Object.fromEntries(entries);
    },
  });
  const exchangeWindow = useMemo(() => {
    const relationships = (relationshipsQuery.data ?? []).filter(
      (relationship) => relationship.clientId === clientId,
    );
    if (relationships.length === 0) return null;
    return relationshipWindow({
      relationships,
      messagesByRelationship: exchangeQuery.data ?? {},
      now,
    });
  }, [relationshipsQuery.data, clientId, exchangeQuery.data, now]);

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
  const projectIds = links.projectIds;
  const projectNames = useMemo(
    () => Object.fromEntries(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  const filesQuery = useQuery({
    queryKey: ["clients", "files", organizationId, projectIds],
    queryFn: () => readClientFiles(organizationId, projectIds),
    enabled: projectsQuery.isSuccess,
    retry: false,
  });

  const linkedSourcesQuery = useQuery({
    queryKey: ["clients", "linked-sources", organizationId, projectIds],
    queryFn: () => readClientLinkedSources(organizationId, projectIds),
    enabled: projectsQuery.isSuccess,
    retry: false,
  });

  /* A company image is a real file a person uploaded, never a guess. */
  const uploadLogo = useMutation({
    mutationFn: (file: File) => uploadClientLogo({ organizationId, clientId, file }),
    onSuccess: () => {
      setLogoProblem(null);
      void queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (error: unknown) =>
      setLogoProblem(error instanceof Error ? error.message : "That image could not be saved."),
  });

  /* ------------------------------------------------------------------ chat */
  /* Session scoped, on purpose: there is no durable client chat store, so the
     conversation lives in this page and says so. What survives is the client
     record and its activity. */
  const [chatEntries, setChatEntries] = useState<ClientChatEntry[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);

  const entryId = () => `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  /**
   * One message. "ask" answers from this account's bounded packet. "change"
   * reads the message and prepares one bounded commercial proposal. Both are
   * read only: the endpoint writes nothing, so every real change still goes
   * through the commercial service after a person approves it.
   */
  const sendChat = useMutation({
    mutationFn: async ({
      message,
      pasted,
      mode,
      pendingId,
      packet,
      clientLabel,
    }: {
      message: string;
      pasted: string;
      mode: "ask" | "change";
      pendingId: string;
      packet: unknown;
      clientLabel: string;
    }) => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Your session expired. Sign in again to ask.");
      const response = await fetch("/api/public/clients/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          organization_id: organizationId,
          client_label: clientLabel,
          question: message,
          pasted,
          packet,
          mode: mode === "change" ? "prepare" : "ask",
        }),
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok) throw new Error(String(body["error"] ?? "This account could not answer."));
      return { body, mode, message, pendingId };
    },
    onSuccess: ({ body, mode, message, pendingId }) => {
      const resolve = (entry: ClientChatEntry): ClientChatEntry => {
        if (mode === "ask") {
          return { ...entry, pending: false, answer: body as unknown as ClientChatAnswer };
        }
        const kind = String(body["kind"] ?? "unclear");
        const because = String(body["because"] ?? "").trim();
        if (kind === "other_room") {
          return {
            ...entry,
            pending: false,
            room: body["room"] as ClientOtherRoom,
            text: because || "That truth belongs to another room.",
          };
        }
        if (kind !== "change" || !clientQuery.data) {
          return {
            ...entry,
            pending: false,
            text:
              because ||
              "That is not a change the account can make from here. Say what should change, what it should say, and why.",
          };
        }
        const intent: ClientChangeIntent = {
          action: String(body["action"] ?? "") as ClientChangeIntent["action"],
          ...(body["value"] !== undefined ? { value: String(body["value"] ?? "") } : {}),
          ...(body["reason"] ? { reason: String(body["reason"]) } : {}),
        };
        const prepared = prepareClientProposal(
          {
            mrrCents: clientQuery.data.mrrCents,
            renewalAt: clientQuery.data.renewalAt,
            nextReviewAt: clientQuery.data.nextReviewAt,
          },
          intent,
          message,
        );
        if (!prepared.ok) {
          return {
            ...entry,
            pending: false,
            text: prepared.because,
            ...(prepared.room ? { room: prepared.room } : {}),
          };
        }
        return { ...entry, pending: false, proposal: prepared.proposal, proposalState: "open" };
      };
      setChatEntries((entries) =>
        entries.map((entry) => (entry.id === pendingId ? resolve(entry) : entry)),
      );
    },
    onError: (cause: unknown, variables) => {
      setChatError(cause instanceof Error ? cause.message : "This account could not answer.");
      setChatEntries((entries) => entries.filter((entry) => entry.id !== variables.pendingId));
    },
  });

  const settle = (id: string, state: ClientProposalState, outcome: string) =>
    setChatEntries((entries) =>
      entries.map((entry) =>
        entry.id === id ? { ...entry, proposalState: state, outcome } : entry,
      ),
    );

  /**
   * The only place Chat writes. It re-reads the client first, refuses a
   * proposal prepared against truth that has since moved, and does nothing at
   * all if the record already says what was proposed. The write itself is the
   * same commercial service the Commercial panel uses.
   */
  const approveProposal = async (id: string) => {
    const entry = chatEntries.find((candidate) => candidate.id === id);
    const proposal = entry?.proposal;
    if (!proposal || entry?.proposalState !== "open" || applying) return;
    setApplying(id);
    setChatError(null);
    try {
      const fresh = await readClientCommercialRecord(clientId, organizationId);
      if (!fresh) throw new Error("This client is no longer readable.");
      const now = {
        mrrCents: fresh.mrrCents,
        renewalAt: fresh.renewalAt,
        nextReviewAt: fresh.nextReviewAt,
      };
      const stale = clientProposalStale(proposal, now);
      if (stale) {
        settle(id, "stale", stale);
        return;
      }
      if (clientProposalAlreadyApplied(proposal, now)) {
        settle(id, "applied", "The record already says this. Nothing was written twice.");
        return;
      }
      await setClientCommercialState(
        { clientId, ...proposal.patch },
        { organizationId, userId: identity.userId, userLabel: identity.name },
      );
      await queryClient.invalidateQueries({ queryKey: ["clients"] });
      settle(id, "applied", clientProposalReceipt(proposal));
    } catch (cause) {
      settle(
        id,
        "open",
        cause instanceof Error ? cause.message : "That change could not be recorded.",
      );
    } finally {
      setApplying(null);
    }
  };

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
          proposals: proposalsQuery.isError
            ? null
            : (proposalsQuery.data ?? []).filter((proposal) => proposal.proposalSentAt !== null),
          projects: projectsQuery.isError ? null : (projectsQuery.data ?? []),
        },
        now,
        timeZone,
      )[0] ?? null
    );
  }, [
    record,
    timeZone,
    proposalsQuery.data,
    proposalsQuery.isError,
    projectsQuery.data,
    projectsQuery.isError,
    now,
  ]);

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

  /* One entry per roadmap this company already has, with whatever proposal
     state is recorded on it. A roadmap with no proposal says so. */
  const proposalStates = new Map(
    (proposalsQuery.data ?? []).map((proposal) => [proposal.id, proposal]),
  );
  const proposalNodes = roadmaps.map((roadmap) => {
    const state = proposalStates.get(roadmap.id);
    return {
      roadmapId: roadmap.id,
      title: roadmap.title,
      current: {
        sentAt: state?.proposalSentAt ?? null,
        amountCents: state?.proposalAmountCents ?? null,
        outcome: state?.proposalOutcome ?? null,
        outcomeAt: state?.proposalOutcomeAt ?? null,
      },
    };
  });
  const pendingProposalId = sendProposal.isPending
    ? (sendProposal.variables?.roadmapId ?? null)
    : answerProposal.isPending
      ? (answerProposal.variables?.roadmapId ?? null)
      : null;

  const facts = clientHeaderFacts(card, now, timeZone);

  /* Who last said this commercial truth, resolved once for read and edit. */
  const commercialProvenance = {
    by:
      typeof record.commercialProvenance?.["actor_label"] === "string"
        ? String(record.commercialProvenance["actor_label"])
        : null,
    at: record.commercialUpdatedAt,
    because:
      typeof record.commercialProvenance?.["because"] === "string"
        ? String(record.commercialProvenance["because"])
        : null,
  };
  const commercialProvenanceLine = commercialProvenance.at
    ? `Last recorded ${commercialProvenance.at.slice(0, 10)}${
        commercialProvenance.by ? ` by ${commercialProvenance.by}` : ""
      }${commercialProvenance.because ? `. Reason given: ${commercialProvenance.because}` : "."}`
    : "No commercial state recorded yet.";

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
  /* The project a person linked to the overview roadmap, when one exists. */
  const overviewRoadmapProject =
    roadmapOutcomes?.available && roadmapOutcomes.value[0]
      ? projectLinkedToRoadmap(projects, roadmapOutcomes.value[0].roadmapId)
      : null;
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

  /**
   * The bounded account packet Chat reasons over. Composed only from the reads
   * this page already made under the signed-in person's own session, so row
   * level security has already decided what it may contain. No raw Comms
   * message text, no file bytes, no second copy of any store.
   */
  const packet = clientContextPacket({
    identity: { clientId, name: record.name, websiteUrl: record.websiteUrl },
    commercial: {
      headline: card.commercialLine,
      review: cadence.line,
      renewal: cadence.renewalLine,
      provenance: commercialProvenanceLine,
    },
    projects: projectsForTab,
    relationship: relationshipRead,
    roadmap: roadmapOutcomes,
    sources: readOf(linkedSourcesQuery),
    history: historyRead,
    attention: attentionItems({
      projects: projectsForTab,
      relationship: relationshipRead,
      roadmap:
        roadmapOutcomes === null
          ? null
          : roadmapOutcomes.available
            ? answered(roadmapOutcomes.value[0] ?? null)
            : roadmapOutcomes,
      approvals: approvalsRead,
      exchange: exchangeWindow,
      cadence,
      commercialLine: card.commercialLine,
      now,
      timeZone,
    }),
  });

  return (
    <AppShell identity={identity}>
      <div className="space-y-8">
        <ClientHeader
          card={card}
          facts={facts}
          websiteUrl={record.websiteUrl}
          warnings={card.warnings}
          logo={{
            pending: uploadLogo.isPending,
            problem: logoProblem,
            onSelect: (file) => uploadLogo.mutate(file),
          }}
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
                site: readOf(siteQuery),
                loading: {
                  roadmap: roadmapsQuery.isLoading,
                  projects: projectsQuery.isLoading,
                  approvals: !linksSettled || approvalsQuery.isLoading,
                  relationship: relationshipsQuery.isLoading,
                  history: historyQuery.isLoading,
                  site: siteQuery.isLoading,
                },
              }}
              cadence={cadence}
              client={{ name: record.name, websiteUrl: record.websiteUrl }}
              now={now}
              timeZone={timeZone}
              roadmapProject={overviewRoadmapProject}
              exchange={exchangeWindow}
              commercial={{
                headline: card.commercialLine,
                review: cadence.line,
                renewal: cadence.renewalLine,
                provenance: commercialProvenanceLine,
              }}
            />
          ) : null}

          {tab === "projects" ? (
            projectsForTab && !projectsForTab.available ? (
              <p className="text-sm text-muted-foreground">
                Delivery could not be read: {projectsForTab.because}
              </p>
            ) : (
              /* The project's own workroom, in place. Projects and Roadmap still
                 own the truth underneath; this is the same component the
                 standalone room renders. */
              <ClientProjectWorkspace
                identity={identity}
                projects={projects}
                selectedId={selectedProjectId}
                surface={projectSurface}
                loading={projectsQuery.isLoading}
                onSelect={onSelectProject}
                onSurfaceChange={onProjectSurface}
              />
            )
          ) : null}

          {tab === "relationship" ? (
            <RelationshipTab
              read={relationshipRead}
              loading={relationshipsQuery.isLoading}
              now={now}
              timeZone={timeZone}
              window={exchangeWindow}
            />
          ) : null}
          {tab === "commercial" ? (
            <CommercialTab
              lines={{
                headline: card.commercialLine,
                review: cadence.line,
                renewal: cadence.renewalLine,
                provenance: commercialProvenanceLine,
              }}
              form={
                <CommercialPanel
                  current={{
                    tier: record.tier,
                    mrrCents: record.mrrCents,
                    renewalAt: record.renewalAt,
                    nextReviewAt: record.nextReviewAt,
                  }}
                  provenance={commercialProvenance}
                  pending={saveCommercial.isPending}
                  problem={commercialProblem}
                  saved={commercialSaved}
                  onSave={(patch) => saveCommercial.mutate(patch)}
                />
              }
              proposals={
                <ProposalPanel
                  nodes={proposalNodes}
                  pendingRoadmapId={pendingProposalId}
                  problem={proposalProblem}
                  savedRoadmapId={proposalSavedId}
                  onSend={(input) => sendProposal.mutate(input)}
                  onAnswer={(input) => answerProposal.mutate(input)}
                />
              }
            />
          ) : null}
          {tab === "files" ? (
            <FilesTab
              read={readOf(filesQuery)}
              linkedRead={readOf(linkedSourcesQuery)}
              loading={projectsQuery.isLoading || filesQuery.isLoading}
              linkedLoading={projectsQuery.isLoading || linkedSourcesQuery.isLoading}
              hasProjects={projects.length > 0}
              projectNames={projectNames}
              timeZone={timeZone}
              onOpen={(file) => {
                void projectDelivery.fileUrl(file).then((url) => {
                  window.open(url, "_blank", "noopener,noreferrer");
                });
              }}
            />
          ) : null}
          {tab === "chat" ? (
            <ClientChatTab
              clientName={record.name}
              entries={chatEntries}
              pending={sendChat.isPending}
              applying={applying}
              error={chatError}
              onSend={(message, pasted, mode) => {
                setChatError(null);
                const pendingId = entryId();
                setChatEntries((entries) => [
                  ...entries,
                  { id: entryId(), role: "you", text: message, ...(pasted ? { pasted } : {}) },
                  { id: pendingId, role: "client", pending: true },
                ]);
                sendChat.mutate({
                  message,
                  pasted,
                  mode,
                  pendingId,
                  packet,
                  clientLabel: record.name,
                });
              }}
              onApprove={(id) => void approveProposal(id)}
              onDiscard={(id) => settle(id, "discarded", "Discarded. Nothing was changed.")}
            />
          ) : null}
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
