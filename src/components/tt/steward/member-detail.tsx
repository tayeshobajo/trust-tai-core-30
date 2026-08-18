import { MetaPill } from "@/components/tt/primitives";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { PersonRead } from "@/data/steward/accountability";
import {
  STEWARD_FOCUS_LABEL,
  STEWARD_STATE_LABEL,
  type StewardTask,
} from "@/domain/steward-accountability";

function SaidVsDone({ tasks }: { tasks: StewardTask[] }) {
  const withEvidence = tasks.filter(
    (task) => task.origin === "commitment" && task.evidence.length > 0,
  );
  if (withEvidence.length === 0) {
    return (
      <p className="max-w-reading text-sm text-muted-foreground">
        No meeting evidence has been recorded against this person yet.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {withEvidence.slice(0, 6).map((task) => (
        <li key={task.key} className="border-b border-border/60 pb-3 last:border-b-0">
          <p className="text-sm text-foreground">Said: {task.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Done: {task.state === "complete" ? "Recorded complete" : STEWARD_STATE_LABEL[task.state]}
            {task.dueAt ? ` · due ${task.dueAt.slice(0, 10)}` : ""}
          </p>
          {task.evidence[0] ? (
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {task.evidence[0].url ? (
                <a href={task.evidence[0].url} target="_blank" rel="noreferrer" className="hover:underline">
                  {task.evidence[0].label}
                </a>
              ) : (
                task.evidence[0].label
              )}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * One person's Steward profile. It describes work, never character: no score,
 * no ranking, and no pattern claimed from a single observation.
 */
export function MemberDetailPanel({
  read,
  now,
  onClose,
  onOpenTask,
}: {
  read: PersonRead | null;
  now: string;
  onClose: () => void;
  onOpenTask: (task: StewardTask) => void;
}) {
  if (!read) return null;

  const thirtyDaysAgo = new Date(Date.parse(now) - 30 * 86_400_000).toISOString();
  const recent = read.tasks.filter((task) => (task.completedAt ?? task.updatedAt) >= thirtyDaysAgo);
  const kept = recent.filter((task) => task.state === "complete");
  const missed = recent.filter((task) => task.overdue);
  const repeatedBlocked = read.tasks.filter((task) => task.state === "blocked");

  return (
    <Sheet open onOpenChange={(open) => (open ? null : onClose())}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="space-y-3 text-left">
          <p className="tt-eyebrow">Steward profile</p>
          <SheetTitle className="font-display text-2xl text-foreground">
            {read.owner.name}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <div className="flex flex-wrap gap-2">
            <MetaPill>{read.active} active</MetaPill>
            <MetaPill>{read.overdue} overdue</MetaPill>
            <MetaPill>{read.blocked} blocked</MetaPill>
            <MetaPill>{read.completedThisWeek} completed this week</MetaPill>
          </div>

          <section className="border-t border-border pt-5">
            <p className="tt-eyebrow">Main priority</p>
            {read.mainPriority ? (
              <>
                <p className="mt-2 max-w-reading font-display text-lg text-foreground">
                  {read.mainPriority.title}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{read.mainPriority.why}</p>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Nothing open right now.</p>
            )}
          </section>

          {read.byFocus.map((group) => (
            <section key={group.focus} className="border-t border-border pt-5">
              <p className="tt-eyebrow">{STEWARD_FOCUS_LABEL[group.focus]}</p>
              <ul className="mt-3 space-y-2">
                {group.tasks.map((task) => (
                  <li key={task.key}>
                    <button
                      type="button"
                      onClick={() => onOpenTask(task)}
                      className="w-full text-left text-sm text-foreground hover:underline"
                    >
                      {task.title}
                      <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        {STEWARD_STATE_LABEL[task.state]}
                        {task.dueAt ? ` · ${task.dueAt.slice(0, 10)}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <section className="border-t border-border pt-5">
            <p className="tt-eyebrow">Said vs done</p>
            <div className="mt-3">
              <SaidVsDone tasks={read.tasks} />
            </div>
          </section>

          <section className="border-t border-border pt-5">
            <p className="tt-eyebrow">Last 30 days</p>
            <p className="mt-2 max-w-reading text-sm text-muted-foreground">
              {recent.length === 0
                ? "Nothing recorded in the last 30 days."
                : `${kept.length} of ${recent.length} recorded promise${recent.length === 1 ? "" : "s"} completed. ${missed.length} passed their date.`}
            </p>
            {repeatedBlocked.length >= 2 ? (
              <p className="mt-2 max-w-reading text-sm text-foreground">
                {repeatedBlocked.length} separate items are recorded as blocked. That is a pattern
                worth a conversation, not a judgement.
              </p>
            ) : null}
            {kept.length > 0 ? (
              <p className="mt-2 max-w-reading text-sm text-muted-foreground">
                Recent follow-through: {kept[0]!.title}.
              </p>
            ) : null}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
