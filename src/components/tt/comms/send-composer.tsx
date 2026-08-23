/**
 * The send composer.
 *
 * Where a prepared draft becomes a sent message — but only ever by a
 * person's hand. The composer shows exactly what will be sent: the wording,
 * the recipients, the files. Comms never appends a hidden signature or
 * rewrites a word at send time; what is on screen is what leaves.
 *
 * The boundary holds here too: Gmail's send permission is requested only
 * when the workspace chooses to grant it. Until then the composer explains,
 * calmly, why the Send button is quiet — and everything else still works.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Loader2, Paperclip, Send, X } from "lucide-react";

import { TTButton } from "@/components/tt/primitives";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/trust-tai/supabase";
import { commsService } from "@/data/supabase/comms-service";
import { gmailSendDraft, gmailSendStatus } from "@/data/supabase/comms-gmail";
import type { CommsContext, CommsDraft, Relationship } from "@/domain/comms";
import type { StoredMailboxMessage } from "@/domain/comms-integrations";
import { parseRecipients, validateAttachments, formatBytes } from "@/domain/comms-mime";
import {
  attachmentStoragePath,
  readOutgoingAttachments,
  readOutgoingExtras,
  DRAFT_ATTACHMENT_BUCKET,
  type OutgoingAttachmentRef,
} from "@/domain/comms-outgoing";
import { readDraftSend } from "@/domain/comms-send";

type SendThreadChoice = { mode: "reply"; providerThreadId: string } | { mode: "new" };

function EditorField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="tt-eyebrow">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-input bg-card px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function SendComposer({
  draft,
  relationship,
  context,
  messages,
  onChanged,
}: {
  draft: CommsDraft;
  relationship: Relationship;
  context: CommsContext;
  messages: StoredMailboxMessage[];
  onChanged: () => void;
}) {
  const extras = useMemo(() => readOutgoingExtras(draft.rationale), [draft.rationale]);
  const staged = useMemo(() => readOutgoingAttachments(draft.rationale), [draft.rationale]);
  const sendRecord = useMemo(() => readDraftSend(draft.rationale), [draft.rationale]);

  const [subject, setSubject] = useState(draft.subject ?? "");
  const [body, setBody] = useState(draft.body);
  const [ccText, setCcText] = useState(extras.cc.join(", "));
  const [bccText, setBccText] = useState(extras.bcc.join(", "));
  const [busy, setBusy] = useState<"save" | "send" | "upload" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // A new draft reseeds the editor; in-place edits are never clobbered.
  useEffect(() => {
    setSubject(draft.subject ?? "");
    setBody(draft.body);
    setCcText(readOutgoingExtras(draft.rationale).cc.join(", "));
    setBccText(readOutgoingExtras(draft.rationale).bcc.join(", "));
    setError(null);
    setNotice(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id]);

  /** The threads this relationship already has, newest first. */
  const threads = useMemo(() => {
    const seen = new Map<string, string>();
    for (const message of messages) {
      if (!message.providerThreadId) continue;
      const current = seen.get(message.providerThreadId);
      if (!current || message.occurredAt > current) {
        seen.set(message.providerThreadId, message.occurredAt);
      }
    }
    return [...seen.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1)).map(([id]) => id);
  }, [messages]);

  const [threadChoice, setThreadChoice] = useState<SendThreadChoice>(
    threads.length > 0 ? { mode: "reply", providerThreadId: threads[0]! } : { mode: "new" },
  );

  const capability = useQuery({
    queryKey: ["comms", "gmail-send-status", context.organizationId],
    queryFn: () => gmailSendStatus(context.organizationId),
    staleTime: 60_000,
    retry: false,
  });

  const sending = draft.reviewState === "sending";
  const failed = draft.reviewState === "send_failed";

  async function saveEdits(): Promise<boolean> {
    const cc = parseRecipients(ccText);
    const bcc = parseRecipients(bccText);
    try {
      await commsService.updateDraftContent(
        draft,
        { subject: subject.trim() || null, body },
        context,
      );
      await commsService.setDraftExtras(draft, { cc, bcc }, context);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Those changes could not be saved.");
      return false;
    }
  }

  async function handleSave() {
    setBusy("save");
    setError(null);
    setNotice(null);
    const ok = await saveEdits();
    setBusy(null);
    if (ok) {
      setNotice("Saved. Nothing has been sent.");
      onChanged();
    }
  }

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = [...list];
    const problems = validateAttachments([
      ...staged.map((file) => ({ filename: file.filename, size: file.size })),
      ...files.map((file) => ({ filename: file.name, size: file.size })),
    ]);
    if (problems.length > 0) {
      setError(problems.join(" "));
      return;
    }
    setBusy("upload");
    setError(null);
    try {
      const next = [...staged];
      for (const file of files) {
        const path = attachmentStoragePath(context.organizationId, draft.id, file.name);
        const { error: uploadError } = await supabase.storage
          .from(DRAFT_ATTACHMENT_BUCKET)
          .upload(path, file, { contentType: file.type || "application/octet-stream" });
        if (uploadError) throw new Error(uploadError.message);
        next.push({
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          path,
        });
      }
      await commsService.setDraftAttachments(draft, next, context);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That file could not be attached.");
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function handleRemoveFile(file: OutgoingAttachmentRef) {
    setError(null);
    try {
      await supabase.storage.from(DRAFT_ATTACHMENT_BUCKET).remove([file.path]);
      await commsService.setDraftAttachments(
        draft,
        staged.filter((entry) => entry.path !== file.path),
        context,
      );
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That file could not be removed.");
    }
  }

  /** The one irreversible act — a person's click, recorded and idempotent. */
  async function handleSend() {
    setBusy("send");
    setError(null);
    setNotice(null);
    const saved = await saveEdits();
    if (!saved) {
      setBusy(null);
      return;
    }
    try {
      const outcome = await gmailSendDraft(context.organizationId, draft.id, threadChoice);
      if (outcome.state === "blocked") {
        setError(
          "Gmail needs send permission before Comms can send for you. Reconnect Google with send access when you're ready.",
        );
      } else if (outcome.state === "failed") {
        setError(outcome.error ?? "That send failed. The draft is kept — you can try again.");
      } else if (outcome.state === "sending") {
        setNotice("Sending through Gmail…");
      } else {
        setNotice(outcome.replayed ? "Already sent — nothing was sent twice." : "Sent through Gmail.");
      }
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That send failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      aria-label="Edit and send this draft"
      className="space-y-3 border-t border-border bg-cloud/40 px-4 py-4 sm:px-5"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="tt-eyebrow">This draft</p>
        <p className="text-[11px] text-muted-foreground">
          What you see is exactly what is sent — Comms never adds a hidden signature.
        </p>
      </div>

      <div className="grid gap-3">
        <EditorField label={`To · ${relationship.email ?? relationship.fullName}`}>
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Subject"
            disabled={sending}
            className={inputClass}
          />
        </EditorField>
        <EditorField label="Message">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={8}
            disabled={sending}
            className={cn(inputClass, "whitespace-pre-wrap leading-relaxed")}
          />
        </EditorField>
        <div className="grid gap-3 sm:grid-cols-2">
          <EditorField label="Cc">
            <input
              value={ccText}
              onChange={(event) => setCcText(event.target.value)}
              placeholder="names@example.com, separated by commas"
              disabled={sending}
              className={inputClass}
            />
          </EditorField>
          <EditorField label="Bcc">
            <input
              value={bccText}
              onChange={(event) => setBccText(event.target.value)}
              placeholder="Only you and they are included by default"
              disabled={sending}
              className={inputClass}
            />
          </EditorField>
        </div>
      </div>

      {/* Files ride with the draft; bytes wait in private storage until send. */}
      <div>
        <p className="tt-eyebrow">Files</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {staged.map((file) => (
            <span
              key={file.path}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              <FileText className="h-3 w-3" aria-hidden />
              <span className="max-w-[180px] truncate">{file.filename}</span>
              <span className="text-[10px] opacity-70">{formatBytes(file.size)}</span>
              <button
                type="button"
                aria-label={`Remove ${file.filename}`}
                onClick={() => void handleRemoveFile(file)}
                disabled={sending || busy !== null}
                className="text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={sending || busy !== null}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {busy === "upload" ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <Paperclip className="h-3 w-3" aria-hidden />
            )}
            Attach a file
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(event) => void handleFiles(event.target.files)}
          />
        </div>
      </div>

      {/* Thread choice: continue the conversation, or open a new one. */}
      {threads.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="tt-eyebrow">Conversation</p>
          {(
            [
              {
                value: "reply",
                label: "Reply in the ongoing thread",
                target: { mode: "reply", providerThreadId: threads[0]! } as SendThreadChoice,
              },
              { value: "new", label: "Start a new thread", target: { mode: "new" } as SendThreadChoice },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={threadChoice.mode === option.value}
              onClick={() => setThreadChoice(option.target)}
              disabled={sending}
              className={cn(
                "rounded-full border px-3 py-1 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                threadChoice.mode === option.value
                  ? "border-royal/40 bg-royal/8 text-royal"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-lg border border-ember/30 bg-ember/8 px-3 py-2 text-[12px] text-ember">
          {error}
        </p>
      ) : null}
      {failed && sendRecord?.error ? (
        <p className="rounded-lg border border-ember/30 bg-ember/8 px-3 py-2 text-[12px] text-ember">
          Last attempt failed: {sendRecord.error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg border border-fern/30 bg-fern/8 px-3 py-2 text-[12px] text-fern">
          {notice}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="text-[12px] text-muted-foreground">
          {capability.data && !capability.data.connected ? (
            <p>Connect Gmail in Settings to send from here. Drafts work either way.</p>
          ) : capability.data && !capability.data.canSend ? (
            <p>
              Gmail can read this mailbox but can't send yet. Sending needs Google's send
              permission — reconnect Google with send access when you're ready. Until then, drafts
              and history work as always.
            </p>
          ) : (
            <p>Sending is always your click. Comms never sends on its own.</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <TTButton
            variant="quiet"
            size="sm"
            type="button"
            onClick={() => void handleSave()}
            disabled={sending || busy !== null}
          >
            {busy === "save" ? "Saving…" : "Save changes"}
          </TTButton>
          {capability.data?.canSend ? (
            <TTButton
              variant="primary"
              size="sm"
              type="button"
              onClick={() => void handleSend()}
              disabled={sending || busy !== null}
            >
              {sending || busy === "send" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Sending…
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" aria-hidden /> Send via Gmail
                </>
              )}
            </TTButton>
          ) : null}
        </div>
      </div>
    </section>
  );
}
