/**
 * The quiet overflow on a milestone card.
 *
 * One primary action stays visible. Everything lower frequency lives here, and
 * only the transitions that are genuinely valid from the current state appear,
 * so the card never offers a contradiction. Choosing one proposes it; a person
 * still confirms on the card.
 */

import { MoreHorizontal } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { milestoneActions } from "@/domain/milestone-actions";
import type { MilestoneStatus, RoadmapMilestone } from "@/domain/roadmap-intel";

export function MilestoneOverflow({
  milestone,
  busy,
  onPick,
  detailOpen = false,
  rankingOpen = false,
  onDetail,
  onRanking,
  onReopen,
}: {
  milestone: RoadmapMilestone;
  busy: boolean;
  onPick: (status: MilestoneStatus) => void;
  /** Ranking and evidence plumbing lives here, never in the everyday scan. */
  detailOpen?: boolean;
  rankingOpen?: boolean;
  onDetail?: (() => void) | undefined;
  onRanking?: (() => void) | undefined;
  /** Only offered on an accepted milestone; still asks for confirmation. */
  onReopen?: (() => void) | undefined;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={busy}
        aria-label={`More actions for ${milestone.name}`}
        className="inline-flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        {milestoneActions(milestone.status).map((action) => (
          <DropdownMenuItem key={action.status} onSelect={() => onPick(action.status)}>
            {action.label}
          </DropdownMenuItem>
        ))}
        {onReopen ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onReopen()}>Reopen milestone</DropdownMenuItem>
          </>
        ) : null}
        {onDetail || onRanking ? <DropdownMenuSeparator /> : null}
        {onDetail ? (
          <DropdownMenuItem onSelect={() => onDetail()}>
            {detailOpen ? "Hide milestone detail" : "Milestone detail"}
          </DropdownMenuItem>
        ) : null}
        {onRanking ? (
          <DropdownMenuItem onSelect={() => onRanking()}>
            {rankingOpen ? "Hide why it ranks here" : "Why it ranks here"}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
