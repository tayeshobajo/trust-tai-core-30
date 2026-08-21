/**
 * The canon, as a person meets it.
 *
 * Read only until a person acts: what this looks like, what supports it, what
 * has not been checked, what else it could be, and where it belongs. A match is
 * a reading, so it is never dressed as a finding and never carries a button
 * that acts on a room.
 *
 * Two things may be attached to a reading: what this organization already
 * learned about the same shape, kept clearly apart from today's evidence, and
 * a way to say what you decided so the reading can be learned from later.
 */

import { MetaPill, TTCard } from "@/components/tt/primitives";
import { CaseDecision, type CaseDecisionDraft } from "@/components/tt/intelligence/case-decision";
import { roomLabel } from "@/data/conductor/page-projection";
import type { PriorExperience } from "@/data/intelligence/canon";
import { CASE_ANALOGY_LABEL } from "@/data/intelligence/canon/experience";
import { narrateRanking, rankHypotheses } from "@/data/intelligence/canon/rank";
import { CONFIDENCE_LEVEL_LABEL } from "@/domain/confidence";
import { CANON_DOMAIN_LABEL, type PatternMatch } from "@/domain/intelligence-canon";

export interface CanonPanelProps {
  matches: PatternMatch[];
  /** Prior cases and outcomes for these patterns, keyed by pattern id. */
  experience?: Record<string, PriorExperience>;
  onDecide?: (draft: CaseDecisionDraft) => void | Promise<void>;
  onNotUseful?: (match: PatternMatch) => void | Promise<void>;
  deciding?: boolean;
  /** Pattern ids a case already exists for in this session. */
  recorded?: string[];
  notUseful?: string[];
}

export function CanonPanel({
  matches,
  experience,
  onDecide,
  onNotUseful,
  deciding,
  recorded,
  notUseful,
}: CanonPanelProps) {
  if (matches.length === 0) return null;

  /* Which reading the current evidence actually favours, and why. The order
   * comes from today's evidence first; prior experience can only nudge it. */
  const ranked = rankHypotheses({
    matches,
    ...(experience ? { experience } : {}),
    limit: matches.length,
  });
  const order = new Map(ranked.map((row, index) => [row.patternId, index]));
  const sorted = [...matches].sort(
    (a, b) => (order.get(a.patternId) ?? 99) - (order.get(b.patternId) ?? 99),
  );

  return (
    <section className="space-y-3">
      <div>
        <p className="tt-eyebrow">What this resembles</p>
        <p className="mt-1 max-w-reading text-[13px] text-muted-foreground">
          Known shapes the current evidence is close to. These are readings, not
          conclusions, and nothing here changes what the rooms hold.
        </p>
      </div>

      {ranked.length > 1 ? (
        <p className="max-w-reading text-[13px] leading-relaxed text-foreground">
          {narrateRanking(ranked)}
        </p>
      ) : null}

      {sorted.map((match) => (
        <TTCard key={match.patternId} className="p-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <MetaPill>{CANON_DOMAIN_LABEL[match.domain]}</MetaPill>
            <MetaPill>{CONFIDENCE_LEVEL_LABEL[match.confidence]}</MetaPill>
          </div>

          <h3 className="mt-3 text-[15px] font-semibold leading-snug text-foreground">
            {match.patternName}
          </h3>
          <p className="mt-1 max-w-reading text-[13px] leading-relaxed text-muted-foreground">
            {match.because}
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="tt-eyebrow">What supports this</p>
              <ul className="mt-1 space-y-1 text-[13px] text-muted-foreground">
                {match.matched.map((item) => (
                  <li key={item.observationId}>{item.statement}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="tt-eyebrow">Not checked yet</p>
              {match.missingEvidence.length > 0 ? (
                <ul className="mt-1 space-y-1 text-[13px] text-muted-foreground">
                  {match.missingEvidence.map((item) => (
                    <li key={`${item.appId}-${item.inspect}`}>
                      {item.inspect} Look in {roomLabel(item.appId)}. Confirmed by:{" "}
                      {item.wouldConfirm} Ruled out by: {item.wouldRefute}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-[13px] text-muted-foreground">
                  Everything this shape asks for has been looked at.
                </p>
              )}
            </div>
          </div>

          {match.contradicting.length > 0 ? (
            <div className="mt-3 border-t border-border pt-3">
              <p className="tt-eyebrow">What argues against it</p>
              <ul className="mt-1 space-y-1 text-[13px] text-muted-foreground">
                {match.contradicting.map((item) => (
                  <li key={item.observationId}>{item.statement}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {match.competingExplanations.length > 0 ? (
            <div className="mt-3 border-t border-border pt-3">
              <p className="tt-eyebrow">It could also be</p>
              <ul className="mt-1 space-y-1 text-[13px] text-muted-foreground">
                {match.competingExplanations.map((item) => (
                  <li key={item.explanation}>
                    {item.explanation} Tell them apart by: {item.distinguishedBy}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {match.possibleNextMoves.length > 0 ? (
            <div className="mt-3 border-t border-border pt-3">
              <p className="tt-eyebrow">Where this belongs</p>
              <ul className="mt-1 space-y-1 text-[13px] text-muted-foreground">
                {match.possibleNextMoves.map((move) => (
                  <li key={`${move.appId}-${move.move}`}>
                    {roomLabel(move.appId)}: {move.move}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {experience?.[match.patternId] ? (
            <div className="mt-3 border-t border-border pt-3">
              <p className="tt-eyebrow">What happened here before</p>
              <p className="mt-1 max-w-reading text-[13px] text-muted-foreground">
                {experience[match.patternId]!.note ??
                  "There is a record of this shape here, but not enough of one to guide today."}
              </p>
              {experience[match.patternId]!.priorCases.length > 0 ? (
                <ul className="mt-1 space-y-1 text-[13px] text-muted-foreground">
                  {experience[match.patternId]!.priorCases.map(({ entry, analogy }) => (
                    <li key={entry.id}>
                      {CASE_ANALOGY_LABEL[analogy]}: {entry.humanDecision}
                      {entry.correction ? ` Later corrected: ${entry.correction}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-1 text-[12px] text-muted-foreground">
                Earlier cases are memory, not evidence about today, and they do not raise how
                strongly this reads.
              </p>
            </div>
          ) : null}

          {onDecide ? (
            <CaseDecision
              match={match}
              {...(deciding !== undefined ? { saving: deciding } : {})}
              recorded={(recorded ?? []).includes(match.patternId)}
              onRecord={onDecide}
              {...(onNotUseful ? { onNotUseful } : {})}
              notUsefulSaved={(notUseful ?? []).includes(match.patternId)}
            />
          ) : null}
        </TTCard>

      ))}
    </section>
  );
}
