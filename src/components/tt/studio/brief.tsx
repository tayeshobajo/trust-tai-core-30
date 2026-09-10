/**
 * The brief, on the same warm surface as what Studio noticed.
 *
 * A person reads what Studio drafted, picks or writes the title, edits the
 * opening and any line of the spine, and then keeps it or throws it away.
 * Nothing is written until they press Keep brief, and nothing here publishes,
 * schedules or sends.
 *
 * The brief is model-reasoned and says so, which is why it sits apart from
 * Studio's deterministic read of the numbers on the row above.
 */

import { useMemo, useState } from "react";

import { SectionHeading, TTButton } from "@/components/tt/primitives";
import {
  applyBriefEdits,
  briefGaps,
  displayTitle,
  spineRows,
  structureNote,
  type BriefEdits,
} from "@/data/content/brief-view";
import type { ContentBrief } from "@/domain/content-brief";

const FIELD =
  "mt-2 w-full resize-y rounded-lg border border-border bg-background/70 p-3 text-sm text-foreground outline-none focus:border-primary";

export function StudioBrief({
  phrase,
  brief,
  saving,
  onKeep,
  onDiscard,
}: {
  phrase: string;
  brief: ContentBrief;
  saving: boolean;
  onKeep: (edited: ContentBrief) => void;
  onDiscard: () => void;
}) {
  const [edits, setEdits] = useState<BriefEdits>({});
  const edited = useMemo(() => applyBriefEdits(brief, edits), [brief, edits]);
  const gaps = briefGaps(edited);
  const rows = spineRows(edited);

  const set = (patch: BriefEdits) => setEdits((current) => ({ ...current, ...patch }));

  return (
    <section className="mb-10 rounded-2xl bg-studio-paper p-6 sm:p-8" aria-label="The brief">
      <SectionHeading
        title={`Brief · “${phrase}”`}
        description="Studio reasoned this one out. Your wording wins over Studio's, so change anything that is not how you would say it."
      />

      {/* --------------------------------------------------------- title */}
      <div className="mt-6 max-w-reading">
        <p className="text-xs font-medium text-royal">The title</p>
        <div className="mt-3 space-y-3">
          {brief.titleCandidates.map((candidate) => {
            const chosen = displayTitle(edited) === candidate.title;
            return (
              <button
                key={candidate.title}
                type="button"
                onClick={() => set({ chosenTitle: candidate.title })}
                className={`block w-full rounded-lg border p-4 text-left transition ${
                  chosen ? "border-primary" : "border-border hover:border-primary/40"
                }`}
              >
                <span className="block text-[15px] font-medium text-foreground">
                  {candidate.title}
                </span>
                <span className="mt-1 block text-[13px] text-muted-foreground">
                  Familiar: {candidate.familiarityAnchor}. Fresh: {candidate.freshTurn}.
                </span>
                <span className="mt-1 block text-[13px] text-muted-foreground">
                  {candidate.intentFit}
                </span>
              </button>
            );
          })}
        </div>
        <label className="mt-3 block">
          <span className="text-xs text-muted-foreground">Or write your own</span>
          <input
            value={edits.chosenTitle ?? ""}
            onChange={(event) => set({ chosenTitle: event.target.value })}
            placeholder={displayTitle(brief)}
            className="mt-2 h-11 w-full rounded-lg border border-border bg-background/70 px-3 text-sm text-foreground outline-none focus:border-primary"
          />
        </label>
      </div>

      {/* ------------------------------------------------------- opening */}
      <div className="mt-8 max-w-reading border-t border-border/70 pt-6">
        <p className="text-xs font-medium text-royal">The opening</p>
        <textarea
          value={edits.firstParagraph ?? brief.opening.firstParagraph}
          onChange={(event) => set({ firstParagraph: event.target.value })}
          rows={4}
          aria-label="The first paragraph"
          className={FIELD}
        />
        {brief.opening.whyItEarnsParagraphTwo ? (
          <p className="mt-2 text-[13px] text-muted-foreground">
            Why it earns the second paragraph: {brief.opening.whyItEarnsParagraphTwo}
          </p>
        ) : null}
      </div>

      {/* --------------------------------------------------------- spine */}
      <div className="mt-8 max-w-reading border-t border-border/70 pt-6">
        <p className="text-xs font-medium text-royal">The sections</p>
        <p className="mt-1 text-[13px] text-muted-foreground">{structureNote(edited)}</p>
        <div className="mt-4 space-y-4">
          {rows.map((row) => (
            <label key={`${row.field}-${row.index ?? 0}`} className="block">
              <span className="text-xs text-muted-foreground">{row.label}</span>
              <textarea
                value={row.text}
                rows={2}
                onChange={(event) => {
                  const value = event.target.value;
                  if (row.field === "middle") {
                    const middle = [...edited.spine.middle];
                    middle[row.index ?? 0] = value;
                    set({ middle });
                  } else {
                    set({ [row.field]: value } as BriefEdits);
                  }
                }}
                className={FIELD}
              />
            </label>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------ evidence */}
      <div className="mt-8 max-w-reading border-t border-border/70 pt-6">
        <p className="text-xs font-medium text-muted-foreground">What this rests on</p>
        {edited.seo.primaryLanguage.length > 0 ? (
          <p className="mt-2 text-[13px] text-muted-foreground">
            Phrases people used: {edited.seo.primaryLanguage.join(", ")}
          </p>
        ) : null}
        {edited.seo.intent ? (
          <p className="mt-1 text-[13px] text-muted-foreground">Intent: {edited.seo.intent}</p>
        ) : null}
        {edited.seo.overlapRisk ? (
          <p className="mt-1 text-[13px] text-muted-foreground">
            Overlap with our own pages: {edited.seo.overlapRisk}
          </p>
        ) : null}
        <p className="mt-3 text-[13px] text-muted-foreground">
          Studio reasoned this brief. The numbers above it are observed; this reading is not.
        </p>
      </div>

      {/* ------------------------------------------------------- decision */}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <TTButton onClick={() => onKeep(edited)} disabled={saving || gaps.length > 0}>
          {saving ? "Keeping…" : "Keep brief"}
        </TTButton>
        <TTButton variant="quiet" onClick={onDiscard} disabled={saving}>
          Discard
        </TTButton>
        {gaps.length > 0 ? (
          <span className="text-[13px] text-muted-foreground">
            Still missing {gaps.join(", ")}.
          </span>
        ) : (
          <span className="text-[13px] text-muted-foreground">
            Keeping a brief writes nothing and publishes nothing.
          </span>
        )}
      </div>
    </section>
  );
}
