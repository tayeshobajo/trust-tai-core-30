/**
 * Clients, the book of companies Trust Tai is responsible for.
 *
 * Rooms run the week. This room explains the company: who they are, what tier
 * they are on, what that is worth, when they are next reviewed, and what
 * delivery is doing for them. Every line is read from state another room
 * already owns; Clients writes only the client record itself.
 *
 * Every day shown here is a day in the organization's own timezone, read
 * once from the organization record. A source that could not be read is
 * named as unreadable; it is never rendered as a quiet zero.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/tt/app-shell";
import { ClientGrid, ClientsViews, ProposedList } from "@/components/tt/clients/card";
import { CreateClientModal } from "@/components/tt/clients/create-modal";
import { EmptyState, SectionHeading, TTButton, TTInput } from "@/components/tt/primitives";
import { RoomHero } from "@/components/tt/room-hero";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { buildClientBook } from "@/data/clients/book-projection";
import {
  createClientRecord,
  listClientCommercialState,
  listProposals,
  readOrganizationTimeZoneResolved,
} from "@/data/supabase/commercial-service";
import { projectsService } from "@/data/supabase/projects-service";
import {
  clientsHeadline,
  filterClientCards,
  proposedCards,
  viewCounts,
  type ClientsView,
  type NewClientInput,
} from "@/domain/clients-book";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Clients · Everyone you serve · Trust Tai OS";
const DESCRIPTION =
  "Every company Trust Tai is responsible for: tier, commercial value, next review and what delivery is doing, one door each.";

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
  const organizationId = identity.organizationId;
  const [view, setView] = useState<ClientsView>("all");
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const now = useMemo(() => new Date(), []);

  /* The organization's own zone. Read first; every day below depends on it. */
  const zoneQuery = useQuery({
    queryKey: ["organization", "timezone", organizationId],
    queryFn: () => readOrganizationTimeZoneResolved(organizationId),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const zone = zoneQuery.data ?? null;

  const clientsQuery = useQuery({
    queryKey: ["clients", "book", organizationId],
    queryFn: () => listClientCommercialState(organizationId),
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

  const cards = useMemo(
    () =>
      zone
        ? buildClientBook(
            {
              clients: clientsQuery.data ?? [],
              // A source that failed is an unknown, never a quiet zero.
              proposals: proposalsQuery.isError ? null : (proposalsQuery.data ?? []),
              projects: projectsQuery.isError ? null : (projectsQuery.data ?? []),
            },
            now,
            zone.timeZone,
          )
        : [],
    [
      zone,
      clientsQuery.data,
      proposalsQuery.data,
      proposalsQuery.isError,
      projectsQuery.data,
      projectsQuery.isError,
      now,
    ],
  );

  const create = useMutation({
    mutationFn: (input: NewClientInput) =>
      createClientRecord(input, {
        organizationId,
        userId: identity.userId,
        userLabel: identity.name,
      }),
    onSuccess: async () => {
      setModalOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
  });

  const reading = zoneQuery.isLoading || clientsQuery.isLoading;
  const headline = zone
    ? clientsHeadline(cards, now, zone.timeZone, { proposalsAvailable: !proposalsQuery.isError })
    : null;
  const counts = viewCounts(cards);
  const visible = filterClientCards(cards, view, query);
  const proposed = proposedCards(cards, query);
  const hasAnyClient = cards.length > 0;

  return (
    <AppShell identity={identity}>
      <div className="space-y-8">
        <RoomHero
          eyebrow="Clients"
          title="Everyone you serve, one door each."
          supporting={
            reading
              ? "Reading the book."
              : clientsQuery.isError
                ? "The client book could not be read just now."
                : (headline?.sentence ?? "Reading the book.")
          }
          actions={
            <TTButton onClick={() => setModalOpen(true)} type="button" disabled={!zone}>
              Add client
            </TTButton>
          }
          footer={
            zone?.fallback ? (
              <p className="text-[12px] text-muted-foreground">
                Days are shown in {zone.timeZone} because the organization has no timezone
                recorded yet. Set one in Settings so review dates land on the right day.
              </p>
            ) : null
          }
        />

        {zoneQuery.isError ? (
          <EmptyState
            title="The organization's timezone could not be read"
            belongsHere="Every review and renewal date in this book is a day in your organization's own timezone."
            whyItMatters="Without it, a date could land on the wrong day. Nothing is shown rather than something that may be a day out."
          />
        ) : clientsQuery.isError ? (
          <EmptyState
            title="The client book could not be read"
            belongsHere="This page reads the canonical client record for your organization."
            whyItMatters="Nothing is shown as empty when it could not be read, so no number here is a guess."
          />
        ) : !hasAnyClient && !reading ? (
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
        ) : hasAnyClient ? (
          <>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <ClientsViews view={view} counts={counts} onChange={setView} />
              <label className="relative block w-full lg:max-w-xs">
                <span className="sr-only">Search clients by company name</span>
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <TTInput
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find a company"
                  className="h-10 pl-9"
                />
              </label>
            </div>

            {visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {query.trim()
                  ? `No client matches "${query.trim()}" in this view.`
                  : "Nothing sits in this view yet."}
              </p>
            ) : (
              <ClientGrid cards={visible} />
            )}

            {proposalsQuery.isError ? (
              <section>
                <SectionHeading
                  eyebrow="Proposed"
                  title="Awaiting a decision"
                  description="Proposals could not be read just now, so nothing is listed here. This is not an empty list."
                />
              </section>
            ) : proposed.length > 0 ? (
              <section>
                <SectionHeading
                  eyebrow="Proposed"
                  title="Awaiting a decision"
                  description="Companies with an open proposal and no tier yet. They join the book above once a decision is recorded."
                />
                <ProposedList cards={proposed} />
              </section>
            ) : null}
          </>
        ) : null}

        {create.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {create.error instanceof Error ? create.error.message : "That client could not be saved."}
          </p>
        ) : null}
      </div>

      {zone ? (
        <CreateClientModal
          open={modalOpen}
          pending={create.isPending}
          timeZone={zone.timeZone}
          onClose={() => setModalOpen(false)}
          onCreate={(input) => create.mutate(input)}
        />
      ) : null}
    </AppShell>
  );
}
