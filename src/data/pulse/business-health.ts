/**
 * The business health metrics, read from the rooms that already own the
 * records, under the signed-in person's own session and row level security.
 *
 * No new store, no second copy of commercial truth, no accounting integration.
 * Where a source does not exist here at all, such as invoices and payments,
 * the metric says it is unavailable rather than drawing an encouraging zero.
 */

import {
  listClientCommercialState,
  listProposalNodes,
  type ClientCommercialRecord,
  type ProposalRecord,
} from "@/data/supabase/commercial-service";
import { projectsService } from "@/data/supabase/projects-service";
import {
  marginReading,
  measured,
  unavailable,
  type HealthMetric,
  type MetricReading,
} from "@/domain/business-health";
import type { ExecutionProject } from "@/domain/projects";
import { isOpenProject } from "@/domain/client-shell";
import type { ID } from "@/domain/entities";

type Read<T> = { ok: true; value: T } | { ok: false; because: string };

async function read<T>(load: () => Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, value: await load() };
  } catch (error) {
    return { ok: false, because: error instanceof Error ? error.message : "The read failed." };
  }
}

function daysBetween(fromIso: string, now: Date): number {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / 86_400_000));
}

function fromClients(
  clients: Read<ClientCommercialRecord[]>,
  when: (value: ClientCommercialRecord[]) => MetricReading,
): MetricReading {
  return clients.ok ? when(clients.value) : unavailable(clients.because);
}

export interface BusinessHealth {
  metrics: HealthMetric[];
  readAt: string;
}

export async function loadBusinessHealth(
  organizationId: ID,
  now: Date = new Date(),
): Promise<BusinessHealth> {
  const [clients, proposals, projects] = await Promise.all([
    read(() => listClientCommercialState(organizationId)),
    read(() => listProposalNodes(organizationId)),
    read<ExecutionProject[]>(() => projectsService.list(organizationId)),
  ]);

  /* Weekly targets carry built-in defaults, and a default is not a target a
     person set. Until an authorized person records one in Settings, Outcomes,
     these metrics carry no target rather than an invented one. */
  const NO_TARGET_SET = "No target recorded. An owner or admin sets these in Settings, Outcomes.";

  const readAt = now.toISOString();
  const readAtFor = (source: Read<unknown>) => (source.ok ? readAt : null);

  const openProposals = proposals.ok
    ? proposals.value.filter(
        (proposal: ProposalRecord) =>
          proposal.proposalSentAt !== null &&
          (proposal.proposalOutcome === null || proposal.proposalOutcome === "open"),
      )
    : [];

  const pipeline: HealthMetric = {
    id: "qualified_pipeline",
    label: "Qualified pipeline",
    question: "How much recorded work is genuinely live?",
    reading: proposals.ok
      ? measured(
          openProposals.reduce(
            (total, proposal) => total + (proposal.proposalAmountCents ?? 0),
            0,
          ),
          { value: openProposals.length, label: "open proposals" },
        )
      : unavailable(proposals.because),
    unit: "money_cents",
    source: "Proposals recorded in Clients",
    period: "Open right now, not a window",
    readAt: readAtFor(proposals),
    drilldownHref: "/modules/clients",
    drilldownLabel: "Clients",
    target: null,
    targetBecause: "No pipeline target has been set by a person.",
  };

  const oldest = openProposals
    .map((proposal) => daysBetween(proposal.proposalSentAt ?? readAt, now))
    .sort((a, b) => b - a)[0];

  const stageAge: HealthMetric = {
    id: "stage_age",
    label: "Oldest undecided proposal",
    question: "How long has the slowest live proposal been waiting?",
    reading: proposals.ok
      ? openProposals.length === 0
        ? measured(0, { value: 0, label: "open proposals" })
        : measured(oldest ?? 0, { value: openProposals.length, label: "open proposals" })
      : unavailable(proposals.because),
    unit: "days",
    source: "Proposal sent dates recorded by a person",
    period: "Since the proposal was recorded as sent",
    readAt: readAtFor(proposals),
    drilldownHref: "/modules/clients",
    drilldownLabel: "Clients",
    target: null,
    targetBecause: "No ageing limit has been agreed.",
  };

  const awaiting: HealthMetric = {
    id: "awaiting_decision",
    label: "Proposals awaiting a decision",
    question: "What is sitting with a client right now?",
    reading: proposals.ok
      ? measured(openProposals.length, {
          value: proposals.value.filter((proposal) => proposal.proposalSentAt !== null).length,
          label: "proposals ever sent",
        })
      : unavailable(proposals.because),
    unit: "count",
    source: "Proposal outcomes recorded by a person",
    period: "Open right now",
    readAt: readAtFor(proposals),
    drilldownHref: "/modules/clients",
    drilldownLabel: "Clients",
    target: null,
    targetBecause: NO_TARGET_SET,
  };

  const openProjects = projects.ok ? projects.value.filter(isOpenProject) : [];
  const capacity: HealthMetric = {
    id: "delivery_load",
    label: "Delivery in flight",
    question: "Can delivery take another client?",
    reading: projects.ok
      ? measured(openProjects.length, {
          value: projects.value.length,
          label: "recorded projects",
        })
      : unavailable(projects.because),
    unit: "count",
    source: "Projects",
    period: "Open right now",
    readAt: readAtFor(projects),
    drilldownHref: "/modules/projects",
    drilldownLabel: "Projects",
    target: null,
    targetBecause: NO_TARGET_SET,
  };

  /* There is no invoice or payment source in this suite. Saying so is the
     honest answer; a zero here would read as "nothing is owed". */
  const receivables: HealthMetric = {
    id: "overdue_receivables",
    label: "Overdue receivables",
    question: "What money is late?",
    reading: unavailable(
      "No invoicing or payment source is connected. Invoiced and paid are not recorded in this suite.",
    ),
    unit: "money_cents",
    source: "Not connected",
    period: "Not available",
    readAt: null,
    drilldownHref: "/modules/clients",
    drilldownLabel: "Clients",
    target: null,
    targetBecause: "No source, so no target.",
  };

  const recurringRevenue = clients.ok
    ? clients.value.reduce<number | null>(
        (total, client) => (client.mrrCents === null ? total : (total ?? 0) + client.mrrCents),
        null,
      )
    : null;

  const margin: HealthMetric = {
    id: "margin",
    label: "Margin where cost exists",
    question: "Are we actually making anything on this work?",
    reading: clients.ok
      ? marginReading({ revenueCents: recurringRevenue, costCents: null })
      : unavailable(clients.because),
    unit: "money_cents",
    source: "Recurring revenue recorded on clients. No cost source recorded.",
    period: "Per month, as currently recorded",
    readAt: readAtFor(clients),
    drilldownHref: "/modules/clients",
    drilldownLabel: "Clients",
    target: null,
    targetBecause: "Margin cannot be targeted while no cost is recorded.",
  };

  const careDue: HealthMetric = {
    id: "care_due",
    label: "Care and renewal due",
    question: "Which accounts are owed a review?",
    reading: fromClients(clients, (records) => {
      const withDate = records.filter((client) => client.nextReviewAt || client.renewalAt);
      const due = withDate.filter((client) => {
        const date = client.nextReviewAt ?? client.renewalAt!;
        return new Date(date).getTime() <= now.getTime();
      });
      return measured(due.length, { value: withDate.length, label: "accounts with a date" });
    }),
    unit: "count",
    source: "Review and renewal dates recorded on clients",
    period: "Due on or before today",
    readAt: readAtFor(clients),
    drilldownHref: "/modules/clients",
    drilldownLabel: "Clients",
    target: null,
    targetBecause: "A review date is a commitment, not a target.",
  };

  return {
    readAt,
    metrics: [pipeline, stageAge, awaiting, capacity, receivables, margin, careDue],
  };
}
