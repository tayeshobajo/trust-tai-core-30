/**
 * Manual milestone creation.
 *
 * Generation is assistance. This is the doorway a person walks through when
 * they already know the milestone. Only the name is required, because only the
 * name is required by the milestone itself. Anything a person does not type
 * stays empty rather than being invented for them.
 */

import { useState } from "react";

import { TTButton, TTInput } from "@/components/tt/primitives";
import { checkManualMilestone, type ManualMilestoneInput } from "@/domain/milestone-create";

export function ManualMilestoneForm({
  busy,
  error,
  onCreate,
  onCancel,
}: {
  busy: boolean;
  error: string | null;
  onCreate: (input: ManualMilestoneInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [whatWeBuild, setWhatWeBuild] = useState("");
  const [executionBoundary, setExecutionBoundary] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);

  function submit() {
    const checked = checkManualMilestone({ name, whatWeBuild, executionBoundary });
    if (!checked.ok) {
      setRefusal(checked.refusal);
      return;
    }
    setRefusal(null);
    onCreate(checked.milestone);
  }

  return (
    <div className="tt-surface space-y-4 p-5">
      <div>
        <p className="tt-eyebrow">Add milestone</p>
        <p className="mt-1 max-w-reading text-sm text-muted-foreground">
          Write the milestone in your own words. Typing it here is the decision, so it is saved as
          approved and decided with your name on it.
        </p>
      </div>

      <label className="block space-y-1">
        <span className="tt-eyebrow">Milestone</span>
        <TTInput
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="What has to be true"
          disabled={busy}
        />
      </label>

      <label className="block space-y-1">
        <span className="tt-eyebrow">What it builds, optional</span>
        <TTInput
          value={whatWeBuild}
          onChange={(event) => setWhatWeBuild(event.target.value)}
          placeholder="The asset or capability this creates"
          disabled={busy}
        />
      </label>

      <label className="block space-y-1">
        <span className="tt-eyebrow">Where it stops, optional</span>
        <TTInput
          value={executionBoundary}
          onChange={(event) => setExecutionBoundary(event.target.value)}
          placeholder="What is out of scope"
          disabled={busy}
        />
      </label>

      {refusal || error ? (
        <p className="text-sm text-destructive">{refusal ?? error}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Only the name is required. Anything you leave blank stays blank, never guessed.
        </p>
      )}

      <div className="flex gap-2">
        <TTButton onClick={submit} disabled={busy}>
          {busy ? "Saving…" : "Save milestone"}
        </TTButton>
        <TTButton variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </TTButton>
      </div>
    </div>
  );
}
