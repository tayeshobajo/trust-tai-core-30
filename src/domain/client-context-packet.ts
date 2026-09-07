/**
 * The bounded context packet Client Chat reasons over.
 *
 * Chat is how a person talks to the account. It is not a second copy of the
 * workspace, so it never receives a raw dump of every subsystem. This module
 * composes one small, honest picture from reads the page already made:
 * identity and commercial state, the people we know, the projects and where
 * they are, direction as read-only context, genuinely linked account sources,
 * what needs attention, and the recent account events.
 *
 * What it never carries: raw message bodies from Comms, file bytes, anything
 * from a room that could not be read presented as an absence, or a fact no
 * person recorded. A room that failed says so inside the packet, so an answer
 * can say "that could not be read" instead of "there is none".
 */

import type { ActivityEvent } from "./activity";
import type { ClientLinkedSource } from "./client-linked-sources";
import type { AttentionItem } from "./client-overview";
import type { RelationshipSnapshot, RoadmapOutcome, RoomRead } from "./client-shell";
import { isOpenProject, projectStateLabel } from "./client-shell";
import type { ExecutionProject } from "./projects";

/** How much of each list the packet will ever carry. Small input, on purpose. */
export const PACKET_LIMITS = { people: 12, projects: 12, sources: 12, activity: 12 } as const;

export interface ClientPacketIdentity {
  clientId: string;
  name: string;
  websiteUrl: string | null;
}

export interface ClientPacketCommercial {
  /** `Run · $3,500/mo`, already composed by the client book. */
  headline: string;
  review: string;
  renewal: string;
  provenance: string;
}

export interface ClientPacketInput {
  identity: ClientPacketIdentity;
  commercial: ClientPacketCommercial;
  projects: RoomRead<ExecutionProject[]> | null;
  relationship: RoomRead<RelationshipSnapshot> | null;
  roadmap: RoomRead<RoadmapOutcome[]> | null;
  sources: RoomRead<ClientLinkedSource[]> | null;
  history: RoomRead<ActivityEvent[]> | null;
  attention: AttentionItem[];
}

export interface ClientContextPacket {
  client: { name: string; website: string | null; commercial: ClientPacketCommercial };
  people: string[] | { unreadable: string };
  projects:
    | { id: string; name: string; state: string; open: boolean; nextMove: string | null }[]
    | { unreadable: string };
  direction: string[] | { unreadable: string };
  sources: string[] | { unreadable: string };
  attention: string[];
  recentActivity: string[] | { unreadable: string };
  /** Said in the packet itself so an answer never claims it can act. */
  boundaries: string[];
}

export const PACKET_BOUNDARIES = [
  "This is the account view. Project execution is operated in the project workspace.",
  "Roadmap owns direction. It is read here, never changed here.",
  "Comms owns messages. Raw message text is not in this packet and nothing can be sent from here.",
  "The only change that can be prepared here is commercial: monthly amount, renewal date, next review date. A person still approves it.",
];

function read<T, R>(source: RoomRead<T> | null, map: (value: T) => R): R | { unreadable: string } {
  if (source === null) return { unreadable: "Not read yet." };
  if (!source.available) return { unreadable: source.because };
  return map(source.value);
}

/** Compose the packet. Pure: it reads what the page already has and nothing else. */
export function clientContextPacket(input: ClientPacketInput): ClientContextPacket {
  return {
    client: {
      name: input.identity.name,
      website: input.identity.websiteUrl,
      commercial: input.commercial,
    },
    people: read(input.relationship, (snapshot) =>
      snapshot.people
        .slice(0, PACKET_LIMITS.people)
        .map(
          (person) =>
            `${person.fullName} · ${person.stageLabel}${
              person.lastTouchAt ? ` · last touch ${person.lastTouchAt.slice(0, 10)}` : ""
            }${person.overdue ? " · follow-up past due" : ""}${
              person.nextAction ? ` · next: ${person.nextAction}` : ""
            }`,
        ),
    ),
    projects: read(input.projects, (projects) =>
      projects.slice(0, PACKET_LIMITS.projects).map((project) => ({
        id: project.id,
        name: project.name,
        state: projectStateLabel(project),
        open: isOpenProject(project),
        nextMove: project.nextMove?.trim() || null,
      })),
    ),
    direction: read(input.roadmap, (outcomes) =>
      outcomes.map(
        (outcome) =>
          `${outcome.title} · ${outcome.statusLabel} · Point B: ${
            outcome.destination ?? "not written yet"
          }${outcome.milestone ? ` · milestone: ${outcome.milestone}` : ""}`,
      ),
    ),
    sources: read(input.sources, (sources) =>
      sources
        .slice(0, PACKET_LIMITS.sources)
        .map((source) => `${source.title} · ${source.kindLabel} · ${source.url}`),
    ),
    attention: input.attention.map(
      (item) => `${item.line}${item.because ? ` · ${item.because}` : ""}`,
    ),
    recentActivity: read(input.history, (events) =>
      events
        .slice(0, PACKET_LIMITS.activity)
        .map((event) => `${event.occurredAt.slice(0, 10)} · ${event.summary}`),
    ),
    boundaries: PACKET_BOUNDARIES,
  };
}
