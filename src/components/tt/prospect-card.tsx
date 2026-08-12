import type { ProspectCandidate } from "@/domain/scout";
import { MetaPill, TTButton } from "@/components/tt/primitives";

const STATE_LABEL: Record<string, string> = {
  discovered: "New",
  reviewing: "Reviewing",
  qualified: "Qualified",
  ready_for_comms: "Ready for Comms",
  passed: "Passed",
  converted: "Converted",
  archived: "Archived",
};

export function ProspectCard({
  candidate,
  onQualify,
  onPass,
}: {
  candidate: ProspectCandidate;
  onQualify: (id: string) => void;
  onPass: (id: string) => void;
}) {
  const { prospect, signals, fit, source } = candidate;
  const status = prospect.status;
  const live = source.kind === "live_website";

  return (
    <article className="tt-surface p-6 transition-colors duration-300">
      <div className="flex flex-wrap items-center gap-2">
        <MetaPill>{STATE_LABEL[status] ?? status}</MetaPill>
        <MetaPill>{prospect.domain}</MetaPill>
        <MetaPill>{live ? "Live website research" : "Preview demo source"}</MetaPill>
      </div>

      <h3 className="mt-4 text-xl font-semibold tracking-tight text-foreground">
        {prospect.name}
      </h3>
      {source.note ? (
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {source.note}
        </p>
      ) : null}

      <div className="mt-4 space-y-4 text-sm">
        <div>
          <p className="tt-eyebrow">
            {live ? "Observed on the public website" : "Observed by Scout"}
          </p>
          <ul className="mt-2 space-y-1.5 text-muted-foreground">
            {signals.map((signal) => (
              <li key={signal.id} className="flex gap-2">
                <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-border" />
                <span>
                  {signal.statement}
                  {signal.sourceUrl ? (
                    <>
                      {" "}
                      <a
                        href={signal.sourceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="underline decoration-border underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        source
                      </a>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-border bg-secondary/40 p-4">
          <p className="tt-eyebrow">Why it may fit — inferred</p>
          <p className="mt-1 text-foreground">{fit.whyItFits}</p>
        </div>

        <div className="rounded-lg border border-royal/20 bg-royal/5 p-4">
          <p className="tt-eyebrow text-royal">Recommended by Scout</p>
          <p className="mt-1 text-foreground">{fit.recommendation}</p>
        </div>
      </div>

      {status === "discovered" || status === "reviewing" ? (
        <div className="mt-5 flex flex-wrap gap-2">
          <TTButton size="sm" onClick={() => onQualify(prospect.id)}>
            Qualify {prospect.name}
          </TTButton>
          <TTButton size="sm" variant="quiet" onClick={() => onPass(prospect.id)}>
            Pass
          </TTButton>
        </div>
      ) : (
        <div className="tt-rise mt-5 rounded-lg border border-border bg-secondary/50 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {status === "passed" || status === "archived" ? "Passed by you" : "Qualified by you"}
          </p>
          <p className="mt-2 text-sm text-foreground">
            {status === "passed" || status === "archived"
              ? "Set aside. Nothing is sent, and it stays here if the picture changes."
              : "Ready for Comms. The first conversation will open against this same prospect."}
          </p>
        </div>
      )}
    </article>
  );
}
