import { useEffect, useRef, useState } from "react";
import { TTButton } from "@/components/tt/primitives";
import { interpretConversation, type InterpretationResult } from "@/data/steward/ingest";
import type { StoredConversation } from "@/data/supabase/steward-service";
import type { WorkspaceIdentity } from "@/lib/workspace";

/** Explicit bounded work queue. Successful readings persist server-side; task confirmation is separate. */
export function MeetingProcessingQueue({
  identity,
  meetings,
  readings,
  onSaved,
}: {
  identity: WorkspaceIdentity;
  meetings: StoredConversation[];
  readings: Map<string, { result: InterpretationResult | null; message: string }> | undefined;
  onSaved: () => Promise<unknown>;
}) {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const stop = useRef(false);
  const active = useRef(false);
  useEffect(() => {
    stop.current = false;
    return () => {
      stop.current = true;
    };
  }, []);
  const pending = meetings.filter(
    (m) => m.conversation.segments.length > 0 && !readings?.get(m.id)?.result,
  );
  const missing = meetings.filter((m) => !m.conversation.segments.length).length;
  async function run() {
    if (active.current || !readings) return;
    active.current = true;
    stop.current = false;
    setRunning(true);
    let saved = 0;
    try {
      for (const meeting of pending) {
        if (stop.current) break;
        setMessage(`Reading ${saved + 1} of ${pending.length}: ${meeting.title}`);
        await interpretConversation({
          organizationId: identity.organizationId,
          conversationId: meeting.id,
          conversation: meeting.conversation,
        });
        saved += 1;
        await onSaved();
      }
      if (!stop.current)
        setMessage(
          `${saved} meeting readings saved for review. No tasks were confirmed automatically.`,
        );
    } catch (error) {
      if (!stop.current)
        setMessage(
          `${saved} readings saved. Processing stopped: ${error instanceof Error ? error.message : "Reading unavailable"}. Retry resumes remaining meetings.`,
        );
    } finally {
      active.current = false;
      if (!stop.current) setRunning(false);
    }
  }
  if (!identity.apps.some((app) => app.appId === "steward" && app.canWork)) return null;
  return (
    <div className="border-b border-border px-6 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <TTButton
          variant="secondary"
          type="button"
          disabled={running || !readings || pending.length === 0}
          onClick={() => void run()}
        >
          {running
            ? "Reading full transcripts…"
            : `Prepare ${pending.length} pending meeting${pending.length === 1 ? "" : "s"}`}
        </TTButton>
        <span className="text-muted-foreground">
          This loaded meeting list only · review before confirming work
        </span>
      </div>
      {missing ? (
        <p className="mt-2">
          {missing} meeting transcripts are missing or not ready; their deliverables remain unknown.
        </p>
      ) : null}
      {message ? (
        <p role="status" className="mt-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}
