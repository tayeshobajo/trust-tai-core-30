/**
 * Lessons kept from decisions (C19).
 *
 * A decided finding can be kept as a lesson, in the promoter's own words,
 * and later reviews in this workspace are shown it as guidance about how to
 * write. Nothing is kept automatically, nothing edits a voice rule, and a
 * lesson that carries a figure, a link or an address is refused so that one
 * conversation's facts can never be reused in another.
 */

import { useState } from "react";

import { TTButton } from "@/components/tt/primitives";
import {
  activeLessons,
  canPromoteLesson,
  isDecided,
  lessonCandidate,
  validateLesson,
  type ReviewLesson,
} from "@/domain/comms-lessons";
import type { ReviewFinding } from "@/domain/comms-review";

export function LessonsPanel({
  role,
  findings,
  lessons,
  available,
  note,
  busy,
  onKeep,
  onRevoke,
}: {
  role: string;
  findings: ReviewFinding[];
  lessons: ReviewLesson[];
  available: boolean;
  note: string;
  busy?: boolean;
  onKeep: (input: { findingId: string; lesson: string }) => void;
  onRevoke: (lessonId: string) => void;
}) {
  const [drafting, setDrafting] = useState<{ findingId: string; text: string } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const mayKeep = canPromoteLesson(role);
  const live = activeLessons(lessons);
  const keptFrom = new Set(lessons.map((lesson) => lesson.sourceFindingId));
  const candidates = findings.filter((finding) => isDecided(finding) && !keptFrom.has(finding.id));

  return (
    <div className="rounded-lg border border-border bg-card/60 p-4" data-testid="review-lessons">
      <h4 className="text-sm font-medium text-foreground">Lessons kept here</h4>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>

      {live.length > 0 ? (
        <ul className="mt-3 space-y-3">
          {live.map((lesson) => (
            <li key={lesson.id} className="text-xs text-muted-foreground">
              <p className="text-foreground">{lesson.lesson}</p>
              <p className="mt-1">From a decision: {lesson.sourceNote}</p>
              {mayKeep ? (
                <button
                  type="button"
                  className="mt-1 underline underline-offset-2 hover:text-foreground"
                  onClick={() => onRevoke(lesson.id)}
                  disabled={busy}
                >
                  Stop using this lesson
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : available ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Nothing has been kept yet. Reviews behave exactly as they always have.
        </p>
      ) : null}

      {available && mayKeep && candidates.length > 0 ? (
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">
            Keep one of your decisions as guidance for later reviews. Say what to do differently,
            not what anybody said.
          </p>
          {drafting ? (
            <div className="mt-2 space-y-2">
              <textarea
                rows={2}
                aria-label="The lesson to keep"
                value={drafting.text}
                onChange={(event) => setDrafting({ ...drafting, text: event.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {refusal ? (
                <p role="alert" className="text-xs text-destructive">
                  {refusal}
                </p>
              ) : null}
              <div className="flex gap-2">
                <TTButton
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    const problem = validateLesson(drafting.text);
                    if (problem) {
                      setRefusal(problem);
                      return;
                    }
                    setRefusal(null);
                    onKeep({ findingId: drafting.findingId, lesson: drafting.text.trim() });
                    setDrafting(null);
                  }}
                >
                  Keep this lesson
                </TTButton>
                <TTButton variant="quiet" size="sm" onClick={() => setDrafting(null)}>
                  Cancel
                </TTButton>
              </div>
            </div>
          ) : (
            <ul className="mt-2 space-y-2">
              {candidates.map((finding) => (
                <li key={finding.id} className="text-xs text-muted-foreground">
                  <p className="text-foreground">{finding.why}</p>
                  <button
                    type="button"
                    className="mt-1 underline underline-offset-2 hover:text-foreground"
                    onClick={() => {
                      setRefusal(null);
                      setDrafting({
                        findingId: finding.id,
                        text: lessonCandidate(finding)?.lesson ?? "",
                      });
                    }}
                  >
                    Keep as a lesson
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
