/**
 * Company identity band.
 *
 * The company is the subject inside the Trust Tai frame: its own mark and
 * declared theme colour appear as a rule, a faint wash, and nothing else. Fit
 * lights, stage tags, and controls stay Trust Tai.
 */

import { useState } from "react";

import { TTButton } from "@/components/tt/primitives";
import type { ProspectCandidate } from "@/domain/scout";
import type { FitLight } from "@/domain/scout-fit";
import { normalizeThemeColor } from "@/lib/company-identity";

import { AmbientRule, AmbientSurface } from "../ambient";
import { CompanyIdentityHeader } from "../company-identity";
import { FIT_LIGHT_LABEL, FitDot, StageTag, formatChecked } from "../fit-light";
import { Meta } from "./panel";

const OVERRIDES: { light: FitLight; label: string }[] = [
  { light: "green", label: "Green" },
  { light: "yellow", label: "Yellow" },
  { light: "red", label: "Red" },
];

export function IdentityBand({
  candidate,
  activeIcpVersion,
  needsRescore,
  staleDays,
  onQualify,
  onPass,
  onResearch,
  onOverride,
  busy,
}: {
  candidate: ProspectCandidate;
  activeIcpVersion: number | null;
  needsRescore: boolean;
  staleDays: number | null;
  onQualify: () => void;
  onPass: () => void;
  onResearch: () => void;
  onOverride: (light: FitLight | null) => void;
  busy?: boolean | undefined;
}) {
  const [showOverride, setShowOverride] = useState(false);
  const { prospect, evaluation, source } = candidate;
  const themeColor = normalizeThemeColor(candidate.identity?.themeColor);
  const identityKnown = Boolean(themeColor || candidate.identity?.logoUrl);
  const identityNote = candidate.identity?.logoSource
    ? `Company identity read from public website · ${candidate.identity.logoSource.replace(/_/g, " ")}`
    : "Company identity read from public website";

  const qualified = prospect.status === "qualified" || prospect.status === "ready_for_comms";
  const passed = prospect.status === "passed";

  return (
    <header className="tt-rise overflow-hidden rounded-xl border border-border bg-card">
      {/* The company's own colour when research recorded one, Scout's otherwise. */}
      <AmbientRule appId="scout" contextAccent={themeColor} />
      <AmbientSurface appId="scout" contextAccent={themeColor} depth="deep" className="p-6 lg:p-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <CompanyIdentityHeader
            name={prospect.name}
            websiteUrl={prospect.websiteUrl}
            themeColor={themeColor}
            logoUrl={candidate.identity?.logoUrl ?? null}
            eyebrow="Trust Tai OS / Scout / Prospect"
            status={
              <>
                <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5">
                  <FitDot light={evaluation.light} />
                  <span className="text-[13px] text-foreground">
                    {FIT_LIGHT_LABEL[evaluation.light]}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {evaluation.scoreable ? `${evaluation.score}%` : "-"}
                  </span>
                </span>
                <StageTag status={prospect.status} />
                {identityKnown ? (
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {identityNote}
                  </span>
                ) : null}
                {source.kind === "preview_demo" ? (
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    Preview demo
                  </span>
                ) : null}
              </>
            }
          />

          {/* Secondary controls only. The primary decision lives in Next move. */}
          <div className="flex flex-wrap items-center gap-2">
            {!qualified && !passed ? (
              <TTButton variant="secondary" disabled={busy} onClick={onQualify}>
                Qualify
              </TTButton>
            ) : null}
            {!passed ? (
              <TTButton variant="quiet" disabled={busy} onClick={onPass}>
                Pass
              </TTButton>
            ) : null}
            {prospect.websiteUrl ? (
              <TTButton variant="quiet" disabled={busy} onClick={onResearch}>
                Re-research
              </TTButton>
            ) : null}
            <TTButton
              variant="quiet"
              onClick={() => setShowOverride((value) => !value)}
              aria-expanded={showOverride}
            >
              Override fit
            </TTButton>
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-5 sm:grid-cols-3 lg:grid-cols-5">
          <Meta label="Stage" value={prospect.status.replace(/_/g, " ")} />
          <Meta
            label="Active ICP"
            value={activeIcpVersion !== null ? `v${activeIcpVersion}` : "None saved"}
          />
          <Meta label="Evaluator" value={evaluation.evaluatorVersion} />
          <Meta
            label="Research"
            value={evaluation.researchVersion ? `v${evaluation.researchVersion}` : "-"}
          />
          <Meta
            label="Pages / last read"
            value={`${evaluation.pagesResearched ?? source.pagesResearched?.length ?? 0} · ${formatChecked(candidate.lastCheckedAt)}`}
          />
        </dl>

        {needsRescore ? (
          <p className="mt-5 rounded-md border border-warning/30 bg-warning/8 px-4 py-3 text-[13px] text-warning">
            Needs rescore, this was evaluated against ICP v{evaluation.icpVersion}, and the active
            ICP is v{activeIcpVersion}.
          </p>
        ) : staleDays !== null && staleDays >= 30 ? (
          <p className="mt-5 rounded-md border border-border bg-secondary/50 px-4 py-3 text-[13px] text-muted-foreground">
            This evidence is {staleDays} days old. Re-read the website before acting on it.
          </p>
        ) : null}

        {showOverride ? (
          <div className="mt-5 rounded-lg border border-border bg-background p-4">
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
                  onClick={() => onOverride(option.light)}
                >
                  <FitDot light={option.light} />
                  {option.label}
                </TTButton>
              ))}
              <TTButton size="sm" variant="quiet" disabled={busy} onClick={() => onOverride(null)}>
                Clear override
              </TTButton>
            </div>
          </div>
        ) : null}
      </AmbientSurface>
    </header>
  );
}
