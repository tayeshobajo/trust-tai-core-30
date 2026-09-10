/**
 * Conference capture.
 *
 * The whole point is speed at the moment of meeting someone: a name, where you
 * met, and one thing worth remembering. Everything else can be discovered
 * later. Nothing is inferred here and nothing is enriched silently.
 */

import { useState, type FormEvent } from "react";

import { TTButton, TTField, TTInput } from "@/components/tt/primitives";
import type { RelationshipInput } from "@/data/supabase/comms-service";

export function CaptureForm({
  onCreate,
  busy,
  onCancel,
}: {
  onCreate: (input: RelationshipInput) => void;
  busy?: boolean;
  onCancel?: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [metWhere, setMetWhere] = useState("");
  const [note, setNote] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [more, setMore] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!fullName.trim()) return;
    onCreate({
      fullName: fullName.trim(),
      metWhere: metWhere.trim() || undefined,
      note: note.trim() || undefined,
      companyName: companyName.trim() || undefined,
      email: email.trim() || undefined,
      source: metWhere.trim() ? "in_person" : "manual",
      stage: "new",
    });
    setFullName("");
    setMetWhere("");
    setNote("");
    setCompanyName("");
    setEmail("");
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <TTField label="Who did you meet">
        <TTInput
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          placeholder="Full name"
          required
        />
      </TTField>
      <TTField label="Where you met" optional>
        <TTInput
          value={metWhere}
          onChange={(event) => setMetWhere(event.target.value)}
          placeholder="Nashville Tech Council breakfast"
        />
      </TTField>
      <TTField
        label="One thing worth remembering"
        optional
        hint="Kept as a human note, never inferred."
      >
        <TTInput
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Rebuilding their booking flow before spring"
        />
      </TTField>

      {more ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <TTField label="Company" optional>
            <TTInput
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              placeholder="Company name"
            />
          </TTField>
          <TTField label="Email" optional>
            <TTInput
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.com"
            />
          </TTField>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setMore(true)}
          className="tt-eyebrow underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Add company or email
        </button>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <TTButton type="submit" disabled={!fullName.trim() || busy}>
          {busy ? "Saving" : "Add relationship"}
        </TTButton>
        {onCancel ? (
          <TTButton type="button" variant="quiet" onClick={onCancel}>
            Cancel
          </TTButton>
        ) : null}
      </div>
    </form>
  );
}
