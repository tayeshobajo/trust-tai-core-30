import { useRef, useState } from "react";
import { TTButton, TTInput } from "@/components/tt/primitives";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { RequiredWorkInput, type RequiredWorkDraft } from "@/domain/steward-required-work";

export function AddRequiredTask({
  meetingId,
  meetingTitle,
  onSave,
  onClose,
}: {
  meetingId: string;
  meetingTitle: string;
  onSave: (draft: RequiredWorkDraft) => Promise<void>;
  onClose: () => void;
}) {
  const [operationId] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const attempted = useRef<RequiredWorkDraft | null>(null);
  const [openingElement] = useState(() => document.activeElement as HTMLElement | null);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    if (!acknowledged) {
      setError("Confirm that this task is required meeting work.");
      return;
    }
    const parsed = RequiredWorkInput.safeParse({ meetingId, operationId, title, nextAction });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the task details.");
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError("");
    attempted.current ??= parsed.data;
    try {
      await onSave(attempted.current);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Task could not be saved. Retry uses the same operation.",
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <SheetContent
        className="w-full overflow-y-auto sm:max-w-md"
        onCloseAutoFocus={(event) => {
          if (openingElement?.isConnected) {
            event.preventDefault();
            openingElement.focus();
          }
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <SheetHeader>
          <SheetTitle>Add required task</SheetTitle>
          <SheetDescription>{meetingTitle}</SheetDescription>
        </SheetHeader>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <label className="grid gap-1 text-sm">
            Task title
            <TTInput
              aria-label="Task title"
              value={title}
              maxLength={500}
              disabled={pending || !!attempted.current}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Next action
            <TTInput
              aria-label="Next action"
              value={nextAction}
              maxLength={4000}
              disabled={pending || !!attempted.current}
              onChange={(event) => setNextAction(event.target.value)}
            />
          </label>
          <p className="text-sm text-muted-foreground">
            This adds one required task to the meeting score, assigned to you. Verification is
            unavailable; Delivered status and source links give no verified credit.
          </p>
          <p className="text-sm text-muted-foreground">
            Required scope stays even if archived. Removing or moving it is unavailable until
            audited scope changes exist.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={pending || !!attempted.current}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="mt-1"
            />
            I confirm this is required meeting work.
          </label>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {attempted.current && error ? (
            <p className="text-xs text-muted-foreground">
              Retry keeps the same task details and operation to prevent duplicates. If you close
              after an uncertain save, refresh the meeting before adding again.
            </p>
          ) : null}
          <div className="flex gap-2">
            <TTButton type="submit" disabled={pending}>
              {pending ? "Saving…" : attempted.current && error ? "Retry add task" : "Add task"}
            </TTButton>
            <TTButton type="button" variant="secondary" disabled={pending} onClick={onClose}>
              Cancel
            </TTButton>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
