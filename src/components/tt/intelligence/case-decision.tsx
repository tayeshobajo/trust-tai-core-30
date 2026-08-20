/**
 * The smallest way a reading becomes experience.
 *
 * Looking at a pattern changes nothing. Saying what you decided about it, in
 * your own words, opens a case: the reading, the evidence it stood on, and
 * your decision. Saying the reading itself was off records a correction, which
 * outranks anything the system later works out on its own.
 *
 * Nothing here executes work, and nothing here edits a pattern.
 */

import { useState } from "react";

import { TTButton } from "@/components/tt/primitives";
import type { PatternMatch } from "@/domain/intelligence-canon";

export interface CaseDecisionDraft {
  match: PatternMatch;
  decision: string;
  /** Present when the person says the reading itself was wrong or incomplete. */
  correction?: string;
}

export interface CaseDecisionProps {
  match: PatternMatch;
  saving?: boolean;
  /** Set once a case exists for this reading. */
  recorded?: boolean;
  onRecord: (draft: CaseDecisionDraft) => void | Promise<void>;
  /** Existing feedback path for a reading that was not worth raising. */
  onNotUseful?: (match: PatternMatch) => void | Promise<void>;
  notUsefulSaved?: boolean;
}

export function CaseDecision({
  match,
  saving,
  recorded,
  onRecord,
  onNotUseful,
  notUsefulSaved,
}: CaseDecisionProps) {
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState("");
  const [correction, setCorrection] = useState("");
  const [correcting, setCorrecting] = useState(false);

  if (recorded) {
    return (
      <p className="mt-3 border-t border-border pt-3 text-[13px] text-muted-foreground">
        Your decision on this reading is in the case ledger. What happens next gets checked in the
        room that owns it.
      </p>
    );
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      {open ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (decision.trim().length === 0) return;
            void onRecord({
              match,
              decision: decision.trim(),
              ...(correcting && correction.trim().length > 0
                ? { correction: correction.trim() }
                : {}),
            });
          }}
        >
          <label htmlFor={`decision-${match.patternId}`} className="tt-eyebrow">
            What did you decide
          </label>
          <textarea
            id={`decision-${match.patternId}`}
            rows={2}
            value={decision}
            onChange={(event) => setDecision(event.target.value)}
            placeholder="Named an owner for the two late projects and asked for a date by Friday."
            className="w-full resize-none rounded-md border border-border bg-transparent p-2.5 text-[13px] leading-relaxed outline-none focus:border-foreground"
          />

          {correcting ? (
            <>
              <label htmlFor={`correction-${match.patternId}`} className="tt-eyebrow">
                What the reading got wrong
              </label>
              <textarea
                id={`correction-${match.patternId}`}
                rows={2}
                value={correction}
                onChange={(event) => setCorrection(event.target.value)}
                placeholder="This was not founder held context. The acceptance criteria were unclear."
                className="w-full resize-none rounded-md border border-border bg-transparent p-2.5 text-[13px] leading-relaxed outline-none focus:border-foreground"
              />
            </>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <TTButton type="submit" disabled={saving || decision.trim().length === 0}>
              {saving ? "Recording" : "Record this decision"}
            </TTButton>
            <TTButton
              type="button"
              variant="quiet"
              onClick={() => setCorrecting((current) => !current)}
            >
              {correcting ? "Never mind the correction" : "The reading was off"}
            </TTButton>
          </div>
          <p className="text-[12px] text-muted-foreground">
            This records what you decided and the evidence it stood on. It moves no work and edits
            no pattern.
          </p>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <TTButton variant="secondary" onClick={() => setOpen(true)}>
            I acted on this
          </TTButton>
          {onNotUseful ? (
            <TTButton
              variant="quiet"
              disabled={notUsefulSaved}
              onClick={() => void onNotUseful(match)}
            >
              {notUsefulSaved ? "Noted as not useful" : "Not useful"}
            </TTButton>
          ) : null}
        </div>
      )}
    </div>
  );
}
