import { useEffect, useState } from "react";
import {
  CheckCheck,
  ChevronRight,
  FileText,
  History,
  Link as LinkIcon,
  LockKeyhole,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { TTButton, TTInput } from "@/components/tt/primitives";
import { PREVIEW_MEETINGS } from "@/data/mockups/steward-preview";
import {
  confirmPreview,
  reopenPreview,
  verifyPreview,
  type PreviewDeliverable,
  type PreviewActorTime,
} from "@/domain/steward-preview";

export function TaskDetails({
  item,
  work,
  update,
  metadata,
}: {
  item: PreviewDeliverable;
  work: PreviewDeliverable[];
  update: (id: string, change: (item: PreviewDeliverable) => PreviewDeliverable) => void;
  metadata: () => PreviewActorTime;
}) {
  const [proof, setProof] = useState("");
  const [reason, setReason] = useState("");
  const [reopening, setReopening] = useState(false);
  const [owner, setOwner] = useState(item.owner ?? "");
  const [source, setSource] = useState(false);
  const [history, setHistory] = useState(false);
  const [prepared, setPrepared] = useState<"idle" | "loading" | "ready">("idle");
  useEffect(() => {
    if (prepared !== "loading") return;
    const timer = setTimeout(() => setPrepared("ready"), 350);
    return () => clearTimeout(timer);
  }, [prepared]);
  const meeting = PREVIEW_MEETINGS.find((m) => m.id === item.meetingId);
  const dependencyDone =
    !item.dependency ||
    work.some(
      (w) => w.title === item.dependency && w.status === "verified" && Boolean(w.proof?.trim()),
    );
  return (
    <div className="min-w-0 break-words text-sm">
      <div className="pb-6">
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span className="grid size-7 place-items-center rounded-full bg-plum/15 text-plum">
            {item.owner?.[0] ?? "U"}
          </span>
          <span>
            {item.owner ?? "Unassigned"} ·{" "}
            <span className="text-royal">
              {item.dueKind === "spoken"
                ? `Said “${item.due}” · confirm date`
                : item.due
                  ? `Due ${item.due.toLowerCase()}`
                  : "Date not agreed"}
            </span>
          </span>
        </div>
        <p className="mt-5 leading-6 text-muted-foreground">
          {item.id === "example-copy"
            ? "Review the draft against the agreed message. Approval unlocks the page build."
            : item.nextMove}
        </p>
        {item.dependency && (
          <p className="mt-2 flex gap-2 text-warning">
            <LockKeyhole className="size-4 shrink-0" />
            Depends on: {item.dependency}
          </p>
        )}
      </div>
      <section className="border-t border-border py-6">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-semibold">
            <Sparkles className="size-5 text-royal" />
            AI help
          </h3>
          <span className="text-xs text-muted-foreground">Sample interaction</span>
        </div>
        <div className="mt-4 rounded-lg bg-cloud p-4">
          <p className="leading-5 text-muted-foreground">
            {item.id === "example-copy"
              ? "I can check the copy and prepare a review for you."
              : "I can prepare a starting point for your review."}
          </p>
          <TTButton
            className="mt-3 rounded-md px-4"
            pending={prepared === "loading"}
            pendingLabel="Preparing sample…"
            onClick={() => setPrepared("loading")}
          >
            <Sparkles />
            Prepare review
          </TTButton>
          <div role="status" aria-live="polite">
            {prepared === "loading" && (
              <p className="mt-3 text-xs text-muted-foreground">Loading illustrative help only.</p>
            )}
            {prepared === "ready" && (
              <div className="mt-4 border-t border-border pt-3">
                <p className="font-semibold text-royal">Illustrative review · no model execution</p>
                <p className="mt-2 whitespace-pre-line leading-6">{item.aiDraft}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  A draft is not approval or completion evidence. Nothing is sent or assigned.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
      <section className="border-t border-border py-6">
        <h3 className="flex items-center gap-2 font-semibold">
          <FileText className="size-5" />
          Completion evidence
        </h3>
        {item.proof && (
          <div className="mt-4 rounded-md border border-success/20 bg-success/5 p-3 text-success">
            <p className="flex items-center gap-2 font-medium">
              <CheckCheck className="size-4" />
              {item.status === "verified"
                ? "Verified · example only"
                : "Prior completion reference retained"}
            </p>
            <p className="mt-2">{item.proof}</p>
          </div>
        )}
        {item.status === "verified" ? (
          reopening ? (
            <div className="mt-4">
              <label className="block">
                Reopen reason
                <TTInput
                  aria-label="Reopen reason"
                  className="mt-2"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="What needs further work?"
                />
              </label>
              <TTButton
                variant="secondary"
                className="mt-3 rounded-md"
                disabled={!reason.trim()}
                onClick={() => {
                  update(item.id, (i) => reopenPreview(i, reason, metadata()));
                  setReopening(false);
                  setHistory(true);
                }}
              >
                <RotateCcw />
                Record example reopening
              </TTButton>
            </div>
          ) : (
            <TTButton
              variant="secondary"
              className="mt-4 rounded-md"
              onClick={() => setReopening(true)}
            >
              <RotateCcw />
              Reopen deliverable
            </TTButton>
          )
        ) : item.status === "proposed" ? (
          <div className="mt-4">
            <p className="mb-3 text-muted-foreground">
              Proposal only. Confirm agreement and an owner before it counts.
            </p>
            <label>
              Confirm example owner
              <select
                aria-label="Confirm example owner"
                className="mt-2 h-11 w-full rounded-md border border-input bg-card px-3"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
              >
                <option value="">Choose an owner</option>
                {["Alex", "Morgan", "Sam"].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <TTButton
              className="mt-3 rounded-md"
              disabled={!owner.trim()}
              onClick={() => update(item.id, (i) => confirmPreview(i, owner))}
            >
              Confirm example work
            </TTButton>
          </div>
        ) : item.status === "blocked" ? (
          <div className="mt-4">
            <p className="text-warning">
              {dependencyDone
                ? "Dependency verified. Clear the blocker before reviewing this task."
                : "The dependency is still outstanding. Completion stays blocked."}
            </p>
            <TTButton
              className="mt-3 rounded-md"
              variant="secondary"
              disabled={!dependencyDone}
              onClick={() => update(item.id, (i) => ({ ...i, status: "open" }))}
            >
              <LockKeyhole />
              Clear example blocker
            </TTButton>
          </div>
        ) : (
          <div className="mt-4">
            <label className="sr-only" htmlFor="sample-proof">
              Completion reference
            </label>
            <textarea
              id="sample-proof"
              aria-label="Completion reference"
              placeholder="Add a link or note showing the result"
              value={proof}
              onChange={(e) => setProof(e.target.value)}
              className="min-h-24 w-full resize-y rounded-md border border-dashed border-input bg-card p-4 text-sm placeholder:text-muted-foreground"
            />
            <TTButton
              variant="secondary"
              className="mt-3 rounded-md border-royal/40 text-royal"
              disabled={!proof.trim()}
              onClick={() => {
                update(item.id, (i) => verifyPreview(i, proof, metadata()));
                setHistory(true);
                setProof("");
              }}
            >
              Verify completion
            </TTButton>
          </div>
        )}
      </section>
      <section className="border-t border-border">
        <TTButton
          variant="quiet"
          className="h-14 w-full justify-between rounded-none px-0"
          aria-expanded={source}
          onClick={() => setSource(!source)}
        >
          <span className="flex items-center gap-3">
            <LinkIcon />
            Meeting source
          </span>
          <ChevronRight className={source ? "rotate-90" : ""} />
        </TTButton>
        {source && (
          <div className="pb-5 leading-6" aria-label="Illustrative meeting source" role="region">
            <p className="font-medium">
              {meeting?.title} · source at {item.at}
            </p>
            <blockquote className="mt-2 border-l-2 border-border pl-3">“{item.quote}”</blockquote>
            <p className="mt-2 text-xs text-muted-foreground">
              Invented transcript excerpt. No live recording connected.
            </p>
          </div>
        )}
      </section>
      <section className="border-t border-b border-border">
        <TTButton
          variant="quiet"
          className="h-14 w-full justify-between rounded-none px-0"
          aria-expanded={history}
          onClick={() => setHistory(!history)}
        >
          <span className="flex items-center gap-3">
            <History />
            History
          </span>
          <ChevronRight className={history ? "rotate-90" : ""} />
        </TTButton>
        {history && (
          <div role="region" aria-label="Illustrative receipt history" className="pb-5">
            <p className="text-xs text-muted-foreground">
              Fictional actors and simulated times · resets on reload.
            </p>
            {item.history?.length ? (
              <ol className="mt-3 space-y-4">
                {item.history.map((r, i) => (
                  <li key={`${r.at}-${i}`} className="border-l-2 border-border pl-3">
                    <p className={r.kind === "completed" ? "text-success" : "text-foreground"}>
                      {r.kind === "completed" ? "Completed" : "Reopened"} · illustrative
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {r.actor} · {r.at.replace("T", " ").replace(/(?:\.000)?Z$/, " UTC")}
                    </p>
                    {r.reason && <p className="mt-1">Reason: {r.reason}</p>}
                    <p className="mt-1">Completion reference: {r.proof}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 text-muted-foreground">No completion receipts yet.</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
