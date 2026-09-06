/**
 * Externally linked working documents, shown on a client's Files tab.
 *
 * A linked source is a URL a person saved on a project: a Google Doc, a Google
 * Sheet, a Figma prototype, a staging site. It is not an uploaded file and it
 * never pretends to be one. Projects still owns it; this module only reads the
 * two canonical stores (`project_thinking_sources` and `project_connections`)
 * and presents them together, honestly labelled.
 */

import {
  CONNECTION_STATUS_LABEL,
  CONNECTION_TYPE_LABEL,
  SOURCE_SYNC_LABEL,
  THINKING_SOURCE_LABEL,
  type ProjectConnection,
  type ThinkingSource,
} from "./project-intelligence";
import type { ID, ISODateTime } from "./entities";

export interface ClientLinkedSource {
  id: ID;
  projectId: ID;
  title: string;
  url: string;
  /** Where it lives, in plain words: Google Doc, Figma, Staging. */
  kindLabel: string;
  /** What the OS can honestly do with it right now. */
  stateLabel: string;
  /** Which canonical store holds it, so nothing is duplicated later. */
  store: "thinking" | "connection";
  addedAt: ISODateTime;
}

function timeOf(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Compose the two stores into one honest list, newest first. A connection with
 * no URL is not a linked source, so it is left out rather than shown empty.
 */
export function linkedSourcesFrom(
  thinking: ThinkingSource[],
  connections: ProjectConnection[],
): ClientLinkedSource[] {
  const fromThinking: ClientLinkedSource[] = thinking
    .filter((source) => Boolean(source.url?.trim()))
    .map((source) => ({
      id: source.id,
      projectId: source.projectId,
      title: source.title,
      url: source.url,
      kindLabel: THINKING_SOURCE_LABEL[source.sourceType],
      stateLabel: SOURCE_SYNC_LABEL[source.syncState],
      store: "thinking" as const,
      addedAt: source.createdAt,
    }));

  const fromConnections: ClientLinkedSource[] = connections
    .filter((connection) => Boolean(connection.url?.trim()))
    .map((connection) => ({
      id: connection.id,
      projectId: connection.projectId,
      title: connection.label,
      url: connection.url as string,
      kindLabel: CONNECTION_TYPE_LABEL[connection.connectionType],
      stateLabel: CONNECTION_STATUS_LABEL[connection.status],
      store: "connection" as const,
      addedAt: connection.createdAt,
    }));

  return [...fromThinking, ...fromConnections].sort(
    (left, right) => timeOf(right.addedAt) - timeOf(left.addedAt),
  );
}
