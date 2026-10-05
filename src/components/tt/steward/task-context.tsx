import type { StewardTask } from "@/domain/steward-accountability";

/** Context links are user input, so only web links become clickable. */
export function taskContextHref(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function TaskContext({ task, viewerUserId }: { task: StewardTask; viewerUserId: string }) {
  const detail = task.manualDetail;
  if (!detail || !viewerUserId || task.owner.userId !== viewerUserId) return null;
  const next = detail.subtasks.find((item) => !item.done);
  const dependencies = detail.contextLinks.filter((link) => link.kind === "dependency");
  const sources = detail.contextLinks.filter((link) => link.kind !== "dependency");
  return (
    <section className="space-y-4 border-t border-border pt-5" aria-label="Recorded task context">
      <div>
        <h3 className="tt-eyebrow">Next action</h3>
        <p className="mt-2 text-sm">
          {task.state === "complete"
            ? "Recorded complete. Review the completion history below."
            : next?.text || "No next action recorded."}
        </p>
      </div>
      <div>
        <h3 className="tt-eyebrow">Dependencies</h3>
        {dependencies.length ? (
          <Links links={dependencies} />
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No dependency recorded.</p>
        )}
      </div>
      {detail.notes ? (
        <div>
          <h3 className="tt-eyebrow">Task notes</h3>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm">{detail.notes}</p>
        </div>
      ) : null}
      {task.state === "blocked" ? (
        <p className="text-sm text-muted-foreground">
          This task is blocked. Notes and dependencies above contain only what was recorded.
        </p>
      ) : null}
      {detail.acceptanceCriteria.length ? (
        <div>
          <h3 className="tt-eyebrow">Planned acceptance criteria</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {detail.acceptanceCriteria.map((criterion, index) => (
              <li key={index}>{criterion}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            These describe the intended result; they do not prove delivery.
          </p>
        </div>
      ) : null}
      {sources.length ? (
        <div>
          <h3 className="tt-eyebrow">Recorded source links</h3>
          <Links links={sources} />
          <p className="mt-2 text-xs text-muted-foreground">
            A source link is context, not a checked completion receipt.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function Links({ links }: { links: { label: string; url: string }[] }) {
  return (
    <ul className="mt-2 space-y-2 text-sm">
      {links.map((link, index) => {
        const href = taskContextHref(link.url);
        return (
          <li key={index} className="break-words">
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-royal underline underline-offset-2"
              >
                {link.label || href}
              </a>
            ) : (
              <span>{link.label || link.url} (link unavailable)</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
