/**
 * The Clients book projection.
 *
 * Clients owns no new state. This file assembles the book from three sources
 * that already exist and already own their own truth:
 *
 *   * canonical client commercial state (`clients`)
 *   * the proposal on the prospect -> roadmap lineage (`roadmaps`)
 *   * one delivery line per company, in Projects' words (`projects`)
 *
 * A source that could not be read is never shown as a healthy zero: the caller
 * passes `null` for that source and the affected line says so.
 */

import type { ClientCommercialRecord, ProposalRecord } from "@/data/supabase/commercial-service";
import {
  deriveClientCard,
  sortClientCards,
  type ClientBookInput,
  type ClientCard,
  type ClientDeliveryProjection,
} from "@/domain/clients-book";
import type { ID } from "@/domain/entities";
import type { ExecutionProject } from "@/domain/projects";

export interface ClientBookSources {
  clients: ClientCommercialRecord[];
  /** Proposals, or null when the lineage could not be read. */
  proposals: ProposalRecord[] | null;
  /** Projects, or null when delivery could not be read. */
  projects: ExecutionProject[] | null;
}

const BLOCKED_STATES = new Set(["blocked"]);

/**
 * One line per company: what delivery is actually doing right now.
 *
 * Blocked work always wins the line, because a blocked engagement is the thing
 * a person needs to see. Otherwise the most recently moved project speaks.
 */
export function deliveryLineFor(projects: ExecutionProject[]): ClientDeliveryProjection | null {
  if (projects.length === 0) return null;
  const blocked = projects.filter((project) => BLOCKED_STATES.has(project.state));
  if (blocked.length > 0) {
    const first = [...blocked].sort((a, b) => a.lastMovedAt.localeCompare(b.lastMovedAt))[0]!;
    return {
      line: first.blockedBecause
        ? `${first.name} is blocked: ${first.blockedBecause}`
        : `${first.name} is blocked`,
      blocked: true,
    };
  }
  const latest = [...projects].sort((a, b) => b.lastMovedAt.localeCompare(a.lastMovedAt))[0]!;
  const detail = latest.currentWork || latest.nextMove || null;
  return { line: detail ? `${latest.name} · ${detail}` : latest.name, blocked: false };
}

/** The open proposal per client, newest sending wins. */
export function openProposalsByClient(proposals: ProposalRecord[]): Map<ID, ProposalRecord> {
  const open = new Map<ID, ProposalRecord>();
  for (const proposal of proposals) {
    if (!proposal.clientId) continue;
    if (proposal.proposalOutcome !== null && proposal.proposalOutcome !== "open") continue;
    const existing = open.get(proposal.clientId);
    if (!existing || (proposal.proposalSentAt ?? "") > (existing.proposalSentAt ?? "")) {
      open.set(proposal.clientId, proposal);
    }
  }
  return open;
}

/**
 * The book, ordered. Reads only; nothing here writes or infers state. Every
 * day on every card is a day in `timeZone`, the organization's own.
 */
export function buildClientBook(
  sources: ClientBookSources,
  now: Date,
  timeZone: string,
): ClientCard[] {
  const projectsByClient = new Map<ID, ExecutionProject[]>();
  for (const project of sources.projects ?? []) {
    if (!project.clientId) continue;
    const bucket = projectsByClient.get(project.clientId) ?? [];
    bucket.push(project);
    projectsByClient.set(project.clientId, bucket);
  }

  const openProposalByClient = openProposalsByClient(sources.proposals ?? []);

  const cards = sources.clients.map((client) => {
    const proposal = openProposalByClient.get(client.id) ?? null;
    const delivery =
      sources.projects === null
        ? { line: "Delivery could not be read just now.", blocked: false }
        : deliveryLineFor(projectsByClient.get(client.id) ?? []);

    const input: ClientBookInput = {
      id: client.id,
      name: client.name,
      tier: client.tier,
      mrrCents: client.mrrCents,
      renewalAt: client.renewalAt,
      nextReviewAt: client.nextReviewAt,
      websiteUrl: client.websiteUrl,
      logoUrl: client.logoUrl,
      delivery,
      proposal: proposal
        ? {
            amountCents: proposal.proposalAmountCents,
            sentAt: proposal.proposalSentAt,
            tier: null,
            open: true,
          }
        : null,
    };
    return deriveClientCard(input, now, timeZone);
  });

  return sortClientCards(cards);
}
