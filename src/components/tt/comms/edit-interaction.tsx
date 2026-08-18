/**
 * Correct or withdraw an interaction.
 *
 * A record can be wrong without being false. This lets a person fix the wording
 * or withdraw the entry, while the moment it happened, who logged it, and the
 * original words all stay on the record underneath.
 */

import { useState } from "react";

import { TTButton, TTField } from "@/components/tt/primitives";
import type { Touch } from "@/domain/comms";
import { readTouchRecord, recordNote } from "@/domain/comms-touch-record";

export interface InteractionEdit {
  summary: string;
  body?: string | null;
}

export function EditInteraction({
  touch,
  personName,
  userLabel,
  busy,
  onCancel,
  onSave,
  onRetract,
  onRestore,
}: {
  touch: Touch;
  personName: string;
  userLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onSave: (edit: InteractionEdit) => void;
  onRetract: (because: string) => void;
  onRestore: () => void;
}) {
  const record = readTouchRecord(touch.provenance);
  const note = recordNote(record);
  const [summary, setSummary] = useState(touch.summary);
  const [body, setBody] = useState(touch.body ?? "");
  const [retracting, setRetracting] = useState(false);
  const [because, setBecause] = useState("");

  const occurred = new Date(touch.occurredAt);
  const occurredLabel = Number.isNaN(occurred.getTime())
    ? "an unknown time"
    : occurred.toLocaleString();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit an interaction with ${personName}`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/25 p-0 backdrop-blur-sm sm:items-center sm:p-6"
    >
      <button type="button" aria-label="Close" className="absolute inset-0" onClick={onCancel} />
      <div className="tt-rise relative flex max-h-[92vh] w-full max-w-[600px] flex-col overflow-hidden rounded-t-xl border border-border bg-card sm:rounded-xl">
        <header className="border-b border-border px-5 py-4">
          <p className="tt-eyebrow">Edit interaction</p>
          <h2 className="mt-1 text-lg text-foreground">Correct what is on the record</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Recorded as happening {occurredLabel}. That timestamp and its original wording are
            kept; your correction is added as {userLabel}.
          </p>
          {note ? <p className="mt-1.5 text-[12px] text-muted-foreground">{note}</p> : null}
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {retracting ? (
            <TTField label="Why is this being withdrawn" optional>
              <textarea
                value={because}
                onChange={(event) => setBecause(event.target.value)}
                rows={3}
                placeholder="This never happened, it was logged on the wrong relationship."
                className="w-full rounded-lg border border-input bg-card px-3.5 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </TTField>
          ) : (
            <>
              <TTField label="What happened">
                <textarea
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-input bg-card px-3.5 py-2.5 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </TTField>
              {touch.body !== undefined || body ? (
                <TTField label="The longer capture" optional>
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    rows={6}
                    className="w-full rounded-lg border border-input bg-card px-3.5 py-2.5 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </TTField>
              ) : null}
              <p className="text-[12px] text-muted-foreground">
                Editing changes what the timeline reads, not what already happened. Facts already
                saved to memory stay where they are.
              </p>
            </>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">
          {record.retracted ? (
            <TTButton variant="quiet" size="sm" type="button" onClick={onRestore} disabled={busy}>
              Restore this entry
            </TTButton>
          ) : (
            <TTButton
              variant="quiet"
              size="sm"
              type="button"
              onClick={() => setRetracting((value) => !value)}
              disabled={busy}
            >
              {retracting ? "Keep it" : "Retract"}
            </TTButton>
          )}
          <div className="flex items-center gap-2">
            <TTButton variant="quiet" size="sm" type="button" onClick={onCancel}>
              Cancel
            </TTButton>
            {retracting ? (
              <TTButton size="sm" type="button" onClick={() => onRetract(because)} disabled={busy}>
                {busy ? "Saving…" : "Confirm retraction"}
              </TTButton>
            ) : (
              <TTButton
                size="sm"
                type="button"
                disabled={busy || !summary.trim()}
                onClick={() =>
                  onSave({
                    summary: summary.trim(),
                    ...(touch.body !== undefined || body ? { body: body.trim() || null } : {}),
                  })
                }
              >
                {busy ? "Saving…" : "Save correction"}
              </TTButton>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
