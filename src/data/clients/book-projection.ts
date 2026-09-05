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
 * passes `available: false` and the affected line says so.
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
  /** Logo per client id, when a canonical image is recorded. */
  logos?: Record<ID, string | null>;
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

/** The book, ordered. Reads only; nothing here writes or infers state. */
export function buildClientBook(sources: ClientBookSources, now: Date): ClientCard[] {
  const projectsByClient = new Map<ID, ExecutionProject[]>();
  for (const project of sources.projects ?? []) {
    if (!project.clientId) continue;
    const bucket = projectsByClient.get(project.clientId) ?? [];
    bucket.push(project);
    projectsByClient.set(project.clientId, bucket);
  }

  const openProposalByClient = new Map<ID, ProposalRecord>();
  for (const proposal of sources.proposals ?? []) {
    if (!proposal.clientId) continue;
    if (proposal.proposalOutcome !== null && proposal.proposalOutcome !== "open") continue;
    const existing = openProposalByClient.get(proposal.clientId);
    if (!existing || (proposal.proposalSentAt ?? "") > (existing.proposalSentAt ?? "")) {
      openProposalByClient.set(proposal.clientId, proposal);
    }
  }

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
      logoUrl: sources.logos?.[client.id] ?? null,
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
    return deriveClientCard(input, now);
  });

  return sortClientCards(cards);
}
