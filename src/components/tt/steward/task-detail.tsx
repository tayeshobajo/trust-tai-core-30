import { ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { MetaPill, TTButton } from "@/components/tt/primitives";
import { OwnerBadge } from "@/components/tt/steward/task-row";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  STEWARD_FOCUS_LABEL,
  STEWARD_FOCUS_ORDER,
  STEWARD_STATE_LABEL,
  type StewardFocus,
  type StewardTask,
} from "@/domain/steward-accountability";

/**
 * A task, opened beside the checklist rather than on a page of its own. It
 * shows where the task came from, why it is a priority and who can act.
 */
export function TaskDetailPanel({
  task,
  onClose,
  onComplete,
  onReassign,
  onFocus,
  onDue,
  canAct,
}: {
  task: StewardTask | null;
  onClose: () => void;
  onComplete: (note: string) => void;
  onReassign: () => void;
  onFocus: (focus: StewardFocus) => void;
  onDue: (due: string | null) => void;
  canAct: boolean;
}) {
  const [note, setNote] = useState("");

  if (!task) return null;
  const canComplete = canAct && task.completionPath === "steward" && task.state !== "complete";

  return (
    <Sheet open onOpenChange={(open) => (open ? null : onClose())}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="space-y-3 text-left">
          <p className="tt-eyebrow">Task</p>
          <SheetTitle className="font-display text-2xl leading-snug text-foreground">
            {task.title}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <MetaPill>{STEWARD_STATE_LABEL[task.state]}</MetaPill>
            <MetaPill>{STEWARD_FOCUS_LABEL[task.focus]}</MetaPill>
            {task.dueAt ? <MetaPill>Due {task.dueAt.slice(0, 10)}</MetaPill> : null}
          </div>

          <section className="space-y-3 border-t border-border pt-5">
            <p className="tt-eyebrow">Owner</p>
            <OwnerBadge task={task} />
          </section>

          <section className="space-y-2 border-t border-border pt-5">
            <p className="tt-eyebrow">Why this is a priority</p>
            <p className="max-w-reading text-sm text-foreground">{task.why}</p>
          </section>

          <section className="space-y-2 border-t border-border pt-5">
            <p className="tt-eyebrow">Source</p>
            <p className="text-sm text-foreground">{task.sourceLabel}</p>
            {task.companyLabel ? (
              <p className="text-sm text-muted-foreground">For {task.companyLabel}</p>
            ) : null}
            {task.sourceRoute ? (
              <Link
                to={task.sourceRoute}
                className="inline-flex items-center gap-1.5 text-sm text-royal hover:underline"
              >
                Open source <ExternalLink className="size-3.5" />
              </Link>
            ) : null}
          </section>

          {task.evidence.length > 0 ? (
            <section className="space-y-2 border-t border-border pt-5">
              <p className="tt-eyebrow">Meeting evidence</p>
              <ul className="space-y-2">
                {task.evidence.map((item, index) => (
                  <li key={index} className="text-sm text-muted-foreground">
                    {item.url ? (
                      <a href={item.url} target="_blank" rel="noreferrer" className="text-royal hover:underline">
                        {item.label}
                      </a>
                    ) : (
                      item.label
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {task.completedAt ? (
            <section className="space-y-1 border-t border-border pt-5">
              <p className="tt-eyebrow">Completion history</p>
              <p className="text-sm text-foreground">
                Completed by {task.completedBy ?? "a person"} on {task.completedAt.slice(0, 10)}.
              </p>
              {task.completionNote ? (
                <p className="max-w-reading text-sm text-muted-foreground">{task.completionNote}</p>
              ) : null}
            </section>
          ) : null}

          <section className="space-y-3 border-t border-border pt-5">
            <p className="tt-eyebrow">Focus</p>
            <div className="flex flex-wrap gap-2">
              {STEWARD_FOCUS_ORDER.map((focus) => (
                <button
                  key={focus}
                  type="button"
                  disabled={!canAct}
                  onClick={() => onFocus(focus)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                    task.focus === focus
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {STEWARD_FOCUS_LABEL[focus]}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-3 border-t border-border pt-5">
            <p className="tt-eyebrow">Due date</p>
            <input
              type="date"
              disabled={!canAct || task.origin !== "commitment"}
              defaultValue={task.dueAt?.slice(0, 10) ?? ""}
              onChange={(event) => onDue(event.target.value || null)}
              className="h-11 rounded-lg border border-input bg-card px-3 text-sm text-foreground disabled:opacity-50"
            />
            {task.origin !== "commitment" ? (
              <p className="text-xs text-muted-foreground">
                Dates on delivery work are set in the room that owns it.
              </p>
            ) : null}
          </section>

          <section className="space-y-3 border-t border-border pt-5">
            <p className="tt-eyebrow">Complete</p>
            {canComplete ? (
              <>
                <Textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Anything worth recording? Optional."
                  rows={3}
                />
                <div className="flex flex-wrap gap-2">
                  <TTButton type="button" onClick={() => onComplete(note)}>
                    Mark complete
                  </TTButton>
                  <TTButton type="button" variant="secondary" onClick={onReassign} disabled={!canAct}>
                    Reassign
                  </TTButton>
                </div>
              </>
            ) : (
              <>
                <p className="max-w-reading text-sm text-muted-foreground">
                  {task.completionBecause ??
                    (task.state === "complete"
                      ? "This is already complete."
                      : "You do not have authority to complete this task.")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {task.sourceRoute ? (
                    <TTButton asChild variant="secondary">
                      <Link to={task.sourceRoute}>Open owning room</Link>
                    </TTButton>
                  ) : null}
                  <TTButton type="button" variant="secondary" onClick={onReassign} disabled={!canAct}>
                    Reassign
                  </TTButton>
                </div>
              </>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
