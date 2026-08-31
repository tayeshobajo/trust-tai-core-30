/**
 * The conversation, shown inside Scout.
 *
 * What was actually said, with the person who said it. Read-only: Comms owns
 * the relationship, so every reply, draft and send happens there.
 */

import { Link } from "@tanstack/react-router";

import { TTButton } from "@/components/tt/primitives";
import type { ProspectConversation } from "@/data/scout/conversation";

import { DetailSection, Empty, relativeTime } from "./parts";

function line(message: { subject?: string; snippet?: string; bodyText?: string }): string {
  const text = message.snippet?.trim() || message.bodyText?.trim() || "";
  return text.length > 320 ? `${text.slice(0, 320)}…` : text || "No preview stored.";
}

export function ConversationTab({
  conversations,
  loading,
  companyName,
}: {
  conversations: ProspectConversation[];
  loading: boolean;
  companyName: string;
}) {
  if (loading) {
    return (
      <DetailSection title="Conversation" meta="reading Comms">
        <p className="text-[13px] text-muted-foreground">Opening the thread…</p>
      </DetailSection>
    );
  }

  if (conversations.length === 0) {
    return (
      <DetailSection title="Conversation" meta="nothing yet">
        <Empty>
          No one at {companyName} is in Comms yet. Save a person on this company and their first
          message is prepared there.
        </Empty>
      </DetailSection>
    );
  }

  return (
    <div className="space-y-6">
      {conversations.map(({ relationship, messages, lastMessageAt }) => (
        <DetailSection
          key={relationship.id}
          title={relationship.fullName}
          meta={
            lastMessageAt
              ? `${messages.length} message${messages.length === 1 ? "" : "s"} · ${relativeTime(lastMessageAt)}`
              : "no messages yet"
          }
          action={
            <TTButton asChild variant="quiet" size="sm">
              <Link to="/modules/comms" search={{ relationship: relationship.id }}>
                Open in Comms
              </Link>
            </TTButton>
          }
        >
          {messages.length === 0 ? (
            <Empty>
              This conversation is open in Comms, but nothing has been exchanged yet.
            </Empty>
          ) : (
            <ol className="space-y-3">
              {[...messages].reverse().map((message) => (
                <li
                  key={message.id}
                  className="border-b border-border pb-3 last:border-b-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[13px] font-medium text-foreground">
                      {message.direction === "outbound"
                        ? "Trust Tai"
                        : (message.fromName ?? relationship.fullName)}
                      <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        {message.direction === "outbound" ? "sent" : "received"}
                      </span>
                    </p>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {relativeTime(message.occurredAt)}
                    </span>
                  </div>
                  {message.subject ? (
                    <p className="mt-1 text-[13px] text-foreground">{message.subject}</p>
                  ) : null}
                  <p className="mt-1 whitespace-pre-line text-[13px] text-muted-foreground">
                    {line(message)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </DetailSection>
      ))}
    </div>
  );
}
