/**
 * Manage this project: correct what a person typed, and move the work.
 *
 * Operability law (canon 16): a room that owns a truth must carry the control
 * that changes it. Everything a person was asked for when the project was
 * created is editable here. Everything that stays fixed says out loud that it
 * is fixed, and who owns it instead.
 *
 * Two halves, because they are two different decisions. "Project details" is a
 * correction to the record. "Move the work" is a change to reality. Neither
 * pretends to be the other.
 */

import { useEffect, useState } from "react";

import { TTButton, TTInput } from "@/components/tt/primitives";
import {
  EXECUTION_STATE_LABEL,
  IMMUTABLE_PROJECT_FACTS,
  checkDetailEdit,
  checkTransition,
  nextStates,
  type ExecutionProject,
  type ExecutionState,
  type ProjectDetailEdit,
} from "@/domain/projects";

const FIELD =
  "w-full rounded-xl border border-border bg-card px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** An ISO instant as the value a date input can hold. */
function dateValue(iso: string | undefined): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

export type ProjectUpdateChanges = ProjectDetailEdit & {
  state?: ExecutionState;
  nextMove?: string;
  blockedBecause?: string;
  waitingOn?: string;
};

export function ManageProjectPanel({
  project,
  busy,
  savedLabel,
  onUpdate,
}: {
  project: ExecutionProject;
  busy: boolean;
  /** Set by the room after a save lands, so a change visibly confirms. */
  savedLabel: string | null;
  onUpdate: (changes: ProjectUpdateChanges) => void;
}) {
  const [name, setName] = useState(project.name);
  const [pointA, setPointA] = useState(project.pointA);
  const [pointB, setPointB] = useState(project.pointB);
  const [dueDate, setDueDate] = useState(dateValue(project.dueDate));
  const [company, setCompany] = useState(project.origin.subjectLabel ?? "");

  const [blockedReason, setBlockedReason] = useState("");
  const [nextMove, setNextMove] = useState("");
  const [waitingOn, setWaitingOn] = useState("");

  // The saved record is the source of truth. When it changes underneath, the
  // form follows it rather than holding a stale draft.
  useEffect(() => {
    setName(project.name);
    setPointA(project.pointA);
    setPointB(project.pointB);
    setDueDate(dateValue(project.dueDate));
    setCompany(project.origin.subjectLabel ?? "");
  }, [
    project.id,
    project.name,
    project.pointA,
    project.pointB,
    project.dueDate,
    project.origin.subjectLabel,
    project.updatedAt,
  ]);

  const companyEditable = project.origin.kind === "manual";

  const edit: ProjectDetailEdit = {
    ...(name !== project.name ? { name } : {}),
    ...(pointA !== project.pointA ? { pointA } : {}),
    ...(pointB !== project.pointB ? { pointB } : {}),
    ...(dueDate !== dateValue(project.dueDate)
      ? { dueDate: dueDate ? new Date(`${dueDate}T12:00:00`).toISOString() : "" }
      : {}),
    ...(companyEditable && company !== (project.origin.subjectLabel ?? "")
      ? { subjectLabel: company }
      : {}),
  };
  const changedFields = Object.keys(edit);
  const check = checkDetailEdit(project, edit);
  const canSave = changedFields.length > 0 && check.ok && !busy;

  function resetDetails() {
    setName(project.name);
    setPointA(project.pointA);
    setPointB(project.pointB);
    setDueDate(dateValue(project.dueDate));
    setCompany(project.origin.subjectLabel ?? "");
  }

  return (
    <div className="space-y-6">
      <section aria-label="Project details" className="tt-surface space-y-4 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="tt-eyebrow">Project details</p>
          {savedLabel ? (
            <p role="status" className="text-[13px] text-royal">
              {savedLabel}
            </p>
          ) : null}
        </div>
        <p className="max-w-reading text-[13px] text-muted-foreground">
          Everything a person typed when this work started. Correct it here, and the correction is
          recorded like every other change.
        </p>

        <label className="block space-y-1.5">
          <span className="text-[12px] text-muted-foreground">Project name</span>
          <TTInput value={name} onChange={(event) => setName(event.target.value)} />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-[12px] text-muted-foreground">Company this serves</span>
            <TTInput
              value={company}
              readOnly={!companyEditable}
              aria-readonly={!companyEditable}
              placeholder={companyEditable ? "Who this work is for" : ""}
              onChange={(event) => setCompany(event.target.value)}
            />
            {!companyEditable ? (
              <span className="block text-[12px] text-muted-foreground">
                Roadmap owns this. It came across with the approved milestone.
              </span>
            ) : null}
          </label>
          <label className="block space-y-1.5">
            <span className="text-[12px] text-muted-foreground">Agreed date</span>
            <TTInput
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
            <span className="block text-[12px] text-muted-foreground">
              Clear it if no date was really agreed.
            </span>
          </label>
        </div>

        <label className="block space-y-1.5">
          <span className="text-[12px] text-muted-foreground">Where things stand (Point A)</span>
          <textarea
            rows={2}
            className={FIELD}
            value={pointA}
            onChange={(event) => setPointA(event.target.value)}
            placeholder="What is true today"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-[12px] text-muted-foreground">Outcome (Point B)</span>
          <textarea
            rows={2}
            className={FIELD}
            value={pointB}
            onChange={(event) => setPointB(event.target.value)}
            placeholder="What will be true when this is done"
          />
        </label>

        {changedFields.length > 0 && !check.ok ? (
          <p role="alert" className="text-[13px] text-destructive">
            {check.because}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <TTButton size="sm" disabled={!canSave} onClick={() => onUpdate(edit)}>
            Save details
          </TTButton>
          <TTButton
            size="sm"
            variant="quiet"
            disabled={busy || changedFields.length === 0}
            onClick={resetDetails}
          >
            Discard changes
          </TTButton>
          <span className="text-[12px] text-muted-foreground">
            {changedFields.length === 0
              ? "Nothing changed yet."
              : `${changedFields.length} field${changedFields.length === 1 ? "" : "s"} changed.`}
          </span>
        </div>

        <ul className="space-y-1 border-t border-border pt-3">
          {IMMUTABLE_PROJECT_FACTS.map((fact) => (
            <li key={fact.field} className="max-w-reading text-[12px] text-muted-foreground">
              <span className="text-foreground">{fact.field} stays as recorded.</span> {fact.because}
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Move the work" className="tt-surface space-y-4 p-6">
        <p className="tt-eyebrow">Move the work</p>
        <div className="flex flex-wrap gap-2">
          {nextStates(project).map((state) => {
            const transition = checkTransition(
              project,
              state,
              blockedReason.trim() ? { blockedBecause: blockedReason.trim() } : {},
            );
            return (
              <TTButton
                key={state}
                size="sm"
                variant={state === "blocked" ? "quiet" : "secondary"}
                disabled={busy || !transition.ok}
                title={transition.because}
                onClick={() =>
                  onUpdate({
                    state,
                    ...(state === "blocked" && blockedReason.trim()
                      ? { blockedBecause: blockedReason.trim() }
                      : {}),
                  })
                }
              >
                {EXECUTION_STATE_LABEL[state]}
              </TTButton>
            );
          })}
          {nextStates(project).length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              Closed work does not move again. Start it fresh if it is genuinely back.
            </p>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <TTInput
              value={nextMove}
              onChange={(event) => setNextMove(event.target.value)}
              placeholder={project.nextMove?.trim() || "Write the next move in one sentence"}
              aria-label="Next move"
            />
            <TTButton
              size="sm"
              disabled={busy || nextMove.trim().length === 0}
              onClick={() => {
                onUpdate({ nextMove: nextMove.trim() });
                setNextMove("");
              }}
            >
              Record next move
            </TTButton>
          </div>
          <div className="space-y-2">
            <TTInput
              value={blockedReason}
              onChange={(event) => setBlockedReason(event.target.value)}
              placeholder="What is blocking this"
              aria-label="Blocking reason"
            />
            <TTButton
              size="sm"
              variant="secondary"
              disabled={busy || blockedReason.trim().length === 0}
              onClick={() => {
                onUpdate({ state: "blocked", blockedBecause: blockedReason.trim() });
                setBlockedReason("");
              }}
            >
              Record a block
            </TTButton>
          </div>
        </div>

        <div className="space-y-2">
          <TTInput
            value={waitingOn}
            onChange={(event) => setWaitingOn(event.target.value)}
            placeholder={project.waitingOn?.trim() || "What this work is waiting on"}
            aria-label="Waiting on"
          />
          <div className="flex flex-wrap gap-2">
            <TTButton
              size="sm"
              variant="secondary"
              disabled={busy || waitingOn.trim().length === 0}
              onClick={() => {
                onUpdate({ waitingOn: waitingOn.trim() });
                setWaitingOn("");
              }}
            >
              Record what it waits on
            </TTButton>
            <TTButton
              size="sm"
              variant="quiet"
              disabled={busy || !project.waitingOn?.trim()}
              onClick={() => {
                onUpdate({ waitingOn: "" });
                setWaitingOn("");
              }}
            >
              The wait is over
            </TTButton>
          </div>
          <p className="text-[13px] text-muted-foreground">
            {project.waitingOn?.trim()
              ? `Waiting on ${project.waitingOn.trim()}. Clearing this is how the wait ends.`
              : "Nothing is on hold here. Waiting is read from this sentence, never set as a status."}
          </p>
        </div>

        <p className="max-w-reading text-[12px] text-muted-foreground">
          Who carries this work is changed on the owner picker in the rail beside this page.
        </p>
      </section>
    </div>
  );
}
