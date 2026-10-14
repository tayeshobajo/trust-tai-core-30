import { useEffect, useRef, useState } from "react";
import { TTButton, TTInput } from "@/components/tt/primitives";
import type { Roadmap } from "@/domain/roadmap";
import { PIPELINE_STAGES } from "@/domain/roadmap-tracker";
import {
  EDIT_LABELS,
  editableValues,
  editHistory,
  roadmapRevision,
  trackerPatchSchema,
  type EditField,
  type TrackerOwner,
  type TrackerPatch,
} from "@/domain/roadmap-tracker-edit";
import { trackerEditorClient, TrackerSaveError } from "@/data/roadmap-tracker/editor-client";

const control =
  "mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
const dates = new Set<EditField>([
  "followUpDate",
  "dateSent",
  "dateClosed",
  "lastMeaningfulUpdate",
]);
const long = new Set<EditField>([
  "nextAction",
  "conversationPosition",
  "clientSignal",
  "keyLinks",
  "endOfWeekStatus",
]);
function values(roadmap: Roadmap) {
  return Object.fromEntries(
    Object.entries(editableValues(roadmap)).map(([k, v]) => [k, v ?? ""]),
  ) as Record<EditField, string>;
}
export function TrackerEditor({
  roadmap,
  userId,
  owners,
  canWork,
  onSaved,
  onDirtyChange,
}: {
  roadmap: Roadmap;
  userId: string;
  owners: TrackerOwner[];
  canWork: boolean;
  onSaved: (r: Roadmap) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [base, setBase] = useState(roadmap);
  const [draft, setDraft] = useState(() => values(roadmap));
  const [current, setCurrent] = useState<Roadmap | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<{ id: string; patch: TrackerPatch } | null>(null);
  const patch = Object.fromEntries(
    (Object.keys(EDIT_LABELS) as EditField[])
      .filter((k) => draft[k] !== values(base)[k])
      .map((k) => [k, draft[k].trim() || null]),
  ) as TrackerPatch;
  const dirty = Object.keys(patch).length > 0;
  useEffect(() => onDirtyChange?.(dirty || uncertain), [dirty, uncertain, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function accept(saved: Roadmap, text: string) {
    setBase(saved);
    setDraft(values(saved));
    setCurrent(null);
    setUncertain(false);
    setError(null);
    setMessage(text);
    pending.current = null;
    onSaved(saved);
  }
  async function save() {
    const parsed = trackerPatchSchema.safeParse(patch);
    if (!parsed.success) {
      setError(parsed.error.issues.map((x) => x.message).join(" "));
      return;
    }
    const operation = pending.current ?? { id: crypto.randomUUID(), patch: parsed.data };
    pending.current = operation;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await trackerEditorClient.save(
        {
          organizationId: base.organizationId,
          roadmapId: base.id,
          operationId: operation.id,
          expectedRevision: roadmapRevision(base),
          patch: operation.patch,
        },
        userId,
      );
      accept(result.roadmap, result.warning || "Saved. Edit history recorded.");
      if (result.warning) pending.current = operation;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save was not confirmed.");
      if (e instanceof TrackerSaveError && e.current) setCurrent(e.current);
      // Always read back before another attempt, including a timed-out response.
      setUncertain(true);
    } finally {
      setBusy(false);
    }
  }
  async function readBack() {
    setBusy(true);
    setError(null);
    try {
      const result = await trackerEditorClient.read(base.organizationId, base.id, userId);
      if (
        pending.current &&
        editHistory(result.roadmap).some((e) => e.id === pending.current?.id)
      ) {
        // Retry the same operation only to acknowledge its durable receipt and mirror history.
        const operation = pending.current;
        const saved = await trackerEditorClient.save(
          {
            organizationId: base.organizationId,
            roadmapId: base.id,
            operationId: pending.current.id,
            expectedRevision: roadmapRevision(base),
            patch: pending.current.patch,
          },
          userId,
        );
        accept(
          saved.roadmap,
          saved.warning || "Saved earlier. Confirmed from edit history; no duplicate edit.",
        );
        if (saved.warning) pending.current = operation;
      } else if (roadmapRevision(result.roadmap) !== roadmapRevision(base)) {
        setCurrent(result.roadmap);
        setUncertain(false);
        setMessage("Latest saved values are ready to compare. Your draft is retained.");
      } else {
        setUncertain(false);
        setMessage("Saved state checked. Your draft has not been applied; you can retry.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "The saved state could not be checked.");
      setUncertain(true);
    } finally {
      setBusy(false);
    }
  }
  function field(key: EditField) {
    const change = (value: string) => {
      setDraft((d) => ({ ...d, [key]: value }));
      setMessage(null);
      pending.current = null;
    };
    const props = {
      value: draft[key],
      disabled: !canWork || busy || uncertain || Boolean(current),
      onChange: (
        e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
      ) => change(e.target.value),
      className: control,
    };
    return (
      <label key={key} className={long.has(key) ? "block text-sm sm:col-span-2" : "block text-sm"}>
        {EDIT_LABELS[key]}
        {key === "pipelineStage" ? (
          <select {...props}>
            <option value="">Unknown</option>
            {PIPELINE_STAGES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        ) : key === "ownerUserId" ? (
          <select {...props}>
            <option value="">Unassigned</option>
            {!owners.some((o) => o.userId === draft.ownerUserId) && draft.ownerUserId ? (
              <option value={draft.ownerUserId}>Current owner · {draft.ownerUserId}</option>
            ) : null}
            {owners.map((o) => (
              <option key={o.userId} value={o.userId}>
                {o.label}
              </option>
            ))}
          </select>
        ) : long.has(key) ? (
          <textarea {...props} rows={3} maxLength={4000} />
        ) : (
          <TTInput
            {...props}
            type={dates.has(key) ? "date" : key === "conversionDays" ? "number" : "text"}
            min={key === "conversionDays" ? 0 : undefined}
            step={key === "conversionDays" ? 1 : undefined}
          />
        )}
      </label>
    );
  }
  return (
    <section
      aria-label={`Edit ${base.subjectLabel} tracker`}
      className="rounded-xl border border-border bg-card p-5 space-y-5"
    >
      <div>
        <h3 className="font-display text-2xl">{base.subjectLabel}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Pipeline stages track the conversation. Approvals, publication and payments stay in their
          existing workflows.
        </p>
      </div>
      {!canWork ? <p role="status">You have read-only access to Roadmaps.</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {(
          ["pipelineStage", "priority", "ownerUserId", "followUpDate", "nextAction"] as EditField[]
        ).map(field)}
      </div>
      <details>
        <summary className="min-h-11 cursor-pointer text-sm font-medium">
          Conversation details and dates
        </summary>
        <div className="grid gap-4 sm:grid-cols-2">
          {(Object.keys(EDIT_LABELS) as EditField[])
            .filter(
              (k) =>
                ![
                  "pipelineStage",
                  "priority",
                  "ownerUserId",
                  "followUpDate",
                  "nextAction",
                ].includes(k),
            )
            .map(field)}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Clearing a field explicitly records it as unknown. Preview date sent is not a priced
          proposal or delivery receipt. Last meaningful update is separate from this edit’s save
          time.
        </p>
      </details>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
      {current ? (
        <div className="rounded-lg border border-warning/40 p-4 space-y-3">
          <p className="font-medium">Compare with the latest saved record</p>
          <dl className="grid gap-2 text-sm">
            {(Object.keys(patch) as EditField[]).map((k) => (
              <div key={k}>
                <dt>{EDIT_LABELS[k]}</dt>
                <dd>
                  Saved: {editableValues(current)[k] ?? "Unknown"}
                  <br />
                  Your draft: {draft[k] || "Unknown"}
                </dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-2">
            <TTButton
              variant="secondary"
              disabled={busy}
              onClick={() => accept(current, "Loaded the latest saved values.")}
            >
              Use saved values
            </TTButton>
            <TTButton
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setDraft({
                  ...values(current),
                  ...Object.fromEntries(Object.keys(patch).map((k) => [k, draft[k as EditField]])),
                });
                setBase(current);
                setCurrent(null);
                setUncertain(false);
                pending.current = null;
                setError(null);
                setMessage(
                  "Draft retained against the reviewed record. Save to apply your changes.",
                );
              }}
            >
              Keep draft after review
            </TTButton>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <TTButton
          disabled={!canWork || !dirty || busy || uncertain || Boolean(current)}
          onClick={() => void save()}
        >
          {busy ? "Working…" : "Save changes"}
        </TTButton>
        <TTButton variant="secondary" disabled={busy} onClick={() => void readBack()}>
          Check saved state
        </TTButton>
        {dirty && !uncertain && !current ? (
          <TTButton
            variant="quiet"
            disabled={busy}
            onClick={() => {
              setDraft(values(base));
              pending.current = null;
              setError(null);
              setMessage("Draft changes discarded.");
            }}
          >
            Discard draft
          </TTButton>
        ) : null}
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {dirty ? "Unsaved changes" : "Up to date"}
        </span>
      </div>
      <details>
        <summary className="min-h-11 cursor-pointer text-sm font-medium">
          Edit history ({editHistory(base).length})
        </summary>
        {editHistory(base).length ? (
          <ol className="space-y-4 text-sm">
            {[...editHistory(base)].reverse().map((e) => (
              <li key={e.id}>
                <p>
                  {e.at} · {owners.find((o) => o.userId === e.actorUserId)?.label ?? e.actorUserId}
                </p>
                <ul className="mt-1 space-y-1 text-muted-foreground">
                  {e.changes.map((c) => (
                    <li key={c.field}>
                      {EDIT_LABELS[c.field]}: {c.before ?? "Unknown"} → {c.after ?? "Unknown"}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">No tracker edits recorded yet.</p>
        )}
      </details>
    </section>
  );
}
