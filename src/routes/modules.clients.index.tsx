/**
 * Clients, the book of companies Trust Tai is responsible for.
 *
 * Rooms run the week. This room explains the company: who they are, what tier
 * they are on, what that is worth, when they are next reviewed, and what
 * delivery is doing for them. Every line is read from state another room
 * already owns; Clients writes only the client record itself.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/tt/app-shell";
import { ClientGrid, ClientsViews } from "@/components/tt/clients/card";
import { CreateClientModal } from "@/components/tt/clients/create-modal";
import { EmptyState, PageHeader, TTButton } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { buildClientBook } from "@/data/clients/book-projection";
import {
  createClientRecord,
  listClientCommercialState,
  listProposals,
} from "@/data/supabase/commercial-service";
import { projectsService } from "@/data/supabase/projects-service";
import {
  clientsHeadline,
  filterClientCards,
  viewCounts,
  type ClientsView,
  type NewClientInput,
} from "@/domain/clients-book";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Clients · The book of companies · Trust Tai OS";
const DESCRIPTION =
  "Every company Trust Tai is responsible for: tier, commercial value, next review and what delivery is doing, in one place.";

export const Route = createFileRoute("/modules/clients/")({
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
  component: ClientsRoute,
});

function ClientsRoute() {
  return (
    <WorkspaceGate appId="clients">{(identity) => <ClientsBook identity={identity} />}</WorkspaceGate>
  );
}

function ClientsBook({ identity }: { identity: WorkspaceIdentity }) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<ClientsView>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const now = useMemo(() => new Date(), []);

  const clientsQuery = useQuery({
    queryKey: ["clients", "book", identity.organizationId],
    queryFn: () => listClientCommercialState(identity.organizationId),
    retry: false,
  });

  const proposalsQuery = useQuery({
    queryKey: ["clients", "proposals", identity.organizationId],
    queryFn: () => listProposals(identity.organizationId),
    retry: false,
  });

  const projectsQuery = useQuery({
    queryKey: ["clients", "projects", identity.organizationId],
    queryFn: () => projectsService.list(identity.organizationId),
    retry: false,
  });

  const cards = useMemo(
    () =>
      buildClientBook(
        {
          clients: clientsQuery.data ?? [],
          // A source that failed is an unknown, never a quiet zero.
          proposals: proposalsQuery.isError ? null : (proposalsQuery.data ?? []),
          projects: projectsQuery.isError ? null : (projectsQuery.data ?? []),
        },
        now,
      ),
    [clientsQuery.data, proposalsQuery.data, proposalsQuery.isError, projectsQuery.data, projectsQuery.isError, now],
  );

  const create = useMutation({
    mutationFn: (input: NewClientInput) =>
      createClientRecord(input, {
        organizationId: identity.organizationId,
        userId: identity.userId,
        userLabel: identity.name,
      }),
    onSuccess: async () => {
      setModalOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
  });

  const headline = clientsHeadline(cards, now);
  const counts = viewCounts(cards);
  const visible = filterClientCards(cards, view);

  return (
    <AppShell identity={identity}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Clients"
          title="The companies we carry"
          supporting={clientsQuery.isLoading ? "Reading the book." : headline.sentence}
          appId="clients"
          action={
            <TTButton onClick={() => setModalOpen(true)} type="button">
              Add a client
            </TTButton>
          }
        />

        {clientsQuery.isError ? (
          <EmptyState
            title="The client book could not be read"
            belongsHere="This page reads the canonical client record for your organization."
            whyItMatters="Nothing is shown as empty when it could not be read, so no number here is a guess."
          />
        ) : cards.length === 0 && !clientsQuery.isLoading ? (
          <EmptyState
            title="No clients recorded yet"
            belongsHere="Every company Trust Tai is commercially responsible for belongs in this book."
            whyItMatters="Tier, value and review dates all hang off the client record, so the week can be measured honestly."
            action={
              <TTButton onClick={() => setModalOpen(true)} type="button">
                Add the first client
              </TTButton>
            }
          />
        ) : (
          <>
            <ClientsViews view={view} counts={counts} onChange={setView} />
            {visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing sits in this view yet.</p>
            ) : (
              <ClientGrid cards={visible} />
            )}
          </>
        )}

        {create.isError ? (
          <p className="text-sm text-destructive">
            {create.error instanceof Error ? create.error.message : "That client could not be saved."}
          </p>
        ) : null}
      </div>

      <CreateClientModal
        open={modalOpen}
        pending={create.isPending}
        onClose={() => setModalOpen(false)}
        onCreate={(input) => create.mutate(input)}
      />
    </AppShell>
  );
}
