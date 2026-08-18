import { Link } from "@tanstack/react-router";

import { MetaPill } from "@/components/tt/primitives";
import type { StoredConversation } from "@/data/supabase/steward-service";
import type { Commitment } from "@/domain/steward";

function durationOf(conversation: StoredConversation): string | null {
  const segments = conversation.conversation?.segments ?? [];
  const last = segments[segments.length - 1];
  if (!last?.at) return null;
  const parts = last.at.split(":").map((value) => Number(value));
  if (parts.some((value) => Number.isNaN(value))) return null;
  const minutes =
    parts.length === 3
      ? Math.round((parts[0]! * 3600 + parts[1]! * 60 + parts[2]!) / 60)
      : Math.round(((parts[0] ?? 0) * 60 + (parts[1] ?? 0)) / 60);
  return minutes > 0 ? `${minutes} min` : null;
}

/**
 * Three most recent conversations, with only counts Steward can actually
 * evidence: confirmed commitments carried out of each call.
 */
export function RecentMeetings({
  conversations,
  commitments,
}: {
  conversations: StoredConversation[];
  commitments: Commitment[];
}) {
  const recent = conversations.slice(0, 3);
  if (recent.length === 0) return null;

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-3">
        <h2 className="tt-eyebrow">Recent meetings</h2>
        <Link to="/modules/steward/meetings" className="text-sm text-royal hover:underline">
          View all meetings
        </Link>
      </div>
      <ul className="grid gap-3 sm:grid-cols-3">
        {recent.map((conversation) => {
          const linked = commitments.filter((row) => row.conversationId === conversation.id);
          const duration = durationOf(conversation);
          return (
            <li key={conversation.id} className="tt-surface flex flex-col p-5">
              <p className="font-display text-base leading-snug text-foreground">
                {conversation.title}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {conversation.occurredAt.slice(0, 10)}
                {duration ? ` · ${duration}` : ""}
                {conversation.participants.length > 0
                  ? ` · ${conversation.participants.length} people`
                  : ""}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <MetaPill>
                  {linked.length} commitment{linked.length === 1 ? "" : "s"}
                </MetaPill>
              </div>
              <Link
                to="/modules/steward/meetings/$conversationId"
                params={{ conversationId: conversation.id }}
                className="mt-4 text-sm text-royal hover:underline"
              >
                Open meeting
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
