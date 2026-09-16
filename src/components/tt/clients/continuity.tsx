/**
 * "Where this stands", at the top of a client.
 *
 * Six short lines so somebody new can pick the client up without reading every
 * tab. Certainty is written in words next to each line, not carried by colour
 * alone, so it survives a monochrome screen and a screen reader.
 */

import { Link } from "@tanstack/react-router";

import { clientContinuity, type ClientContinuityInput, type ContinuityCertainty } from "@/domain/client-continuity";
import { cn } from "@/lib/utils";

const CERTAINTY_WORD: Record<ContinuityCertainty, string> = {
  decided: "Agreed",
  observed: "Observed",
  inferred: "Inferred, not approved",
  not_recorded: "Not recorded",
  unreadable: "Could not be read",
};

export function ClientContinuity(props: ClientContinuityInput) {
  const lines = clientContinuity(props);

  return (
    <section
      aria-labelledby="client-continuity"
      className="rounded-2xl border border-border bg-card p-5 md:p-6"
    >
      <h2 id="client-continuity" className="text-[15px] font-semibold text-foreground">
        Where this stands
      </h2>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {lines.map((line) => (
          <div key={line.id}>
            <dt className="text-[12px] uppercase tracking-wide text-muted-foreground">
              {line.label}
            </dt>
            <dd className="mt-1 text-[14px] text-foreground">{line.value}</dd>
            <p
              className={cn(
                "mt-1 text-[12px]",
                line.certainty === "unreadable" ? "text-warning-foreground" : "text-muted-foreground",
              )}
            >
              {CERTAINTY_WORD[line.certainty]}
              {line.evidenceHref && line.evidenceLabel ? (
                <>
                  {" · "}
                  <Link
                    to={line.evidenceHref}
                    className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {line.evidenceLabel}
                  </Link>
                </>
              ) : null}
            </p>
          </div>
        ))}
      </dl>
    </section>
  );
}
