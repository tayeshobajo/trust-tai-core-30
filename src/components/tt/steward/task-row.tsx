import { GripVertical, Bot, MoreHorizontal, User } from "lucide-react";
import type { DragEvent } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  STEWARD_FOCUS_LABEL,
  STEWARD_FOCUS_TONE,
  STEWARD_STATE_LABEL,
  STEWARD_STATE_TONE,
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
        {agent ? <Bot className="size-3.5" /> : unowned ? <User className="size-3.5" /> : task.owner.initials}
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
  selected,
  onSelect,
  onOpen,
  onComplete,
  onReassign,
  onDragStart,
  onDragOver,
  onDrop,
  showSelect = false,
}: {
  task: StewardTask;
  selected?: boolean;
  onSelect?: (checked: boolean) => void;
  onOpen: () => void;
  onComplete: () => void;
  onReassign: () => void;
  onDragStart?: (event: DragEvent<HTMLLIElement>) => void;
  onDragOver?: (event: DragEvent<HTMLLIElement>) => void;
  onDrop?: (event: DragEvent<HTMLLIElement>) => void;
  showSelect?: boolean;
}) {
  const done = task.state === "complete";
  const canComplete = task.completionPath === "steward" && !done;

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
        <Checkbox
          aria-label={
            canComplete ? `Mark ${task.title} complete` : `${task.title} is completed elsewhere`
          }
          checked={done}
          disabled={!canComplete}
          onCheckedChange={() => canComplete && onComplete()}
        />
      )}

      <span
        aria-hidden
        className={cn(
          "cursor-grab text-muted-foreground/50 transition-opacity",
          onDragStart ? "opacity-0 group-hover:opacity-100" : "invisible",
        )}
      >
        <GripVertical className="size-4" />
      </span>

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
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => onOpen()}>Open detail</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onReassign()}>Reassign</DropdownMenuItem>
          {canComplete ? (
            <DropdownMenuItem onSelect={() => onComplete()}>Mark complete</DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Narrow screens keep the essentials visible without horizontal scroll. */}
      <div className="col-span-4 -mt-1 flex flex-wrap items-center gap-2 pl-[3.25rem] sm:hidden">
        <Pill className={STEWARD_FOCUS_TONE[task.focus]}>{STEWARD_FOCUS_LABEL[task.focus]}</Pill>
        <Pill className={STEWARD_STATE_TONE[task.state]}>{STEWARD_STATE_LABEL[task.state]}</Pill>
        <span className="text-xs text-muted-foreground">
          {task.owner.name}
          {task.dueAt ? ` · ${task.dueAt.slice(0, 10)}` : ""}
        </span>
      </div>
    </li>
  );
}
