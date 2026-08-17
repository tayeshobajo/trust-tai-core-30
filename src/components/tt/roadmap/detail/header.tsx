/**
 * Roadmap detail — company header.
 *
 * Orientation in one glance: whose roadmap this is, where it stands, and the
 * few actions that belong to the roadmap as a whole. Destructive actions stay
 * quiet and always confirm.
 */

import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";

import { CompanyMark } from "@/components/tt/company-identity";
import { MetaPill, TTButton } from "@/components/tt/primitives";
import type { Roadmap } from "@/domain/roadmap";
import { ROADMAP_STATUS_LABEL } from "@/domain/roadmap";
import type { PathProgress } from "@/data/roadmap/detail/projection";
import { normalizeThemeColor } from "@/lib/company-identity";

export interface RoadmapHeaderIdentity {
  websiteUrl?: string;
  logoUrl?: string | null;
  themeColor?: string | null;
}

export function RoadmapCompanyHeader({
  roadmap,
  identity,
  progress,
  openDecisions,
  archiving,
  deleting,
  onArchive,
  onDelete,
}: {
  roadmap: Roadmap;
  identity: RoadmapHeaderIdentity;
  progress: PathProgress;
  openDecisions: number;
  archiving: boolean;
  deleting: boolean;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const accent = normalizeThemeColor(identity.themeColor ?? null);

  return (
    <header className="relative overflow-hidden rounded-xl border border-border bg-card">
      {/* Ambient identity wash: light entering the page, never a coloured panel. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-40"
        style={{
          background: `linear-gradient(180deg, color-mix(in oklab, ${accent ?? "var(--royal)"} 6%, transparent) 0%, transparent 160px)`,
        }}
      />
      <div className="relative p-5 sm:p-6">
        <Link
          to="/modules/roadmap"
          className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          All roadmaps
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <CompanyMark
              name={roadmap.subjectLabel || roadmap.title}
              websiteUrl={identity.websiteUrl ?? ""}
              themeColor={identity.themeColor ?? null}
              logoUrl={identity.logoUrl ?? null}
              size="lg"
            />
            <div className="min-w-0">
              <h1 className="font-display text-[28px] leading-tight text-foreground">
                {roadmap.subjectLabel || roadmap.title}
              </h1>
              <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
                {roadmap.objective || "No objective is recorded for this roadmap yet."}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <MetaPill>{ROADMAP_STATUS_LABEL[roadmap.status]}</MetaPill>
                <MetaPill>
                  {progress.complete}/{progress.total} milestones complete
                </MetaPill>
                {openDecisions > 0 ? (
                  <span className="inline-flex items-center rounded-full border border-warning/30 bg-warning/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-warning">
                    {openDecisions} need{openDecisions === 1 ? "s" : ""} your decision
                  </span>
                ) : null}
                {roadmap.prospectId ? <MetaPill>Built from Scout</MetaPill> : null}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <TTButton variant="secondary" disabled={archiving} onClick={onArchive}>
              {roadmap.status === "archived" ? "Reopen" : "Archive"}
            </TTButton>
            {confirming ? (
              <>
                <TTButton variant="secondary" disabled={deleting} onClick={onDelete}>
                  Delete permanently
                </TTButton>
                <TTButton variant="quiet" onClick={() => setConfirming(false)}>
                  Keep it
                </TTButton>
              </>
            ) : (
              <TTButton variant="quiet" onClick={() => setConfirming(true)}>
                Delete
              </TTButton>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
