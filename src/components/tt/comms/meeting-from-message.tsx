/**
 * Plan a meeting from the message you are reading.
 *
 * The conversation is where meetings are actually agreed, so this is where
 * they get planned. What a person writes here becomes a dated promise on the
 * relationship, which is exactly what the Plan tab reads. Nothing is sent and
 * no invitation goes anywhere.
 */

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { TTButton, TTInput } from "@/components/tt/primitives";
import { defaultMeetingTitle, planMeetingFromMessage } from "@/data/comms-meeting";
import type { Relationship } from "@/domain/comms";
import type { StoredMailboxMessage } from "@/domain/comms-integrations";
import type { WorkspaceIdentity } from "@/lib/workspace";

/** A sensible first suggestion: tomorrow morning, which a person then edits. */
function tomorrowAtNine(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  const pad = (value: number) => `${value}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function MeetingFromMessage({
  relationship,
  message,
  identity,
}: {
  relationship: Relationship;
  message: StoredMailboxMessage | null;
  identity: WorkspaceIdentity;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(tomorrowAtNine);
  const [title, setTitle] = useState("");
  const [planned, setPlanned] = useState(false);

  const plan = useMutation({
    mutationFn: () =>
      planMeetingFromMessage({
        relationship,
        message,
        at,
        ...(title.trim() ? { title: title.trim() } : {}),
        context: { organizationId: identity.organizationId, userId: identity.userId },
      }),
    onSuccess: () => {
      setPlanned(true);
      setOpen(false);
      setTitle("");
      toast.success("Meeting planned", {
        description: `${relationship.fullName} · it is on the Plan tab now.`,
      });
      void queryClient.invalidateQueries({ queryKey: ["comms"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <TTButton variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Plan a meeting
        </TTButton>
        {planned ? (
          <TTButton asChild variant="ghost" size="sm">
            <Link to="/modules/comms/plan">See it on the plan →</Link>
          </TTButton>
        ) : null}
      </div>
    );
  }

  return (
    <div className="w-full rounded-lg border border-border bg-secondary/30 p-3">
      <p className="text-[13px] text-foreground">
        Plan a meeting with {relationship.fullName}
      </p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        Recorded as a dated promise on this relationship, from this conversation. Nothing is sent.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <TTInput
          className="h-9"
          type="datetime-local"
          value={at}
          onChange={(event) => setAt(event.target.value)}
          aria-label="Meeting date and time"
        />
        <TTInput
          className="h-9"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={defaultMeetingTitle(relationship)}
          aria-label="What the meeting is"
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <TTButton size="sm" disabled={plan.isPending} onClick={() => plan.mutate()}>
          {plan.isPending ? "Saving…" : "Add to plan"}
        </TTButton>
        <TTButton variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </TTButton>
      </div>
    </div>
  );
}
