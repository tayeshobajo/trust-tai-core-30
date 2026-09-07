/**
 * Evidence on one acceptance condition.
 *
 * Proof is shown, not hidden: an image appears as a small picture, a file as a
 * card you can open, a link as its domain, a note as the line somebody wrote.
 * Attaching happens in a quiet modal with File / Link / Note.
 *
 * Nothing here checks a condition, and nothing here completes a milestone.
 */

import { useEffect, useRef, useState } from "react";
import { ExternalLink, FileText, Image as ImageIcon, Link2, StickyNote, Trash2 } from "lucide-react";

import { TTButton } from "@/components/tt/primitives";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  EVIDENCE_IS_NOT_A_DECISION,
  EVIDENCE_TYPE_LABEL,
  NO_EVIDENCE,
  checkEvidenceInput,
  evidenceMetaLine,
  isImageEvidence,
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

/** A stored image, fetched through a short lived signed url when asked for. */
function Thumbnail({
  item,
  resolveUrl,
}: {
  item: CriterionEvidence;
  resolveUrl?: ((item: CriterionEvidence) => Promise<string>) | undefined;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!resolveUrl || !item.storagePath) return;
    let live = true;
    void resolveUrl(item)
      .then((url) => {
        if (live) setSrc(url);
      })
      .catch(() => {
        if (live) setSrc(null);
      });
    return () => {
      live = false;
    };
  }, [item, resolveUrl]);

  if (!src) {
    return (
      <div className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
        <ImageIcon className="size-4 text-muted-foreground" aria-hidden />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={item.label}
      loading="lazy"
      className="size-12 shrink-0 rounded-lg border border-border object-cover"
    />
  );
}

function EvidenceCard({
  item,
  busy,
  onOpen,
  onRemove,
  resolveUrl,
}: {
  item: CriterionEvidence;
  busy: boolean;
  onOpen?: ((item: CriterionEvidence) => void) | undefined;
  onRemove?: ((item: CriterionEvidence) => void) | undefined;
  resolveUrl?: ((item: CriterionEvidence) => Promise<string>) | undefined;
}) {
  const Icon = TYPE_ICON[item.type];
  const image = isImageEvidence(item);
  const openable = item.type === "link" || (item.type === "file" && Boolean(onOpen));

  const inspect = () => {
    if (item.type === "link" && item.url) {
      window.open(item.url, "_blank", "noopener,noreferrer");
      return;
    }
    if (item.type === "file" && onOpen) onOpen(item);
  };

  return (
    <li className="group relative flex items-start gap-2.5 rounded-xl border border-border bg-background p-2.5">
      {image ? (
        <Thumbnail item={item} resolveUrl={resolveUrl} />
      ) : (
        <div className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
        </div>
      )}

      <div className="min-w-0 flex-1">
        {openable ? (
          <button
            type="button"
            onClick={inspect}
            className="block max-w-full truncate text-left text-[13px] font-medium text-foreground hover:underline"
          >
            {item.label}
          </button>
        ) : (
          <p className="truncate text-[13px] font-medium text-foreground">{item.label}</p>
        )}
        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {evidenceMetaLine(item)}
        </p>
        {item.note && item.note !== item.label ? (
          <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">{item.note}</p>
        ) : null}
        {openable ? (
          <button
            type="button"
            onClick={inspect}
            className="mt-1 inline-flex items-center gap-1 text-[12px] text-primary hover:underline"
          >
            <ExternalLink className="size-3" aria-hidden />
            {item.type === "link" ? "Open link" : "View file"}
          </button>
        ) : null}
      </div>

      {onRemove ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onRemove(item)}
          aria-label={`Remove ${item.label}`}
          className="rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </li>
  );
}

function AttachEvidenceDialog({
  open,
  onOpenChange,
  criterionText,
  busy,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  criterionText: string;
  busy: boolean;
  onAdd: (draft: EvidenceDraft) => void;
}) {
  const [type, setType] = useState<CriterionEvidenceType>("file");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const reset = () => {
    setUrl("");
    setNote("");
    setFile(null);
    setDragging(false);
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
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Attach evidence</DialogTitle>
          <DialogDescription className="truncate">{criterionText}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 rounded-full bg-muted p-1">
          {(["file", "link", "note"] as CriterionEvidenceType[]).map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => {
                setType(entry);
                setRefusal(null);
              }}
              className={
                type === entry
                  ? "flex-1 rounded-full bg-background px-3 py-1.5 text-[13px] text-foreground shadow-sm"
                  : "flex-1 rounded-full px-3 py-1.5 text-[13px] text-muted-foreground hover:text-foreground"
              }
            >
              {EVIDENCE_TYPE_LABEL[entry]}
            </button>
          ))}
        </div>

        {type === "file" ? (
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const dropped = event.dataTransfer.files?.[0];
              if (dropped) {
                setFile(dropped);
                setRefusal(null);
              }
            }}
            className={
              dragging
                ? "rounded-xl border-2 border-dashed border-primary bg-primary/5 p-6 text-center"
                : "rounded-xl border-2 border-dashed border-border p-6 text-center"
            }
          >
            <p className="text-[13px] text-foreground">
              {file ? file.name : "Drop a file here, or choose one"}
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Screenshots, documents, exports: whatever someone would look at.
            </p>
            <input
              ref={fileInput}
              type="file"
              aria-label="Evidence file"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setRefusal(null);
              }}
              className="sr-only"
            />
            <TTButton
              size="sm"
              variant="secondary"
              className="mt-3"
              onClick={() => fileInput.current?.click()}
            >
              Choose file
            </TTButton>
          </div>
        ) : null}

        {type === "link" ? (
          <input
            value={url}
            autoFocus
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https:// where it can be checked"
            aria-label="Evidence link"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px]"
          />
        ) : null}

        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={type === "note" ? 3 : 2}
          placeholder={type === "note" ? "What you saw, in one line" : "Note (optional)"}
          aria-label="Evidence note"
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px]"
        />

        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted-foreground">{EVIDENCE_IS_NOT_A_DECISION}</p>
          <TTButton size="sm" disabled={busy} onClick={submit}>
            {busy ? "Attaching…" : "Attach evidence"}
          </TTButton>
        </div>

        {refusal ? <p className="text-[12px] text-destructive">{refusal}</p> : null}
      </DialogContent>
    </Dialog>
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
  resolveUrl,
}: {
  criterionText: string;
  items: CriterionEvidence[];
  evidenceError?: string | null;
  busy: boolean;
  onAdd: (draft: EvidenceDraft) => void;
  onRemove?: ((item: CriterionEvidence) => void) | undefined;
  onOpenFile?: ((item: CriterionEvidence) => void) | undefined;
  resolveUrl?: ((item: CriterionEvidence) => Promise<string>) | undefined;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2">
      {evidenceError ? (
        <p className="text-[12px] text-muted-foreground">{evidenceError}</p>
      ) : items.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {items.map((item) => (
            <EvidenceCard
              key={item.id}
              item={item}
              busy={busy}
              resolveUrl={resolveUrl}
              {...(onOpenFile ? { onOpen: onOpenFile } : {})}
              {...(onRemove ? { onRemove } : {})}
            />
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen(true)}
        aria-label={`Add evidence to ${criterionText}`}
        className="mt-1.5 text-[12px] text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-50"
      >
        {items.length > 0 ? "Add evidence" : `${NO_EVIDENCE}. Add evidence`}
      </button>

      <AttachEvidenceDialog
        open={open}
        onOpenChange={setOpen}
        criterionText={criterionText}
        busy={busy}
        onAdd={onAdd}
      />
    </div>
  );
}
