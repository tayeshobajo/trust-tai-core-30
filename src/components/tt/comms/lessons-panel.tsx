/**
 * Writing habits kept from decisions (C19).
 *
 * A decided finding can be kept as one habit chosen from a fixed list, and
 * later reviews in this workspace are shown that list's own wording. Nothing
 * is kept automatically, nothing edits a voice rule, and nothing a person
 * types here is ever shown to a review: a typed note stays a note, because no
 * check can tell a preference from a fact like "Acme prefers Tuesday".
 */

import { useState } from "react";

import { TTButton } from "@/components/tt/primitives";
import {
  activeLessons,
  canPromoteLesson,
  isDecided,
  lessonCandidate,
  lessonCategory,
  validatePrivateNote,
  LESSON_CATEGORIES,
  type LessonCategoryId,
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
  onKeep: (input: { findingId: string; category: string; privateNote?: string }) => void;
  onRevoke: (lessonId: string) => void;
}) {
  const [drafting, setDrafting] = useState<{
    findingId: string;
    category: LessonCategoryId;
    privateNote: string;
  } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const mayKeep = canPromoteLesson(role);
  const live = activeLessons(lessons);
  const keptFrom = new Set(lessons.map((lesson) => lesson.sourceFindingId));
  const candidates = findings.filter((finding) => isDecided(finding) && !keptFrom.has(finding.id));

  return (
    <div className="rounded-lg border border-border bg-card/60 p-4" data-testid="review-lessons">
      <h4 className="text-sm font-medium text-foreground">Writing habits kept here</h4>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>

      {live.length > 0 ? (
        <ul className="mt-3 space-y-3">
          {live.map((lesson) => (
            <li key={lesson.id} className="text-xs text-muted-foreground">
              <p className="text-foreground">
                {lessonCategory(lesson.category)?.guidance ?? lesson.category}
              </p>
              <p className="mt-1">From a decision: {lesson.sourceNote}</p>
              {lesson.privateNote ? <p className="mt-1">Note: {lesson.privateNote}</p> : null}
              {mayKeep ? (
                <button
                  type="button"
                  className="mt-1 underline underline-offset-2 hover:text-foreground"
                  onClick={() => onRevoke(lesson.id)}
                  disabled={busy}
                >
                  Stop using this habit
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
            Keep one of your decisions as a habit for later reviews. You choose from the list, so
            nothing this conversation said can travel into another one.
          </p>
          {drafting ? (
            <div className="mt-2 space-y-2">
              <label className="block text-xs text-muted-foreground" htmlFor="lesson-category">
                The habit to keep
              </label>
              <select
                id="lesson-category"
                value={drafting.category}
                onChange={(event) =>
                  setDrafting({ ...drafting, category: event.target.value as LessonCategoryId })
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {LESSON_CATEGORIES.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                A later review is shown exactly this: “{lessonCategory(drafting.category)?.guidance}”
              </p>
              <label className="block text-xs text-muted-foreground" htmlFor="lesson-note">
                A note for people here. Never shown to a review.
              </label>
              <textarea
                id="lesson-note"
                rows={2}
                value={drafting.privateNote}
                onChange={(event) => setDrafting({ ...drafting, privateNote: event.target.value })}
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
                    const problem = validatePrivateNote(drafting.privateNote);
                    if (problem) {
                      setRefusal(problem);
                      return;
                    }
                    setRefusal(null);
                    onKeep({
                      findingId: drafting.findingId,
                      category: drafting.category,
                      privateNote: drafting.privateNote.trim(),
                    });
                    setDrafting(null);
                  }}
                >
                  Keep this habit
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
                        category: lessonCandidate(finding)?.category ?? "shorter_and_plainer",
                        privateNote: "",
                      });
                    }}
                  >
                    Keep as a habit
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
