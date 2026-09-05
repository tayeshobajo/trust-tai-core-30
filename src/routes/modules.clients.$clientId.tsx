/**
 * One client, the shell every other room hangs off.
 *
 * The page answers, in order: who this company is, what they are worth and
 * when they are next reviewed, what delivery is doing for them, who we know
 * there, and what has actually happened. Nothing on this page is invented: a
 * section with no recorded truth says so plainly rather than filling itself.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { AppShell } from "@/components/tt/app-shell";
import { EmptyState, PageHeader, SectionHeading, TTCard } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { buildClientBook } from "@/data/clients/book-projection";
import { readSuiteEvents } from "@/data/events/suite-events";
import {
  listClientCommercialState,
  listProposals,
} from "@/data/supabase/commercial-service";
import { commsService } from "@/data/supabase/comms-service";
import { projectsService } from "@/data/supabase/projects-service";
import { formatDay } from "@/domain/clients-book";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Client · Trust Tai OS";
const DESCRIPTION =
  "One company: tier, commercial value, next review, delivery in flight, the people we know there, and what has happened.";

export const Route = createFileRoute("/modules/clients/$clientId")({
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
  return (
    <WorkspaceGate appId="clients">
      {(identity) => <ClientShell identity={identity} clientId={clientId} />}
    </WorkspaceGate>
  );
}

function ClientShell({ identity, clientId }: { identity: WorkspaceIdentity; clientId: string }) {
  const now = useMemo(() => new Date(), []);
  const organizationId = identity.organizationId;

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
  const relationshipsQuery = useQuery({
    queryKey: ["clients", "relationships", organizationId],
    queryFn: () => commsService.list(organizationId),
    retry: false,
  });
  const eventsQuery = useQuery({
    queryKey: ["clients", "events", organizationId],
    queryFn: () => readSuiteEvents(organizationId, 120),
    retry: false,
  });

  const record = (clientsQuery.data ?? []).find((client) => client.id === clientId) ?? null;

  const card = useMemo(() => {
    if (!record) return null;
    return (
      buildClientBook(
        {
          clients: [record],
          proposals: proposalsQuery.isError ? null : (proposalsQuery.data ?? []),
          projects: projectsQuery.isError ? null : (projectsQuery.data ?? []),
        },
        now,
      )[0] ?? null
    );
  }, [record, proposalsQuery.data, proposalsQuery.isError, projectsQuery.data, projectsQuery.isError, now]);

  const projects = (projectsQuery.data ?? []).filter((project) => project.clientId === clientId);
  const people = (relationshipsQuery.data ?? []).filter(
    (relationship) => relationship.clientId === clientId,
  );
  const events = (eventsQuery.data ?? [])
    .filter(
      (event) =>
        event.subject.id === clientId ||
        (event.related ?? []).some((related) => related.id === clientId),
    )
    .slice(0, 8);

  if (clientsQuery.isLoading) {
    return (
      <AppShell identity={identity}>
        <p className="text-sm text-muted-foreground">Reading this company.</p>
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
          action={
            <Link to="/modules/clients" className="text-sm font-medium text-royal">
              Back to clients
            </Link>
          }
        />
      </AppShell>
    );
  }

  return (
    <AppShell identity={identity}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Client"
          title={record.name}
          supporting={`${card.commercialLine} · ${card.reviewLine}`}
          appId="clients"
        />

        {card.warnings.length > 0 ? (
          <TTCard className="border-warning/30 bg-warning/8">
            <h2 className="text-sm font-semibold text-foreground">Needs you</h2>
            <ul className="mt-2 space-y-1 text-sm text-foreground">
              {card.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </TTCard>
        ) : null}

        <section>
          <SectionHeading
            eyebrow="Commercial"
            title="What this engagement is"
            description="Recurring value is state on the client record. One-off amounts stay dated events on the roadmap lineage."
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <Fact label="Tier and value" value={card.commercialLine} />
            <Fact label="Review" value={card.reviewLine} />
            <Fact
              label="Renews"
              value={formatDay(record.renewalAt) ?? "No renewal date recorded"}
            />
          </div>
        </section>

        <section>
          <SectionHeading
            eyebrow="Delivery"
            title="What is in flight"
            description="Owned by Projects. This is a read, not a second copy."
          />
          {projectsQuery.isError ? (
            <p className="text-sm text-muted-foreground">Delivery could not be read just now.</p>
          ) : projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">No delivery work is recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {projects.map((project) => (
                <li key={project.id}>
                  <TTCard className="p-4">
                    <p className="text-sm font-medium text-foreground">{project.name}</p>
                    <p className="mt-1 text-[13px] text-muted-foreground">
                      {project.currentWork || project.nextMove || project.pointB}
                    </p>
                    {project.blockedBecause ? (
                      <p className="mt-1 text-[13px] text-warning">
                        Blocked: {project.blockedBecause}
                      </p>
                    ) : null}
                  </TTCard>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <SectionHeading
            eyebrow="People"
            title="Who we know there"
            description="Owned by Comms. One person, one memory."
          />
          {people.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No relationship at this company is tracked yet.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {people.map((person) => (
                <li key={person.id}>
                  <TTCard className="p-4">
                    <p className="text-sm font-medium text-foreground">{person.fullName}</p>
                    <p className="mt-1 text-[13px] text-muted-foreground">
                      {person.nextAction ?? "No next move recorded."}
                    </p>
                  </TTCard>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <SectionHeading
            eyebrow="History"
            title="What has actually happened"
            description="The shared stream, filtered to this company."
          />
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing has been recorded here yet.</p>
          ) : (
            <ol className="space-y-2">
              {events.map((event) => (
                <li key={event.id} className="flex gap-3 text-sm">
                  <span className="w-16 shrink-0 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    {formatDay(event.occurredAt)}
                  </span>
                  <span className="text-muted-foreground">{event.summary}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <TTCard className="p-4">
      <p className="tt-eyebrow">{label}</p>
      <p className="mt-2 text-sm text-foreground">{value}</p>
    </TTCard>
  );
}
