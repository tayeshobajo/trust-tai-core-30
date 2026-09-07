/**
 * Evidence on one acceptance condition.
 *
 * Quiet by default: a small link under the condition. Open it and you can
 * attach a file, paste a link, or write a line about what you saw. Nothing
 * here checks the condition, and nothing here completes a milestone.
 */

import { useRef, useState } from "react";
import { ExternalLink, FileText, Link2, StickyNote, Trash2 } from "lucide-react";

import { TTButton } from "@/components/tt/primitives";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  EVIDENCE_IS_NOT_A_DECISION,
  EVIDENCE_TYPE_LABEL,
  NO_EVIDENCE,
  checkEvidenceInput,
  evidenceSummary,
  type CriterionEvidence,
  type CriterionEvidenceType,
} from "@/domain/criterion-evidence";

const TYPE_ICON = {
  file: FileText,
  link: Link2,
  note: StickyNote,
} as const;

export interface EvidenceDraft {
  type: CriterionEvidenceType;
  label?: string;
  url?: string;
  note?: string;
  file?: File;
}

function EvidenceRow({
  item,
  busy,
  onOpen,
  onRemove,
}: {
  item: CriterionEvidence;
  busy: boolean;
  onOpen?: ((item: CriterionEvidence) => void) | undefined;
  onRemove?: ((item: CriterionEvidence) => void) | undefined;
}) {
  const Icon = TYPE_ICON[item.type];
  return (
    <li className="flex items-start justify-between gap-2 rounded-lg border border-border bg-background p-2">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[13px] text-foreground">
          <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{item.label}</span>
        </p>
        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {EVIDENCE_TYPE_LABEL[item.type]}
          {item.createdAt ? ` · ${new Date(item.createdAt).toLocaleDateString()}` : ""}
        </p>
        {item.note && item.note !== item.label ? (
          <p className="mt-1 text-[12px] text-muted-foreground">{item.note}</p>
        ) : null}
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-[12px] text-primary hover:underline"
          >
            <ExternalLink className="size-3" aria-hidden />
            Open link
          </a>
        ) : null}
        {item.storagePath && onOpen ? (
          <button
            type="button"
            onClick={() => onOpen(item)}
            className="mt-1 inline-flex items-center gap-1 text-[12px] text-primary hover:underline"
          >
            <ExternalLink className="size-3" aria-hidden />
            Open file
          </button>
        ) : null}
      </div>
      {onRemove ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onRemove(item)}
          aria-label={`Remove ${item.label}`}
          className="rounded-md p-1.5 text-muted-foreground transition hover:text-destructive disabled:opacity-50"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </li>
  );
}

export function CriterionEvidencePanel({
  criterionText,
  items,
  evidenceError = null,
  busy,
  onAdd,
  onRemove,
  onOpenFile,
}: {
  criterionText: string;
  items: CriterionEvidence[];
  evidenceError?: string | null;
  busy: boolean;
  onAdd: (draft: EvidenceDraft) => void;
  onRemove?: ((item: CriterionEvidence) => void) | undefined;
  onOpenFile?: ((item: CriterionEvidence) => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<CriterionEvidenceType>("link");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const reset = () => {
    setUrl("");
    setNote("");
    setFile(null);
    setRefusal(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const submit = () => {
    const checked = checkEvidenceInput({
      type,
      label: type === "file" ? file?.name : url,
      url,
      note,
    });
    if (!checked.ok) {
      setRefusal(checked.refusal);
      return;
    }
    if (type === "file" && !file) {
      setRefusal("Choose a file to attach.");
      return;
    }
    setRefusal(null);
    onAdd({
      type,
      ...(url.trim() ? { url: url.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(file ? { file } : {}),
    });
    reset();
  };

  const count = items.length;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="mt-1 text-[12px] text-muted-foreground underline underline-offset-4 hover:text-foreground"
          aria-label={
            count > 0
              ? `${evidenceSummary(items)} on ${criterionText}`
              : `Add evidence to ${criterionText}`
          }
        >
          {count > 0 ? evidenceSummary(items) : "Add evidence"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3 p-3">
        <p className="tt-eyebrow">Evidence</p>

        {evidenceError ? (
          <p className="text-[12px] text-muted-foreground">{evidenceError}</p>
        ) : count === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            {NO_EVIDENCE}. Attach proof only where it helps someone trust this.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <EvidenceRow
                key={item.id}
                item={item}
                busy={busy}
                {...(onOpenFile ? { onOpen: onOpenFile } : {})}
                {...(onRemove ? { onRemove } : {})}
              />
            ))}
          </ul>
        )}

        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex gap-1">
            {(["link", "file", "note"] as CriterionEvidenceType[]).map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => {
                  setType(entry);
                  setRefusal(null);
                }}
                className={
                  type === entry
                    ? "rounded-full bg-secondary px-2.5 py-1 text-[12px] text-foreground"
                    : "rounded-full px-2.5 py-1 text-[12px] text-muted-foreground hover:text-foreground"
                }
              >
                {EVIDENCE_TYPE_LABEL[entry]}
              </button>
            ))}
          </div>

          {type === "link" ? (
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https:// where it can be checked"
              aria-label="Evidence link"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px]"
            />
          ) : null}

          {type === "file" ? (
            <input
              ref={fileInput}
              type="file"
              aria-label="Evidence file"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="w-full text-[12px] text-muted-foreground file:mr-2 file:rounded-md file:border file:border-border file:bg-background file:px-2 file:py-1 file:text-[12px]"
            />
          ) : null}

          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={type === "note" ? "What you saw, in one line" : "Note (optional)"}
            aria-label="Evidence note"
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px]"
          />

          <TTButton size="sm" disabled={busy} onClick={submit}>
            {busy ? "Attaching…" : "Attach evidence"}
          </TTButton>

          {refusal ? <p className="text-[12px] text-destructive">{refusal}</p> : null}
          <p className="text-[11px] text-muted-foreground">{EVIDENCE_IS_NOT_A_DECISION}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
