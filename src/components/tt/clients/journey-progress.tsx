/**
 * "The path so far", at the top of a client.
 *
 * Seven stages in order, each with what it needs, what it produces, who decides
 * it, where it stands and the next practical move. State is written in words as
 * well as colour, so it survives a monochrome screen and a screen reader.
 */

import { Link } from "@tanstack/react-router";

import {
  clientJourneyProgress,
  currentJourneyStage,
  STAGE_STATE_WORD,
  type ClientJourneyInput,
  type StageState,
} from "@/domain/client-journey-progress";
import { cn } from "@/lib/utils";

const STATE_TONE: Record<StageState, string> = {
  not_started: "text-muted-foreground",
  in_progress: "text-foreground",
  accepted: "text-foreground",
  blocked: "text-warning-foreground",
  unreadable: "text-warning-foreground",
};

export function ClientJourneyProgress(props: ClientJourneyInput) {
  const stages = clientJourneyProgress(props);
  const current = currentJourneyStage(stages);

  return (
    <section
      aria-labelledby="client-journey"
      className="rounded-2xl border border-border bg-card p-5 md:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="client-journey" className="text-[15px] font-semibold text-foreground">
          The path so far
        </h2>
        <p className="text-[13px] text-muted-foreground">
          {current ? `Attention: ${current.label}` : "Every stage is accepted."}
        </p>
      </div>

      <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {stages.map((stage) => (
          <li key={stage.stage} className="rounded-xl border border-border bg-background p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-[14px] font-semibold text-foreground">{stage.label}</h3>
              <span className={cn("text-[12px] font-medium", STATE_TONE[stage.state])}>
                {STAGE_STATE_WORD[stage.state]}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-foreground">{stage.because}</p>
            {stage.nextAction ? (
              <p className="mt-2 text-[13px] text-muted-foreground">Next: {stage.nextAction}</p>
            ) : null}
            <dl className="mt-2 space-y-1 text-[12px] text-muted-foreground">
              <div>
                <dt className="inline font-medium">Needs: </dt>
                <dd className="inline">{stage.entry}</dd>
              </div>
              <div>
                <dt className="inline font-medium">Produces: </dt>
                <dd className="inline">{stage.expected}</dd>
              </div>
              <div>
                <dt className="inline font-medium">Accepted by: </dt>
                <dd className="inline">{stage.decidedBy}</dd>
              </div>
              <div>
                <dt className="inline font-medium">Owner: </dt>
                <dd className="inline">{stage.owner ?? "Nobody recorded"}</dd>
              </div>
              <div>
                <dt className="inline font-medium">Due: </dt>
                <dd className="inline">
                  {stage.dueAt ? stage.dueAt.slice(0, 10) : "No confirmed date"}
                </dd>
              </div>
            </dl>
            {stage.evidenceHref && stage.evidenceLabel ? (
              <Link
                to={stage.evidenceHref}
                className="mt-2 inline-block text-[12px] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {stage.evidenceLabel}
              </Link>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
