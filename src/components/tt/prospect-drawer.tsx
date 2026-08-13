import { useState } from "react";
import { ExternalLink } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { TTButton } from "@/components/tt/primitives";
import type { ProspectCandidate } from "@/domain/scout";
import type { FitCriterionState, FitLight } from "@/domain/scout-fit";
import { cn } from "@/lib/utils";

import { FIT_LIGHT_LABEL, FitDot, StageTag, formatChecked } from "./fit-light";

const STATE_LABEL: Record<FitCriterionState, string> = {
  met: "Met",
  partial: "Partial",
  missing: "Unknown",
  mismatch: "Mismatch",
};

const OVERRIDES: { light: FitLight; label: string }[] = [
  { light: "green", label: "Green" },
  { light: "yellow", label: "Yellow" },
  { light: "red", label: "Red" },
];

function Disclosure({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-lg border border-border bg-card px-4 py-3 [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {summary}
        <span aria-hidden className="ml-2 opacity-60 group-open:hidden">
          +
        </span>
        <span aria-hidden className="ml-2 hidden opacity-60 group-open:inline">
          −
        </span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

export function ProspectDrawer({
  candidate,
  activeIcpVersion,
  onOpenChange,
  onQualify,
  onPass,
  onResearch,
  onOverride,
  busy,
}: {
  candidate: ProspectCandidate | null;
  activeIcpVersion: number | null;
  onOpenChange: (open: boolean) => void;
  onQualify: (id: string) => void;
  onPass: (id: string) => void;
  onResearch: (websiteUrl: string) => void;
  onOverride: (id: string, light: FitLight | null) => void;
  busy?: boolean;
}) {
  const [showOverride, setShowOverride] = useState(false);
  if (!candidate) return null;

  const { prospect, evaluation, signals, fit, source } = candidate;
  const staleScore =
    evaluation.scoreable &&
    activeIcpVersion !== null &&
    evaluation.icpVersion !== null &&
    evaluation.icpVersion !== activeIcpVersion;
  const qualified = prospect.status === "qualified" || prospect.status === "ready_for_comms";
  const open = Boolean(candidate);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto bg-background sm:max-w-xl"
        aria-describedby={undefined}
      >
        <SheetHeader className="text-left">
          <SheetTitle className="tt-display text-2xl text-foreground">{prospect.name}</SheetTitle>
          <SheetDescription className="font-mono text-[11px]">
            {prospect.websiteUrl ? (
              <a
                href={prospect.websiteUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {prospect.domain}
                <ExternalLink aria-hidden className="size-3" />
              </a>
            ) : (
              "No website recorded"
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          {/* ICP fit */}
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-3">
              <FitDot light={evaluation.light} />
              <p className="text-sm font-medium text-foreground">
                {FIT_LIGHT_LABEL[evaluation.light]}
                {evaluation.scoreable ? ` · ${evaluation.score}% ICP match` : ""}
              </p>
              <StageTag status={prospect.status} />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{evaluation.explanation}</p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {evaluation.evidenceCount} evidence point
              {evaluation.evidenceCount === 1 ? "" : "s"} ·{" "}
              {evaluation.icpVersion ? `ICP v${evaluation.icpVersion}` : "No ICP version recorded"} ·{" "}
              {evaluation.evaluatorVersion}
            </p>
            {evaluation.researchDepthNote ? (
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {evaluation.researchDepthNote}
                {evaluation.researchVersion ? ` · research v${evaluation.researchVersion}` : ""}
              </p>
            ) : null}
            {staleScore ? (
              <p className="mt-3 rounded-md border border-warning/30 bg-warning/8 px-3 py-2 text-[13px] text-warning">
                Needs rescore — this was evaluated against ICP v{evaluation.icpVersion}, and the
                active ICP is v{activeIcpVersion}.
              </p>
            ) : null}
          </section>

          {/* Strongest signal / next move */}
          <section className="rounded-lg border border-royal/20 bg-royal/5 p-4">
            <p className="tt-eyebrow text-royal">
              {qualified ? "Next move" : "Strongest signal"}
            </p>
            <p className="mt-1.5 text-sm text-foreground">
              {qualified ? fit.recommendation : evaluation.strongestSignal}
            </p>
          </section>

          {qualified ? (
            <section className="tt-rise rounded-lg border border-border bg-secondary/50 p-4">
              <p className="tt-eyebrow">What happens next</p>
              <ol className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                <li>1. Identify or confirm the decision maker.</li>
                <li>2. Prepare the opportunity handoff.</li>
                <li>3. Move to Comms when contact context is ready.</li>
              </ol>
              <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Nothing is sent automatically.
              </p>
            </section>
          ) : null}

          {/* Score breakdown */}
          {evaluation.criteria.length > 0 ? (
            <Disclosure summary="ICP score breakdown">
              <ul className="space-y-3">
                {evaluation.criteria.map((criterion) => (
                  <li key={criterion.key} className="border-b border-border pb-3 last:border-b-0 last:pb-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-[13px] font-medium text-foreground">{criterion.label}</p>
                      <p
                        className={cn(
                          "shrink-0 font-mono text-[10px] uppercase tracking-[0.14em]",
                          criterion.state === "met" && "text-success",
                          criterion.state === "partial" && "text-warning",
                          criterion.state === "mismatch" && "text-destructive",
                          criterion.state === "missing" && "text-muted-foreground",
                        )}
                      >
                        {STATE_LABEL[criterion.state]}
                        {criterion.maxScore > 0 ? ` · ${criterion.score}/${criterion.maxScore}` : ""}
                      </p>
                    </div>
                    <p className="mt-1 text-[13px] text-muted-foreground">{criterion.reason}</p>
                    {criterion.sourceUrls?.length ? (
                      <div className="mt-1.5 flex flex-wrap gap-3">
                        {criterion.sourceUrls.map((url) => (
                          <a
                            key={url}
                            href={url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="font-mono text-[10px] uppercase tracking-[0.14em] underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            source
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Disclosure>
          ) : null}

          {/* Observed evidence */}
          <Disclosure summary={`Observed evidence · ${signals.length}`}>
            {signals.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                Nothing has been observed for this company yet.
              </p>
            ) : (
              <ul className="space-y-2 text-[13px] text-muted-foreground">
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
                            className="underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            source
                          </a>
                        </>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Disclosure>

          <Disclosure summary="Inferred interpretation">
            <p className="text-[13px] text-muted-foreground">{fit.whyItFits}</p>
          </Disclosure>

          <Disclosure summary="Suggested next move">
            <p className="text-[13px] text-muted-foreground">{fit.recommendation}</p>
          </Disclosure>

          <Disclosure summary="Provenance">
            <p className="text-[13px] text-muted-foreground">
              {source.label}
              {source.note ? ` · ${source.note}` : ""} · last checked{" "}
              {formatChecked(candidate.lastCheckedAt)}
            </p>
            {source.pagesResearched?.length ? (
              <ul className="mt-2 space-y-1">
                {source.pagesResearched.map((page) => (
                  <li key={page}>
                    <a
                      href={page}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-mono text-[11px] break-all text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {page}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </Disclosure>

          {/* Actions */}
          <section className="border-t border-border pt-5">
            <div className="flex flex-wrap gap-2">
              {!qualified && prospect.status !== "passed" ? (
                <TTButton size="sm" disabled={busy} onClick={() => onQualify(prospect.id)}>
                  Qualify {prospect.name}
                </TTButton>
              ) : null}
              {prospect.status !== "passed" ? (
                <TTButton
                  size="sm"
                  variant="quiet"
                  disabled={busy}
                  onClick={() => onPass(prospect.id)}
                >
                  Pass
                </TTButton>
              ) : null}
              {prospect.websiteUrl ? (
                <TTButton
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onResearch(prospect.websiteUrl)}
                >
                  Re-research website
                </TTButton>
              ) : null}
              <TTButton
                size="sm"
                variant="quiet"
                onClick={() => setShowOverride((value) => !value)}
                aria-expanded={showOverride}
              >
                Override fit
              </TTButton>
            </div>

            {showOverride ? (
              <div className="mt-4 rounded-lg border border-border bg-card p-4">
                <p className="text-[13px] text-muted-foreground">
                  Set the fit light yourself. The evaluator's reading is kept and shown alongside it.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {OVERRIDES.map((option) => (
                    <TTButton
                      key={option.light}
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => onOverride(prospect.id, option.light)}
                    >
                      <FitDot light={option.light} />
                      {option.label}
                    </TTButton>
                  ))}
                  <TTButton
                    size="sm"
                    variant="quiet"
                    disabled={busy}
                    onClick={() => onOverride(prospect.id, null)}
                  >
                    Clear override
                  </TTButton>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
