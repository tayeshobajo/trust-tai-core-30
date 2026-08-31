/**
 * The way back to Scout.
 *
 * A relationship that came from a Scout company keeps that thread: the same
 * messages are the company's conversation in Scout, so Comms links straight
 * to it instead of making anyone search for the company again.
 */

import { Link } from "@tanstack/react-router";

import type { Relationship } from "@/domain/comms";
import { cn } from "@/lib/utils";

export function scoutProspectIdOf(relationship: Relationship): string | null {
  return relationship.prospectId ?? null;
}

export function ScoutConversationLink({
  relationship,
  className,
}: {
  relationship: Relationship;
  className?: string;
}) {
  const prospectId = scoutProspectIdOf(relationship);
  if (!prospectId) return null;

  return (
    <Link
      to="/modules/scout/prospects/$prospectId"
      params={{ prospectId }}
      search={{ tab: "conversation" }}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-[var(--royal)] hover:text-foreground",
        className,
      )}
    >
      Scout{relationship.companyName ? ` · ${relationship.companyName}` : ""} →
    </Link>
  );
}
