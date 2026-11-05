import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Link2, Plus, Upload, Trash2, ArrowRight, Check, BookOpen } from "lucide-react";
import { StudioShell, StudioState } from "./studio-shell";
import { useStudioSources } from "./use-studio-library";
import { contentCommandService, type NewSource } from "@/data/supabase/content-request-service";
import { readFileAsSource } from "./composer";
import { EXTRACTION_LABEL, usableAsVoice, type ContentSource } from "@/domain/content-source";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { WorkspaceIdentity } from "@/lib/workspace";
export function SourcesWorkspace({ identity }: { identity: WorkspaceIdentity }) {
  const q = useStudioSources(identity);
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"text" | "url">("text");
  const [label, setLabel] = useState("");
  const [body, setBody] = useState("");
  const [textKind, setTextKind] = useState<"text" | "linkedin" | "article">("text");
  const [purpose, setPurpose] = useState("reference");
  const [selected, setSelected] = useState<ContentSource | null>(null);
  const [removing, setRemoving] = useState<ContentSource | null>(null);
  const [notice, setNotice] = useState("");
  const [fileError, setFileError] = useState("");
  const addTrigger = useRef<HTMLButtonElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["studio-workspace", "sources"] });
    void client.invalidateQueries({ queryKey: ["studio", "sources"] });
  };
  const add = useMutation({
    mutationFn: (input: NewSource) => contentCommandService.addSource(identity, input),
    onSuccess: () => {
      refresh();
      setOpen(false);
      setBody("");
      setLabel("");
      setNotice("Source saved to your workspace. Select it in Posts when you want to use it.");
    },
  });
  const remove = useMutation({
    mutationFn: (source: ContentSource) => contentCommandService.removeSource(identity, source.id),
    onSuccess: () => {
      setRemoving(null);
      setSelected(null);
      refresh();
      setNotice("Source removed from the library. Existing drafts are unchanged.");
    },
  });
  const rows = (q.data?.value ?? []).filter(
    (s) =>
      (filter !== "ready" || usableAsVoice(s)) &&
      `${s.label} ${s.origin} ${s.extractedText}`.toLowerCase().includes(search.toLowerCase()),
  );
  function submit() {
    if (kind === "url") {
      try {
        const url = new URL(body.trim());
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      } catch {
        setFileError("Enter an http or https link.");
        return;
      }
    }
    add.mutate({
      kind: kind === "url" ? "url" : textKind,
      label: label.trim() || (kind === "url" ? body.trim() : "Writing reference"),
      origin: kind === "url" ? body.trim() : "Added in Studio Sources",
      mimeType: kind === "url" ? "text/uri-list" : "text/plain",
      byteSize: new Blob([body]).size,
      extractedText: kind === "text" ? body.trim() : "",
      extractionState: kind === "text" ? "extracted" : "not_configured",
      extractionNote:
        kind === "text"
          ? "Text supplied directly by the workspace member."
          : "This link is saved as a reference. Studio has not fetched or read the page.",
      provenance: { studioRole: purpose },
    });
  }
  const ready = (q.data?.value ?? []).filter(usableAsVoice).length;
  return (
    <StudioShell
      identity={identity}
      section="Sources"
      description="The writing, references, and experience your content grows from."
      search={search}
      onSearch={setSearch}
      searchLabel="Search your source library"
      action={
        <button
          ref={addTrigger}
          className="sv-button sv-primary"
          disabled={q.isPending || q.isError || q.data?.provisioned === false}
          onClick={() => {
            add.reset();
            setFileError("");
            setOpen(true);
          }}
        >
          <Plus />
          Add source
        </button>
      }
    >
      <section className="sw-banner">
        <BookOpen />
        <div>
          <span className="sw-kicker">GIVE YOUR WORDS A FOUNDATION</span>
          <h2>Bring the material that sounds like you.</h2>
          <p>
            Paste your writing, add a reference, or bring in a text file. You choose which sources
            influence each post.
          </p>
        </div>
        <span className="sw-banner-count">
          {q.isSuccess && q.data.provisioned ? ready : "—"}
          <small>ready to use</small>
        </span>
      </section>
      <div className="sw-toolbar">
        <div className="sw-filter" aria-label="Source filters">
          {[
            ["all", "All sources"],
            ["ready", "Ready to use"],
          ].map(([id, name]) => (
            <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id!)}>
              {name}
            </button>
          ))}
        </div>
        <span>{rows.length} in this view · newest first</span>
      </div>
      {notice && (
        <p className="sw-success" role="status">
          {notice}
        </p>
      )}
      {q.isPending ? (
        <StudioState title="Reading your source library…" />
      ) : q.isError ? (
        <StudioState title="Your sources could not be read" onRetry={() => void q.refetch()}>
          {q.error.message}
        </StudioState>
      ) : !q.data?.provisioned ? (
        <StudioState title="The source library is not available">
          The existing Content Engine source store must be available before sources can be saved.
        </StudioState>
      ) : !rows.length ? (
        <StudioState title={search ? "No matching sources" : "Start with a thought or reference"}>
          No writing ready yet? Capture a thought in Ideas, or add a reference when you have one.
        </StudioState>
      ) : (
        <div className="sv-card sw-source-list">
          {rows.map((s) => (
            <article className="sw-source-row" key={s.id}>
              <span className="sw-source-icon">{s.kind === "url" ? <Link2 /> : <FileText />}</span>
              <button className="sw-source-main" onClick={() => setSelected(s)}>
                <strong>{s.label}</strong>
                <span>
                  {s.kind} ·{" "}
                  {new Date(s.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </button>
              <span className={`sw-status ${usableAsVoice(s) ? "is-ready" : ""}`}>
                {usableAsVoice(s) && <Check />}
                {s.kind === "url" && s.extractionState === "not_configured"
                  ? "Link saved only"
                  : EXTRACTION_LABEL[s.extractionState]}
              </span>
              <button
                className="sw-icon-button"
                aria-label={`Remove ${s.label}`}
                onClick={() => {
                  remove.reset();
                  setRemoving(s);
                }}
              >
                <Trash2 />
              </button>
            </article>
          ))}
        </div>
      )}
      <div className="sw-source-foot">
        <p>
          Links are saved as references, not crawled. PDF extraction, audio/video uploads, and
          transcription are not connected.
        </p>
        <Link to="/modules/studio/posts" className="sw-text-button">
          Use your sources in a post
          <ArrowRight />
        </Link>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="sv-dialog"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            addTrigger.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Add a source</DialogTitle>
            <DialogDescription>
              Save reference material to your workspace. Choose it explicitly when drafting.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setFileError("");
              submit();
            }}
          >
            <div className="sw-filter">
              {["text", "url"].map((k) => (
                <button
                  type="button"
                  key={k}
                  aria-pressed={kind === k}
                  onClick={() => {
                    setKind(k as "text" | "url");
                    setBody("");
                    setFileError("");
                  }}
                >
                  {k === "text" ? "Paste text" : "Save a link"}
                </button>
              ))}
            </div>
            <label>
              Source title
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={180}
                required
              />
            </label>
            <label>
              {kind === "text" ? "Reference text" : "Link"}
              <textarea
                aria-label={kind === "text" ? "Reference text" : "Link"}
                rows={kind === "text" ? 7 : 2}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={100000}
                required
              />
            </label>
            {kind === "text" && (
              <label>
                Content type
                <select
                  value={textKind}
                  onChange={(e) => setTextKind(e.target.value as "text" | "linkedin" | "article")}
                >
                  <option value="text">Plain text</option>
                  <option value="linkedin">LinkedIn writing (pasted by you)</option>
                  <option value="article">Article writing</option>
                </select>
              </label>
            )}
            <label>
              Use as
              <select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
                <option value="reference">Reference material</option>
                <option value="voice">Voice reference</option>
              </select>
            </label>
            {kind === "url" && (
              <p className="sw-quiet-note">
                The page will not be fetched. Paste its text to use it in a draft.
              </p>
            )}
            <div className="sv-actions">
              <button className="sv-button sv-primary" disabled={add.isPending}>
                {add.isPending ? "Saving…" : "Save source"}
              </button>
              <button
                type="button"
                className="sv-button"
                disabled={add.isPending}
                onClick={() => file.current?.click()}
              >
                <Upload />
                Import .txt / .md
              </button>
              <input
                ref={file}
                className="sr-only"
                type="file"
                accept=".txt,.md,text/plain,text/markdown"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setFileError("");
                  try {
                    if (f.size > 1000000) throw new Error("Choose a text file smaller than 1 MB.");
                    const input = await readFileAsSource(f);
                    if (input.extractionState !== "extracted")
                      throw new Error("Only plain text and Markdown can be imported here.");
                    add.mutate({ ...input, provenance: { studioRole: purpose } });
                  } catch (error) {
                    setFileError((error as Error).message);
                  } finally {
                    e.target.value = "";
                  }
                }}
              />
            </div>
            {(add.isError || fileError) && (
              <p className="sw-error" role="alert">
                {fileError || add.error?.message} Your input has been kept.
              </p>
            )}
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(o) => {
          if (!o) setSelected(null);
        }}
      >
        <DialogContent className="sv-dialog">
          <DialogHeader>
            <DialogTitle>{selected?.label}</DialogTitle>
            <DialogDescription>
              {selected?.extractionNote || "Saved reference text."}
            </DialogDescription>
          </DialogHeader>
          <p className="sw-source-origin">{selected?.origin}</p>
          <pre className="sw-source-text">
            {selected?.extractedText || "No page text or transcript has been extracted."}
          </pre>
          <Link className="sv-button sv-primary" to="/modules/studio/posts">
            Open Posts
            <ArrowRight />
          </Link>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(removing)}
        onOpenChange={(o) => {
          if (!o) setRemoving(null);
        }}
      >
        <DialogContent className="sv-dialog">
          <DialogHeader>
            <DialogTitle>Remove this source?</DialogTitle>
            <DialogDescription>
              “{removing?.label}” will leave the shared source library. Existing drafts remain
              unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="sv-actions">
            <button
              className="sv-button sv-primary"
              disabled={remove.isPending}
              onClick={() => removing && remove.mutate(removing)}
            >
              Remove source
            </button>
            <button className="sv-button" onClick={() => setRemoving(null)}>
              Keep source
            </button>
          </div>
          {remove.isError && (
            <p className="sw-error" role="alert">
              {remove.error.message}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </StudioShell>
  );
}
