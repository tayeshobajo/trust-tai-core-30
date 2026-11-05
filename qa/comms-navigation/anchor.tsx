/** Local-only delayed-layout reproduction. No identity, backend or provider calls. */
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ConversationRoom } from "../../src/components/tt/comms/conversation-room";
import type { ConversationDay } from "../../src/data/comms-timeline";
import type { Relationship } from "../../src/domain/comms";
import type { ConversationHealth } from "../../src/domain/comms-health";
import "../../src/styles.css";
import "../../src/components/tt/comms/comms-workspace.css";
const person = {
  id: "fixture",
  fullName: "Fictional correspondent",
  companyName: "Example",
  stage: "client",
  intent: "explore",
  metadata: {},
} as Relationship;
const health = { status: "healthy", because: "Fictional QA only" } as ConversationHealth;
function Fixture() {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const timers = [1, 2, 3].map((n) => setTimeout(() => setStage(n), n * 1200));
    return () => timers.forEach(clearTimeout);
  }, []);
  const events = [
    ...(stage >= 1
      ? [
          {
            id: "before",
            kind: "they_emailed",
            messageId: "before",
            title: "Delayed earlier history",
            occurredAt: "2026-11-05T08:00:00Z",
            body: "Earlier fictional message.\n".repeat(stage >= 3 ? 75 : 12),
          },
        ]
      : []),
    {
      id: "target",
      kind: "they_emailed",
      messageId: "target",
      title: "Deep-link target · fictional",
      occurredAt: "2026-11-05T09:00:00Z",
      body: "This beginning must remain visible as history grows above it and the draft panel shrinks the pane.\n".repeat(
        8,
      ),
    },
    {
      id: "after",
      kind: "we_emailed",
      messageId: "after",
      title: "Later fictional message",
      occurredAt: "2026-11-05T10:00:00Z",
      body: "Later content.\n".repeat(30),
    },
  ];
  const days = [{ key: "2026-11-05", label: "Today", events }] as ConversationDay[];
  return (
    <div data-shell-appearance="comms">
      <div className="comms-workspace" style={{ paddingTop: 12 }}>
        <p>LOCAL FICTIONAL QA · stage {stage}/3 · no reads or writes</p>
        <div
          className="comms-card"
          style={{ height: "calc(100dvh - 70px)", maxWidth: 900, margin: "12px auto" }}
        >
          <ConversationRoom
            relationship={person}
            health={health}
            days={days}
            focusMessageId="target"
            historyLoading={stage < 1}
            onViewProfile={() => {}}
          >
            {stage >= 2 ? (
              <div style={{ padding: 24, minHeight: 150, borderTop: "1px solid #ccc" }}>
                Delayed saved-draft panel · fictional and inert
              </div>
            ) : null}
          </ConversationRoom>
        </div>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
