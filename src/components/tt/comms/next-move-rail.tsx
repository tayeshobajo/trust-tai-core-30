/**
 * The right rail: why to write, and what to say.
 *
 * Reasons come from stored evidence, never from a cadence. Drafts are composed
 * under the organization's Voice DNA, checked by the deterministic policy, and
 * approved by a person. Comms does not send.
 */

import { useState } from "react";

import { REASON_LABEL, REVIEW_STATE_LABEL, type CommsDraft, type Relationship } from "@/domain/comms";
import { REGISTER_LABEL, type VoiceRegister } from "@/domain/voice";
import { reasonsToReconnect, type ReminderCandidate } from "@/data/comms-reminders";
import { MetaPill, TTButton, TTInput } from "@/components/tt/primitives";
import { cn } from "@/lib/utils";

export interface DraftPreview {
  subject: string;
  body: string;
  register: VoiceRegister;
  reviewState: "draft" | "needs_human_review";
  violations: { ruleId: string; severity: "block" | "flag"; message: string }[];
  usedEvidence: { label: string; value: string; tier: string }[];
}

const REGISTERS: VoiceRegister[] = [
  "warm_intro",
  "follow_up",
  "reconnect",
  "logistics",
  "sensitive",
];

export function NextMoveRail({
  relationship,
  drafts,
  preview,
  drafting,
  draftError,
  onDraft,
  onSave,
  onDiscard,
  onMarkSent,
}: {
  relationship: Relationship;
  drafts: CommsDraft[];
  preview: DraftPreview | null;
  drafting: boolean;
  draftError: string | null;
  onDraft: (register: VoiceRegister, purpose: string) => void;
  onSave: (preview: DraftPreview) => void;
  onDiscard: () => void;
  onMarkSent: (draft: CommsDraft) => void;
}) {
  const [register, setRegister] = useState<VoiceRegister>("follow_up");
  const [purpose, setPurpose] = useState("");
  const reasons: ReminderCandidate[] = reasonsToReconnect(relationship);
  const blocked = (preview?.violations ?? []).some((entry) => entry.severity === "block");

  return (
    <div className="min-h-0 flex-1 space-y-8 overflow-y-auto p-5">
      <section>
        <p className="tt-eyebrow">Reason to reach out</p>
        {reasons.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted-foreground">
            Nothing true has changed. This relationship can sit quietly until it does.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {reasons.map((reason, index) => (
              <li
                key={`${reason.reasonCode}-${index}`}
                className="rounded-lg border border-border bg-background p-3"
              >
                <p className="tt-eyebrow">{REASON_LABEL[reason.reasonCode]}</p>
                <p className="mt-1 text-[13px] text-foreground">{reason.reasonText}</p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {reason.evidence.map((entry) => entry.label).join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border-t border-border pt-6">
        <p className="tt-eyebrow">Draft in Tai's voice</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {REGISTERS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setRegister(value)}
              aria-pressed={register === value}
              className={cn(
                "rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                register === value
                  ? "border-foreground text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {REGISTER_LABEL[value]}
            </button>
          ))}
        </div>
        <TTInput
          className="mt-3 h-11"
          value={purpose}
          onChange={(event) => setPurpose(event.target.value)}
          placeholder="Why are we writing? Optional."
          aria-label="Purpose of this message"
        />
        <TTButton
          className="mt-3 w-full"
          size="sm"
          disabled={drafting}
          onClick={() => onDraft(register, purpose)}
        >
          {drafting ? "Composing" : "Compose a draft"}
        </TTButton>
        {draftError ? (
          <p className="mt-2 text-[13px] text-destructive">{draftError}</p>
        ) : null}

        {preview ? (
          <div className="mt-4 rounded-lg border border-border bg-background p-4">
            <div className="flex flex-wrap items-center gap-2">
              <MetaPill>{REGISTER_LABEL[preview.register]}</MetaPill>
              <MetaPill>{REVIEW_STATE_LABEL[preview.reviewState]}</MetaPill>
            </div>
            {preview.subject ? (
              <p className="mt-3 text-[13px] text-foreground">{preview.subject}</p>
            ) : null}
            <p className="mt-2 whitespace-pre-wrap text-[13px] text-muted-foreground">
              {preview.body}
            </p>

            {preview.violations.length > 0 ? (
              <ul className="mt-3 space-y-1 border-t border-border pt-3">
                {preview.violations.map((violation, index) => (
                  <li
                    key={`${violation.ruleId}-${index}`}
                    className={cn(
                      "text-[13px]",
                      violation.severity === "block" ? "text-destructive" : "text-warning",
                    )}
                  >
                    {violation.message}
                  </li>
                ))}
              </ul>
            ) : null}

            {preview.usedEvidence.length > 0 ? (
              <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Drawn from {preview.usedEvidence.length} recorded item
                {preview.usedEvidence.length === 1 ? "" : "s"}
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <TTButton size="sm" disabled={blocked} onClick={() => onSave(preview)}>
                {preview.reviewState === "needs_human_review" ? "Save for review" : "Approve draft"}
              </TTButton>
              <TTButton size="sm" variant="quiet" onClick={onDiscard}>
                Discard
              </TTButton>
            </div>
            <p className="mt-2 text-[13px] text-muted-foreground">
              Comms does not send. A person copies this and writes it themselves.
            </p>
          </div>
        ) : null}
      </section>

      {drafts.length > 0 ? (
        <section className="border-t border-border pt-6">
          <p className="tt-eyebrow">Saved drafts</p>
          <ul className="mt-3 space-y-3">
            {drafts.map((draft) => (
              <li key={draft.id} className="rounded-lg border border-border bg-background p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <MetaPill>{REVIEW_STATE_LABEL[draft.reviewState]}</MetaPill>
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {new Date(draft.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-[13px] text-muted-foreground">
                  {draft.body}
                </p>
                {draft.reviewState !== "sent" && draft.reviewState !== "discarded" ? (
                  <TTButton
                    className="mt-3"
                    size="sm"
                    variant="secondary"
                    onClick={() => onMarkSent(draft)}
                  >
                    Mark as sent
                  </TTButton>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
