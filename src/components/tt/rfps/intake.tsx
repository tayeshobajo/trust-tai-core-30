import { useState, useEffect } from "react";
import { Link, Upload, ArrowLeft, FileText } from "lucide-react";
import { TTButton } from "@/components/tt/primitives";
import {
  opportunityInput,
  canonicalSource,
  type Opportunity,
  type OpportunityInput,
} from "@/domain/rfps";
import { reviewSource, type IntakeSource } from "@/domain/rfp-intake";
import { readSourceFile } from "@/lib/rfp-source-file";
import type { RfpService } from "@/data/supabase/rfps";
export function OpportunityIntake({
  service,
  opportunities,
  onComplete,
  onExisting,
  onBusy,
}: {
  onBusy?: (busy: boolean) => void;
  service: RfpService;
  opportunities: Opportunity[];
  onComplete: (id: string, message: string) => Promise<void>;
  onExisting: (id: string) => void;
}) {
  const [mode, setMode] = useState<"url" | "file">("url");
  const [url, setUrl] = useState("");
  const [paste, setPaste] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<IntakeSource | null>(null);
  const [review, setReview] = useState<OpportunityInput | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Opportunity | null>(null);
  useEffect(() => {
    onBusy?.(busy);
    return () => onBusy?.(false);
  }, [busy, onBusy]);
  async function extract() {
    setBusy(true);
    setError("");
    try {
      let result: IntakeSource;
      if (mode === "file") {
        if (!file) throw new Error("Choose a PDF, DOCX or TXT file.");
        result = await readSourceFile(file);
      } else {
        const canonical = canonicalSource(url);
        result = paste.trim()
          ? {
              url: canonical,
              text: paste,
              warning: "Text pasted by the team; page was not fetched.",
            }
          : {
              url: canonical,
              text: "",
              warning:
                "URL retained as a reference only; the page was not fetched. Enter details from the source or paste its text.",
            };
      }
      setSource(result);
      setReview(reviewSource(result));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Source could not be read.");
    } finally {
      setBusy(false);
    }
  }
  const duplicate =
    review &&
    opportunities.find((o) => {
      let sameUrl = false;
      try {
        sameUrl =
          !!review.source_url &&
          !!o.source_url &&
          canonicalSource(o.source_url) === canonicalSource(review.source_url);
      } catch {
        /* Incomplete edits are validated when saving. */
      }
      const sameFile =
        review.source_file_sha256 && review.source_file_sha256 === o.source_file_sha256;
      return (
        (sameUrl || sameFile) &&
        (!review.cycle.trim() || o.cycle.toLowerCase() === review.cycle.trim().toLowerCase())
      );
    });
  async function save() {
    if (!review || saved || duplicate) return;
    const result = opportunityInput.safeParse(review);
    if (!result.success) {
      setError(result.error.issues.map((x) => `${x.path.join(" ")}: ${x.message}`).join(" "));
      return;
    }
    setBusy(true);
    setError("");
    let created: Opportunity | null = null;
    try {
      created = (await service.create(result.data)) as Opportunity;
      setSaved(created);
      if (file && mode === "file") await service.preserveSource(created, file, source!.sha256!);
      await onComplete(
        created.id,
        "Opportunity created. Source retained for review; eligibility remains unknown.",
      );
    } catch (e) {
      setError(
        (created
          ? "Opportunity was created, but the source-file step or refresh did not finish. Do not create it again. "
          : "") + (e instanceof Error ? e.message : "Save failed."),
      );
    } finally {
      setBusy(false);
    }
  }
  const input = (key: keyof OpportunityInput, label: string, type = "text") => (
    <label>
      {label}
      <input
        type={type}
        value={review?.[key] || ""}
        onChange={(e) => setReview({ ...review!, [key]: e.target.value })}
      />
    </label>
  );
  return (
    <div className="rfp-intake">
      {!review ? (
        <>
          <p>Choose a source document or keep its URL. Review the details before saving.</p>
          <div className="rfp-intake-options" aria-label="Source format">
            <button
              aria-pressed={mode === "url"}
              disabled={busy}
              onClick={() => {
                setMode("url");
                setError("");
              }}
            >
              <Link size={20} />
              Paste a URL
            </button>
            <button
              aria-pressed={mode === "file"}
              disabled={busy}
              onClick={() => {
                setMode("file");
                setError("");
              }}
            >
              <Upload size={20} />
              Choose a document
            </button>
          </div>
          {mode === "url" ? (
            <>
              <label>
                RFP or grant URL
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://…"
                  disabled={busy}
                />
              </label>
              <p className="rfp-muted">
                Automatic URL reading is not connected. Paste the source text below to suggest
                fields, or enter details yourself. For a private Google document, download a PDF or
                DOCX using your existing access and choose the file.
              </p>
              <details open>
                <summary>Paste source text (optional)</summary>
                <label>
                  Source text
                  <textarea
                    value={paste}
                    maxLength={100000}
                    onChange={(e) => setPaste(e.target.value)}
                  />
                </label>
              </details>
            </>
          ) : (
            <>
              <label className="rfp-source-drop">
                <FileText size={28} />
                Choose source document
                <input
                  type="file"
                  accept=".pdf,.docx,.txt"
                  disabled={busy}
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </label>
              <p className="rfp-muted">
                PDF, DOCX or TXT · up to 10 MB / 100 PDF pages. Text is read on your device. The
                original is stored privately only when you create the opportunity, separately from
                proposal drafts. Scans need manual review; no OCR or external AI service.
              </p>
            </>
          )}
          <TTButton
            disabled={busy || (mode === "url" ? !url.trim() : !file)}
            onClick={() => void extract()}
          >
            {busy
              ? "Reading source…"
              : mode === "file"
                ? "Read document & review"
                : "Review source"}
          </TTButton>
        </>
      ) : (
        <>
          {!saved && (
            <button
              className="rfp-filter-button"
              disabled={busy}
              onClick={() => {
                setReview(null);
                setError("");
              }}
            >
              <ArrowLeft size={16} />
              Change source
            </button>
          )}
          <h3>Review opportunity</h3>
          <p>
            Suggestions come from source text or the filename. Correct them before saving. Missing
            fields stay unknown.
          </p>
          {source?.warning && (
            <p role="status" className="rfp-notice">
              {source.warning}
            </p>
          )}
          <div className="rfp-fields">
            {input("title", "Opportunity title *")}
            <label>
              Type
              <select
                value={review.kind}
                onChange={(e) => setReview({ ...review, kind: e.target.value as "rfp" | "grant" })}
              >
                <option value="rfp">RFP</option>
                <option value="grant">Grant</option>
              </select>
            </label>
            {input("source_name", "Issuing organization (if known)")}
            {input("cycle", "Solicitation ID / round (if known)")}
          </div>
          <details>
            <summary>Deadline and source details</summary>
            <div className="rfp-fields">
              {input("source_url", "Source URL (optional for a document)", "url")}
              {input("deadline_date", "Deadline date (if known)", "date")}
              {input("deadline_time", "Deadline time (if known)", "time")}
              {input("deadline_timezone", "Deadline timezone (IANA, if known)")}
            </div>
            <label>
              Source evidence
              <textarea
                value={review.source_evidence}
                maxLength={20000}
                onChange={(e) => setReview({ ...review, source_evidence: e.target.value })}
              />
            </label>
          </details>
          {duplicate && (
            <div className="rfp-notice">
              <p>
                This source is already tracked: {duplicate.title}. Open it, or enter a distinct
                verified round if this is a different opportunity.
              </p>
              <TTButton variant="quiet" onClick={() => onExisting(duplicate.id)}>
                Open existing opportunity
              </TTButton>
            </div>
          )}
          {saved ? (
            <TTButton
              onClick={() =>
                void onComplete(
                  saved.id,
                  "Opportunity exists. Review source preservation before retrying an upload.",
                )
              }
            >
              Open created opportunity
            </TTButton>
          ) : (
            <TTButton disabled={busy || !!duplicate} onClick={() => void save()}>
              {busy ? "Saving…" : "Create opportunity"}
            </TTButton>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
