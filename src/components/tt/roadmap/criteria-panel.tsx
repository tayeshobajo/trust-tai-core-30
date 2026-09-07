/**
 * Milestone acceptance criteria: the conditions that must be true before this
 * milestone can be called complete.
 *
 * Deliberately simple. A person adds a line, checks it off when it is true,
 * rewords it if it was clumsy, and removes it if it should never have been
 * written. Checking every box is evidence, never a decision: the milestone is
 * still completed by a person, through the existing decision buttons.
 */

import { useState } from "react";

import { MetaPill, TTButton, TTInput } from "@/components/tt/primitives";
import {
  CriterionEvidencePanel,
  type EvidenceDraft,
} from "@/components/tt/roadmap/criterion-evidence";
import { evidenceFor, type CriterionEvidence } from "@/domain/criterion-evidence";
import {
  ACCEPTANCE_IS_EVIDENCE,
  ACCEPTANCE_MET,
  NO_CRITERIA,
  canRemoveCriterion,
  checkCriterionText,
  criteriaProgress,
  sortCriteria,
  type AcceptanceCriterion,
} from "@/domain/milestone-criteria";

function Row({
  criterion,
  busy,
  first,
  last,
  evidence,
  evidenceError,
  onToggle,
  onEdit,
  onRemove,
  onMove,
  onEvidenceAdd,
  onEvidenceRemove,
  onEvidenceOpen,
  onEvidenceUrl,
}: {
  criterion: AcceptanceCriterion;
  busy: boolean;
  first: boolean;
  last: boolean;
  evidence: CriterionEvidence[];
  evidenceError: string | null;
  onToggle: (criterion: AcceptanceCriterion, done: boolean) => void;
  onEdit: (criterion: AcceptanceCriterion, text: string) => void;
  onRemove: (criterion: AcceptanceCriterion) => void;
  onMove: (criterion: AcceptanceCriterion, direction: "up" | "down") => void;
  onEvidenceAdd?: ((criterion: AcceptanceCriterion, draft: EvidenceDraft) => void) | undefined;
  onEvidenceRemove?: ((item: CriterionEvidence) => void) | undefined;
  onEvidenceOpen?: ((item: CriterionEvidence) => void) | undefined;
  onEvidenceUrl?: ((item: CriterionEvidence) => Promise<string>) | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(criterion.text);
  const [refusal, setRefusal] = useState<string | null>(null);

  const save = () => {
    const checked = checkCriterionText(text);
    if (!checked.ok) {
      setRefusal(checked.refusal);
      return;
    }
    setRefusal(null);
    setEditing(false);
    onEdit(criterion, checked.text);
  };

  const remove = () => {
    const allowed = canRemoveCriterion(criterion);
    if (!allowed.ok) {
      setRefusal(allowed.refusal);
      return;
    }
    setRefusal(null);
    onRemove(criterion);
  };

  return (
    <li className="group flex items-start gap-3 py-2">
      <input
        type="checkbox"
        checked={criterion.done}
        disabled={busy}
        onChange={(event) => onToggle(criterion, event.target.checked)}
        aria-label={criterion.text}
        className="mt-1 size-4 rounded border-border"
      />
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="space-y-2">
            <TTInput
              value={text}
              onChange={(event) => setText(event.target.value)}
              aria-label={`Reword ${criterion.text}`}
            />
            <div className="flex gap-2">
              <TTButton size="sm" disabled={busy} onClick={save}>
                Save
              </TTButton>
              <TTButton
                size="sm"
                variant="quiet"
                disabled={busy}
                onClick={() => {
                  setText(criterion.text);
                  setRefusal(null);
                  setEditing(false);
                }}
              >
                Cancel
              </TTButton>
            </div>
          </div>
        ) : (
          <p
            className={
              criterion.done
                ? "text-sm text-muted-foreground line-through"
                : "text-sm text-foreground"
            }
          >
            {criterion.text}
          </p>
        )}
        {!editing && onEvidenceAdd ? (
          <CriterionEvidencePanel
            criterionText={criterion.text}
            items={evidence}
            evidenceError={evidenceError}
            busy={busy}
            onAdd={(draft) => onEvidenceAdd(criterion, draft)}
            {...(onEvidenceRemove ? { onRemove: onEvidenceRemove } : {})}
            {...(onEvidenceOpen ? { onOpenFile: onEvidenceOpen } : {})}
            {...(onEvidenceUrl ? { resolveUrl: onEvidenceUrl } : {})}
          />
        ) : null}
        {refusal ? <p className="mt-1 text-xs text-destructive">{refusal}</p> : null}
      </div>
      {editing ? null : (
        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            disabled={busy || first}
            onClick={() => onMove(criterion, "up")}
            className="hover:text-foreground disabled:opacity-30"
            aria-label={`Move ${criterion.text} up`}
          >
            Up
          </button>
          <button
            type="button"
            disabled={busy || last}
            onClick={() => onMove(criterion, "down")}
            className="hover:text-foreground disabled:opacity-30"
            aria-label={`Move ${criterion.text} down`}
          >
            Down
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditing(true)}
            className="hover:text-foreground"
            aria-label={`Edit ${criterion.text}`}
          >
            Edit
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={remove}
            className="hover:text-foreground"
            aria-label={`Remove ${criterion.text}`}
          >
            Remove
          </button>
        </div>
      )}
    </li>
  );
}

export function CriteriaPanel({
  criteria,
  criteriaError = null,
  evidence = [],
  evidenceError = null,
  subject,
  busy,
  onAdd,
  onToggle,
  onEdit,
  onRemove,
  onMove,
  onEvidenceAdd,
  onEvidenceRemove,
  onEvidenceOpen,
  onEvidenceUrl,
}: {
  criteria: AcceptanceCriterion[];
  criteriaError?: string | null;
  /** Proof attached across this milestone's conditions. Optional by default. */
  evidence?: CriterionEvidence[];
  evidenceError?: string | null;
  subject: string;
  busy: boolean;
  onAdd: (text: string) => void;
  onToggle: (criterion: AcceptanceCriterion, done: boolean) => void;
  onEdit: (criterion: AcceptanceCriterion, text: string) => void;
  onRemove: (criterion: AcceptanceCriterion) => void;
  onMove: (criterion: AcceptanceCriterion, direction: "up" | "down") => void;
  onEvidenceAdd?: ((criterion: AcceptanceCriterion, draft: EvidenceDraft) => void) | undefined;
  onEvidenceRemove?: ((item: CriterionEvidence) => void) | undefined;
  onEvidenceOpen?: ((item: CriterionEvidence) => void) | undefined;
  onEvidenceUrl?: ((item: CriterionEvidence) => Promise<string>) | undefined;
}) {
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const rows = sortCriteria(criteria);
  const progress = criteriaProgress(rows);

  const add = () => {
    const checked = checkCriterionText(text);
    if (!checked.ok) {
      setRefusal(checked.refusal);
      return;
    }
    setRefusal(null);
    setText("");
    setAdding(false);
    onAdd(checked.text);
  };

  return (
    <section className="mt-5 rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="tt-eyebrow">Acceptance criteria</p>
        {rows.length > 0 ? (
          <MetaPill>
            {progress.met ? ACCEPTANCE_MET : `${progress.done}/${progress.total}`}
          </MetaPill>
        ) : null}
      </div>

      {criteriaError ? (
        <p className="mt-3 text-sm text-muted-foreground">{criteriaError}</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {NO_CRITERIA}. Write the conditions that have to be true before this is done.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {rows.map((criterion, index) => (
            <Row
              key={criterion.id}
              criterion={criterion}
              busy={busy}
              first={index === 0}
              last={index === rows.length - 1}
              evidence={evidenceFor(evidence, criterion.id)}
              evidenceError={evidenceError}
              onToggle={onToggle}
              onEdit={onEdit}
              onRemove={onRemove}
              onMove={onMove}
              {...(onEvidenceAdd ? { onEvidenceAdd } : {})}
              {...(onEvidenceRemove ? { onEvidenceRemove } : {})}
              {...(onEvidenceOpen ? { onEvidenceOpen } : {})}
              {...(onEvidenceUrl ? { onEvidenceUrl } : {})}
            />
          ))}
        </ul>
      )}

      {progress.met ? (
        <p className="mt-3 text-sm text-foreground">{ACCEPTANCE_IS_EVIDENCE}</p>
      ) : null}

      {adding ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <TTInput
            value={text}
            autoFocus
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") add();
            }}
            placeholder="Home page approved"
            aria-label={`Add an acceptance condition to ${subject}`}
            className="max-w-sm"
          />
          <TTButton size="sm" variant="secondary" disabled={busy} onClick={add}>
            Add condition
          </TTButton>
          <TTButton
            size="sm"
            variant="quiet"
            disabled={busy}
            onClick={() => {
              setText("");
              setRefusal(null);
              setAdding(false);
            }}
          >
            Cancel
          </TTButton>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => setAdding(true)}
          className="mt-3 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Add condition
        </button>
      )}

      {refusal ? <p className="mt-2 text-sm text-destructive">{refusal}</p> : null}
    </section>
  );
}
