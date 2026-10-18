import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { useState } from "react";

import { supabaseActivity } from "@/data/supabase/activities";

const HISTORY_LIMIT = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Selected commitment only, through the existing member-RLS activity reader. */
export function TaskHistory({
  organizationId,
  userId,
  commitmentId,
}: {
  organizationId: string;
  userId: string;
  commitmentId: string;
}) {
  const [open, setOpen] = useState(false);
  const validIdentity = Boolean(organizationId && userId && UUID.test(commitmentId));
  const history = useQuery({
    queryKey: ["steward", "task-history", organizationId, userId, commitmentId],
    enabled: open && validIdentity,
    queryFn: () =>
      supabaseActivity.list({
        organizationId,
        subjectType: "task",
        subjectId: commitmentId,
        appIds: ["steward"],
        limit: HISTORY_LIMIT,
      }),
    retry: false,
  });

  return (
    <details
      className="border-t border-border pt-4"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer items-center gap-1.5 font-medium text-foreground">
        <History aria-hidden className="size-3.5" /> History
      </summary>
      {open ? (
        <div className="mt-2 space-y-2 text-[13px] text-muted-foreground">
          <p className="text-xs">
            Up to {HISTORY_LIMIT} most recent recorded Steward events for this task. Older events
            may not be shown. Legacy activity is not a verified completion receipt.
          </p>
          {!validIdentity || history.isError ? (
            <p role="alert">History could not be read. Prior work is unknown, not absent.</p>
          ) : history.isPending || history.isFetching ? (
            <p role="status">Reading recorded history…</p>
          ) : history.data?.length === 0 ? (
            <p role="status">No recorded history found for this task. This does not mean no prior work.</p>
          ) : (
            <ol className="space-y-3">
              {history.data?.map((event) => {
                const actor = event.provenance.actor;
                const note = event.payload?.["note"];
                const validTime = event.occurredAt && !Number.isNaN(Date.parse(event.occurredAt));
                return (
                  <li key={event.id} className="border-l border-border pl-3">
                    <p className="text-foreground">{event.summary || event.name}</p>
                    <p className="mt-1 text-xs">
                      Actor: {actor.label || actor.id || "not recorded"} ·{" "}
                      {validTime ? (
                        <time dateTime={event.occurredAt}>{event.occurredAt}</time>
                      ) : (
                        "Time not recorded"
                      )}
                    </p>
                    {typeof note === "string" && note.trim() ? <p className="mt-1">{note}</p> : null}
                    <p className="mt-1 text-xs">Legacy activity · {event.name} · not a completion receipt</p>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      ) : null}
    </details>
  );
}