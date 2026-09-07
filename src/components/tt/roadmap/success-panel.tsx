/**
 * The everyday face of a milestone: what success looks like, and by when.
 *
 * People describe success. The system structures measurement. Nothing here
 * asks for a key, a unit or a direction, and an empty target date stays empty
 * rather than quietly becoming today.
 */

import { useState, type RefObject } from "react";
import { toast } from "sonner";

import { TTButton, TTInput } from "@/components/tt/primitives";
import {
  NO_SUCCESS,
  NO_TARGET_DATE,
  checkMilestoneSuccess,
  type MilestoneSuccess,
  type MilestoneSuccessInput,
} from "@/domain/milestone-success";

export function SuccessPanel({
  success,
  subject,
  busy,
  onSave,
  open: controlledOpen,
  onOpenChange,
  editorRef,
}: {
  success: MilestoneSuccess | null;
  subject: string;
  busy: boolean;
  onSave: (input: MilestoneSuccessInput) => void;
  /** When given, the card owns the one primary action and this panel hides its own. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Lets the card reveal and focus this editor when an action opens it. */
  editorRef?: RefObject<HTMLDivElement | null> | undefined;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : ownOpen;
  const setOpen = (next: boolean) => {
    if (controlled) onOpenChange?.(next);
    else setOwnOpen(next);
  };
  const [outcome, setOutcome] = useState(success?.outcome ?? "");
  const [targetDate, setTargetDate] = useState(success?.targetDate ?? "");
  const [successCheck, setSuccessCheck] = useState(success?.successCheck ?? "");
  const [refusal, setRefusal] = useState<string | null>(null);

  const submit = () => {
    const checked = checkMilestoneSuccess({ outcome, targetDate, successCheck });
    if (!checked.ok) {
      setRefusal(checked.refusal);
      return;
    }
    setRefusal(null);
    onSave(checked.success);
    toast.success("Outcome saved", { description: subject });
    setOpen(false);
  };

  return (
    <section className="mt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <p className="tt-eyebrow">Outcome</p>
              <p
                className={`mt-1 max-w-reading text-[15px] leading-relaxed ${
                  success?.outcome ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {success?.outcome || NO_SUCCESS}
              </p>
            </div>
            <div className="sm:text-right">
              <p className="tt-eyebrow">Target date</p>
              <p
                className={`mt-1 text-[15px] leading-relaxed ${
                  success?.targetDate ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {success?.targetDate || NO_TARGET_DATE}
              </p>
            </div>
          </div>
          {success?.successCheck ? (
            <p className="mt-2 max-w-reading text-[13px] text-muted-foreground">
              How we will know: {success.successCheck}
            </p>
          ) : null}
        </div>
        {controlled ? null : (
          <TTButton
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setOutcome(success?.outcome ?? "");
              setTargetDate(success?.targetDate ?? "");
              setSuccessCheck(success?.successCheck ?? "");
              setRefusal(null);
              setOpen(!open);
            }}
          >
            {open ? "Cancel" : success ? "Edit outcome" : "Describe success"}
          </TTButton>
        )}
      </div>

      {open ? (
        <div
          ref={editorRef ?? null}
          className="tt-panel-enter tt-reveal-target mt-4 space-y-3 rounded-2xl border border-border p-4"
        >
          <label className="block">
            <span className="tt-eyebrow">What success looks like</span>
            <span className="mt-1 block">
              <TTInput
                value={outcome}
                onChange={(event) => setOutcome(event.target.value)}
                placeholder="Front facing pages redesigned and approved"
                aria-label={`Outcome for ${subject}`}
              />
            </span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="tt-eyebrow">Target date, optional</span>
              <span className="mt-1 block">
                <TTInput
                  type="date"
                  value={targetDate}
                  onChange={(event) => setTargetDate(event.target.value)}
                  aria-label={`Target date for ${subject}`}
                />
              </span>
            </label>
            <label className="block">
              <span className="tt-eyebrow">How we will know it worked, optional</span>
              <span className="mt-1 block">
                <TTInput
                  value={successCheck}
                  onChange={(event) => setSuccessCheck(event.target.value)}
                  placeholder="Client signs off in the review call"
                  aria-label={`Success check for ${subject}`}
                />
              </span>
            </label>
          </div>
          {refusal ? <p className="text-sm text-destructive">{refusal}</p> : null}
          <div className="flex flex-wrap gap-2">
            <TTButton size="sm" disabled={busy} onClick={submit}>
              Save outcome
            </TTButton>
            {controlled ? (
              <TTButton size="sm" variant="quiet" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </TTButton>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
