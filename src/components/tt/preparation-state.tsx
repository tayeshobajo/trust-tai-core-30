import { cn } from "@/lib/utils";
import {
  friendlyState,
  type PreparationOutput,
  type PreparationStatus,
} from "@/domain/preparation-jobs";

/**
 * How prepared work reads to the person who has to act on it.
 *
 * Plain words first, the reason underneath, and the machine detail last and
 * quiet. Status is never carried by colour alone: the words say it too.
 */

const TONE: Record<PreparationStatus, string> = {
  queued: "border-border text-muted-foreground",
  running: "border-border text-muted-foreground",
  prepared: "border-royal/30 text-royal",
  needs_decision: "border-amber-500/40 text-amber-700",
  could_not_finish: "border-destructive/40 text-destructive",
  cancelled: "border-border text-muted-foreground",
  uncertain: "border-amber-500/40 text-amber-700",
};

export function PreparationStateBadge({ status }: { status: PreparationStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border bg-card px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.12em]",
        TONE[status],
      )}
    >
      {friendlyState(status)}
    </span>
  );
}

export function PreparationResult({
  output,
  showDetail = false,
}: {
  output: PreparationOutput;
  showDetail?: boolean;
}) {
  return (
    <article className="comms-card p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[18px] font-medium text-foreground">{output.summary || "Not prepared"}</h3>
        <PreparationStateBadge status={output.status} />
      </header>
      {output.because ? (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{output.because}</p>
      ) : null}
      {output.suggestions.length > 0 ? (
        <ul className="mt-4 grid gap-2">
          {output.suggestions.map((suggestion) => (
            <li key={suggestion} className="text-sm leading-relaxed text-foreground">
              {suggestion}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-4 font-mono text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
        Owner: {output.ownerLabel}
      </p>
      {showDetail ? (
        <dl className="mt-4 grid gap-1 border-t border-border pt-4 font-mono text-[12px] text-muted-foreground">
          <div>Attempts: {output.attempts}</div>
          {output.modelUse ? (
            <div>
              Prepared with {output.modelUse.provider} / {output.modelUse.model}
            </div>
          ) : (
            <div>No model was used.</div>
          )}
        </dl>
      ) : null}
    </article>
  );
}
