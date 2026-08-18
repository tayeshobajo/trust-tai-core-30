/**
 * Take the relationship with you.
 *
 * One summary of what Comms holds: memory, promises, health, strength and the
 * next move with its reason. Copy it, download it, or print it to PDF. Nothing
 * is generated here beyond what the room already shows.
 */

import { useMemo, useState } from "react";

import { TTButton } from "@/components/tt/primitives";
import {
  relationshipSummaryHtml,
  relationshipSummaryText,
  summaryFileName,
  type RelationshipSummaryInput,
} from "@/data/comms-summary";

export function RelationshipExport({
  input,
  onClose,
}: {
  input: RelationshipSummaryInput;
  onClose: () => void;
}) {
  const text = useMemo(() => relationshipSummaryText(input), [input]);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function download() {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${summaryFileName(input.relationship)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /** The browser's own print dialog is the PDF writer, so nothing is uploaded. */
  function print() {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(relationshipSummaryHtml(input));
    doc.close();
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => frame.remove(), 1000);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Relationship summary for ${input.relationship.fullName}`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/25 p-0 backdrop-blur-sm sm:items-center sm:p-6"
    >
      <button type="button" aria-label="Close" className="absolute inset-0" onClick={onClose} />
      <div className="tt-rise relative flex max-h-[92vh] w-full max-w-[680px] flex-col overflow-hidden rounded-t-xl border border-border bg-card sm:rounded-xl">
        <header className="border-b border-border px-5 py-4">
          <p className="tt-eyebrow">Relationship summary</p>
          <h2 className="mt-1 text-lg text-foreground">{input.relationship.fullName}</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Memory, promises, health and the next move, exactly as Comms holds them.
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <pre className="whitespace-pre-wrap rounded-lg border border-border bg-secondary/30 p-3.5 text-[12px] leading-relaxed text-foreground">
            {text}
          </pre>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
          <TTButton variant="quiet" size="sm" type="button" onClick={onClose}>
            Close
          </TTButton>
          <TTButton variant="quiet" size="sm" type="button" onClick={download}>
            Download text
          </TTButton>
          <TTButton variant="quiet" size="sm" type="button" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy"}
          </TTButton>
          <TTButton size="sm" type="button" onClick={print}>
            Save as PDF
          </TTButton>
        </footer>
      </div>
    </div>
  );
}
