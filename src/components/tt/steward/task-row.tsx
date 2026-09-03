import { GripVertical, Bot, MoreHorizontal, User } from "lucide-react";
import type { DragEvent } from "react";

import { completeAuthority, reassignAuthority, type StewardActor } from "@/data/steward/authority";

import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  STEWARD_FOCUS_LABEL,
  STEWARD_FOCUS_TONE,
  STEWARD_STATE_LABEL,
  STEWARD_STATE_TONE,
  type StewardAgent,
  type StewardTask,
} from "@/domain/steward-accountability";
import { cn } from "@/lib/utils";

function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function OwnerBadge({ task }: { task: StewardTask }) {
  const agent = task.owner.kind === "agent";
  const unowned = task.owner.kind === "unowned";
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium",
          agent
            ? "border-royal/30 bg-royal/10 text-royal"
            : unowned
              ? "border-dashed border-border bg-secondary text-muted-foreground"
              : "border-border bg-secondary text-foreground",
        )}
      >
        {agent ? (
          <Bot className="size-3.5" />
        ) : unowned ? (
          <User className="size-3.5" />
        ) : (
          task.owner.initials
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm text-foreground">{task.owner.name}</span>
        <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {agent ? "AI agent" : unowned ? "Unassigned" : "Team"}
        </span>
      </span>
    </span>
  );
}

/**
 * One accountability row. The checkbox only completes work Steward is allowed
 * to complete; everything else routes to the room that owns the truth.
 */
export function TaskRow({
  task,
  actor,
  selected,
  onSelect,
  onOpen,
  onComplete,
  onReassign,
  onAssignAgent,
  eligibleAgents,
  onDragStart,
  onDragOver,
  onDrop,
  onMoveUp,
  onMoveDown,
  position,
  total,
  showSelect = false,
}: {
  task: StewardTask;
  /** Who is looking. Decides what this row may offer, and what it explains. */
  actor: StewardActor;
  selected?: boolean;
  onSelect?: (checked: boolean) => void;
  onOpen: () => void;
  onComplete: () => void;
  onReassign: () => void;
  /** Called when Tai picks a specific agent from the row dropdown directly. */
  onAssignAgent?: (agent: StewardAgent) => void;
  /** Agents eligible to take this specific task. Empty = no agent shortcut shown. */
  eligibleAgents?: StewardAgent[];
  onDragStart?: (event: DragEvent<HTMLLIElement>) => void;
  onDragOver?: (event: DragEvent<HTMLLIElement>) => void;
  onDrop?: (event: DragEvent<HTMLLIElement>) => void;
  /** Keyboard equivalents of dragging this row up or down the checklist. */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /** 1-based place in the visible checklist, spoken to screen readers. */
  position?: number;
  total?: number;
  showSelect?: boolean;
}) {
  const done = task.state === "complete";
  const canFinish = completeAuthority(task, actor);
  const canReassign = reassignAuthority(task, actor);
  const canComplete = canFinish.allowed;

  return (
    <li
      draggable={Boolean(onDragStart)}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        "group grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3 py-3 last:border-b-0 sm:grid-cols-[auto_auto_minmax(0,1fr)_170px_150px_110px_120px_auto] sm:gap-4",
        task.overdue && !done ? "bg-destructive/[0.03]" : null,
      )}
    >
      {showSelect ? (
        <Checkbox
          aria-label={`Select ${task.title}`}
          checked={Boolean(selected)}
          onCheckedChange={(value) => onSelect?.(value === true)}
        />
      ) : (
        <span title={canFinish.because ?? undefined} className="inline-flex">
          <Checkbox
            aria-label={
              canComplete
                ? `Mark ${task.title} complete`
                : `Cannot complete ${task.title}. ${canFinish.because ?? ""}`.trim()
            }
            aria-describedby={canComplete ? undefined : `${task.key}-why-not`}
            checked={done}
            disabled={!canComplete}
            onCheckedChange={() => canComplete && onComplete()}
          />
          {canComplete ? null : (
            <span id={`${task.key}-why-not`} className="sr-only">
              {canFinish.because}
            </span>
          )}
        </span>
      )}

      {onMoveUp || onMoveDown ? (
        <button
          type="button"
          aria-label={
            `Reorder ${task.title}` +
            (position && total ? `, position ${position} of ${total}` : "") +
            ". Press the up or down arrow key to move it."
          }
          aria-keyshortcuts="ArrowUp ArrowDown"
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" && onMoveUp) {
              event.preventDefault();
              onMoveUp();
            }
            if (event.key === "ArrowDown" && onMoveDown) {
              event.preventDefault();
              onMoveDown();
            }
          }}
          className="cursor-grab rounded text-muted-foreground/50 opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
        >
          <GripVertical aria-hidden className="size-4" />
        </button>
      ) : (
        <span
          aria-hidden
          className={cn(
            "text-muted-foreground/50",
            onDragStart ? "opacity-0 group-hover:opacity-100" : "invisible",
          )}
        >
          <GripVertical className="size-4" />
        </span>
      )}

      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className={cn(
            "block truncate text-sm text-foreground",
            done ? "text-muted-foreground line-through" : null,
          )}
        >
          {task.title}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {task.sourceLabel}
        </span>
      </button>

      <div className="hidden min-w-0 sm:block">
        <OwnerBadge task={task} />
      </div>

      <div className="hidden sm:block">
        <Pill className={STEWARD_FOCUS_TONE[task.focus]}>{STEWARD_FOCUS_LABEL[task.focus]}</Pill>
      </div>

      <div className="hidden text-xs text-muted-foreground sm:block">
        {task.dueAt ? (
          <span className={cn(task.overdue && !done ? "text-destructive" : undefined)}>
            {task.dueAt.slice(0, 10)}
          </span>
        ) : (
          <span className="text-muted-foreground/60">No date</span>
        )}
      </div>

      <div className="hidden sm:block">
        <Pill className={STEWARD_STATE_TONE[task.state]}>{STEWARD_STATE_LABEL[task.state]}</Pill>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Actions for ${task.title}`}
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => onOpen()}>Open detail</DropdownMenuItem>
          <DropdownMenuItem disabled={!canReassign.allowed} onSelect={() => onReassign()}>
            Reassign
          </DropdownMenuItem>
          {canReassign.allowed ? null : (
            <p className="px-2 py-2 text-xs text-muted-foreground">{canReassign.because}</p>
          )}
          {canReassign.allowed && eligibleAgents && eligibleAgents.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <p className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Assign to agent
              </p>
              {eligibleAgents.map((agent) => (
                <DropdownMenuItem
                  key={agent.id}
                  onSelect={() => onAssignAgent?.(agent)}
                  className="gap-2"
                >
                  <Bot aria-hidden className="size-3.5 text-royal" />
                  {agent.name}
                </DropdownMenuItem>
              ))}
            </>
          ) : null}
          {onMoveUp ? (
            <DropdownMenuItem onSelect={() => onMoveUp()}>Move up</DropdownMenuItem>
          ) : null}
          {onMoveDown ? (
            <DropdownMenuItem onSelect={() => onMoveDown()}>Move down</DropdownMenuItem>
          ) : null}
          {canComplete ? (
            <DropdownMenuItem onSelect={() => onComplete()}>Mark complete</DropdownMenuItem>
          ) : (
            <p className="px-2 py-2 text-xs text-muted-foreground">{canFinish.because}</p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Narrow screens keep the essentials visible without horizontal scroll:
          assignee, due and status stay, in the same words as the wide table. */}
      <div className="col-span-4 -mt-1 space-y-1.5 pl-[3.25rem] sm:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <Pill className={STEWARD_FOCUS_TONE[task.focus]}>{STEWARD_FOCUS_LABEL[task.focus]}</Pill>
          <Pill className={STEWARD_STATE_TONE[task.state]}>{STEWARD_STATE_LABEL[task.state]}</Pill>
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="text-foreground">{task.owner.name}</span>
          <span aria-hidden>·</span>
          <span className={cn(task.overdue && !done ? "text-destructive" : undefined)}>
            {task.dueAt ? `Due ${task.dueAt.slice(0, 10)}` : "No date"}
          </span>
        </p>
      </div>
    </li>
  );
}
