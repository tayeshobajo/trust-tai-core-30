/** Fictional local reproduction of approved activity absent from mailbox storage. */
import React from "react";
import { createRoot } from "react-dom/client";
import { ConversationRoom } from "../../src/components/tt/comms/conversation-room";
import { RelationshipSummary } from "../../src/components/tt/comms/relationship-summary";
import { conversationTimeline, groupByDay } from "../../src/data/comms-timeline";
import {
  withApprovedCorrespondence,
  type ApprovedCorrespondenceFact,
} from "../../src/domain/comms-approved-correspondence";
import { event, org, relationship } from "../../src/domain/roadmap-correspondence.fixtures";
import type { Relationship } from "../../src/domain/comms";
import type { ConversationHealth } from "../../src/domain/comms-health";
import "../../src/styles.css";
import "../../src/components/tt/comms/comms-workspace.css";
const person = {
  id: relationship,
  fullName: "Fictional approved correspondent",
  stage: "client",
  intent: "explore",
  metadata: {},
} as Relationship;
const base = {
  relationshipId: relationship,
  status: "quiet",
  score: 50,
  nextMoveStatus: "none",
  waitingOn: "no_next_move",
  reasons: ["No activity recorded"],
} as ConversationHealth;
const facts = [
  { kind: "received", occurredAt: "2026-10-21T10:00:00Z" },
  { kind: "sent", occurredAt: "2026-10-21T11:00:00Z" },
  { kind: "sent", occurredAt: "2026-10-22T12:00:00Z" },
].map((f, i) => ({
  eventKey: String(i).repeat(64),
  organizationId: org,
  relationshipId: relationship,
  roadmapId: event.roadmapId,
  channel: "email",
  sourceAccountRef: "fictional@example.test",
  sourceEventId: `fixture-${i}`,
  identityKind: "provider_id",
  timestampPrecision: "exact",
  ...f,
})) as ApprovedCorrespondenceFact[];
const health = withApprovedCorrespondence(base, facts, [], new Date("2026-11-05T12:00:00Z"));
const noop = () => {};
createRoot(document.getElementById("root")!).render(
  <div data-shell-appearance="comms">
    <div className="comms-workspace" style={{ paddingTop: 20 }}>
      <p>FICTIONAL LOCAL QA · approved metadata only · no reads or writes</p>
      <p>No verified thread linkage. Outgoing records do not resolve unrelated incoming records.</p>
      <div
        className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]"
        style={{ marginTop: 20 }}
      >
        <section className="comms-card" style={{ height: 650 }}>
          <ConversationRoom
            relationship={person}
            health={health}
            days={groupByDay(conversationTimeline([], [], [], facts))}
            onViewProfile={noop}
          />
        </section>
        <RelationshipSummary
          relationship={person}
          health={health}
          onContext={noop}
          onProfile={noop}
          onInteraction={noop}
        />
      </div>
    </div>
  </div>,
);
