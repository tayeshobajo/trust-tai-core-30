/**
 * The centre pane: one relationship, in full.
 *
 * Identity first, then what we actually know, then what has happened between
 * us. Observed facts, inferred reads, and human decisions stay visibly apart —
 * the same discipline Scout uses.
 */

import { useState, type FormEvent } from "react";

import {
  CHANNEL_LABEL,
  DUE_LABEL,
  dueState,
  RELATIONSHIP_STAGES,
  SOURCE_LABEL,
  STAGE_LABEL,
  TIER_LABEL,
  type MemoryItem,
  type Relationship,
  type ThreadChannel,
  type Touch,
} from "@/domain/comms";
import { AmbientRule, AmbientSurface } from "@/components/tt/ambient";
import { MetaPill, TTButton, TTInput } from "@/components/tt/primitives";
import { cn } from "@/lib/utils";

function Tier({ tier }: { tier: MemoryItem["tier"] }) {
  return (
    <span
      className={cn(
        "font-mono text-[10px] uppercase tracking-[0.14em]",
        tier === "decided" ? "text-royal" : "text-muted-foreground",
      )}
    >
      {TIER_LABEL[tier]}
    </span>
  );
}

function MemoryList({ title, items }: { title: string; items: MemoryItem[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="tt-eyebrow">{title}</p>
      <ul className="mt-2 space-y-2.5">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            <p className="text-[13px] text-foreground">
              {item.label} <Tier tier={item.tier} />
            </p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{item.value}</p>
            {item.evidence.length > 0 ? (
              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {item.evidence.map((entry) => entry.label).join(" · ")}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RelationshipWorkspace({
  relationship,
  touches,
  onStage,
  onNextAction,
  onLogTouch,
  onRemember,
  busy,
}: {
  relationship: Relationship;
  touches: Touch[];
  onStage: (stage: Relationship["stage"]) => void;
  onNextAction: (value: string) => void;
  onLogTouch: (input: {
    channel: ThreadChannel;
    direction: "inbound" | "outbound";
    summary: string;
  }) => void;
  onRemember: (item: Omit<MemoryItem, "at">) => void;
  busy?: boolean;
}) {
  const [nextAction, setNextActionValue] = useState(relationship.nextAction ?? "");
  const [summary, setSummary] = useState("");
  const [channel, setChannel] = useState<ThreadChannel>("email");
  const [direction, setDirection] = useState<"inbound" | "outbound">("outbound");
  const [note, setNote] = useState("");
  const due = dueState(relationship);

  function logTouch(event: FormEvent) {
    event.preventDefault();
    if (!summary.trim()) return;
    onLogTouch({ channel, direction, summary: summary.trim() });
    setSummary("");
  }

  function remember(event: FormEvent) {
    event.preventDefault();
    if (!note.trim()) return;
    onRemember({
      label: "Worth remembering",
      value: note.trim(),
      tier: "decided",
      evidence: [{ label: "Entered by a person", kind: "human" }],
    });
    setNote("");
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <header className="overflow-hidden border-b border-border">
        <AmbientRule appId="comms" />
        <AmbientSurface appId="comms" depth="deep" className="p-6 sm:p-8">
          <p className="tt-eyebrow">{SOURCE_LABEL[relationship.source]}</p>
          <h1 className="tt-display mt-3 text-3xl text-foreground sm:text-4xl">
            {relationship.fullName}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {[relationship.companyName, relationship.email, relationship.metWhere]
              .filter(Boolean)
              .join(" · ") || "Nothing else on record yet."}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <MetaPill>{STAGE_LABEL[relationship.stage]}</MetaPill>
            <MetaPill>{DUE_LABEL[due]}</MetaPill>
            <MetaPill>
              {relationship.lastTouchAt
                ? `Last spoke ${new Date(relationship.lastTouchAt).toLocaleDateString()}`
                : "No contact yet"}
            </MetaPill>
          </div>
        </AmbientSurface>
      </header>

      <div className="space-y-8 p-6 sm:p-8">
        <section>
          <p className="tt-eyebrow">Where this stands</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {RELATIONSHIP_STAGES.map((stage) => (
              <button
                key={stage}
                type="button"
                disabled={busy}
                onClick={() => onStage(stage)}
                aria-pressed={relationship.stage === stage}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  relationship.stage === stage
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {STAGE_LABEL[stage]}
              </button>
            ))}
          </div>

          <form
            className="mt-4 flex flex-wrap items-center gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              onNextAction(nextAction.trim());
            }}
          >
            <TTInput
              className="h-11 max-w-md flex-1"
              value={nextAction}
              onChange={(event) => setNextActionValue(event.target.value)}
              placeholder="The next move, in one line"
              aria-label="Next move"
            />
            <TTButton type="submit" variant="secondary" size="sm" disabled={busy}>
              Save next move
            </TTButton>
          </form>
        </section>

        <section className="space-y-5 border-t border-border pt-6">
          <p className="tt-eyebrow">What we know</p>
          <MemoryList title="Observed" items={relationship.observed} />
          <MemoryList title="Inferred" items={relationship.inferred} />
          <MemoryList title="Decided by a person" items={relationship.decided} />
          {relationship.observed.length +
            relationship.inferred.length +
            relationship.decided.length ===
          0 ? (
            <p className="text-[13px] text-muted-foreground">
              Nothing recorded yet. One true detail is enough to make the next message specific.
            </p>
          ) : null}

          <form onSubmit={remember} className="flex flex-wrap items-center gap-3">
            <TTInput
              className="h-11 max-w-md flex-1"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add something worth remembering"
              aria-label="Add a note"
            />
            <TTButton type="submit" variant="secondary" size="sm" disabled={busy || !note.trim()}>
              Remember this
            </TTButton>
          </form>
        </section>

        <section className="border-t border-border pt-6">
          <p className="tt-eyebrow">History</p>
          <form onSubmit={logTouch} className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(CHANNEL_LABEL) as ThreadChannel[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setChannel(value)}
                  aria-pressed={channel === value}
                  className={cn(
                    "rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    channel === value
                      ? "border-foreground text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {CHANNEL_LABEL[value]}
                </button>
              ))}
              <span className="mx-1 h-6 w-px bg-border" aria-hidden />
              {(["outbound", "inbound"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDirection(value)}
                  aria-pressed={direction === value}
                  className={cn(
                    "rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    direction === value
                      ? "border-foreground text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {value === "outbound" ? "We wrote" : "They wrote"}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <TTInput
                className="h-11 max-w-md flex-1"
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="What happened, in one line"
                aria-label="Log a touch"
              />
              <TTButton
                type="submit"
                variant="secondary"
                size="sm"
                disabled={busy || !summary.trim()}
              >
                Log it
              </TTButton>
            </div>
          </form>

          {touches.length === 0 ? (
            <p className="mt-4 text-[13px] text-muted-foreground">
              No contact logged. Comms only counts what actually happened.
            </p>
          ) : (
            <ul className="mt-5 space-y-4">
              {touches.map((touch) => (
                <li key={touch.id} className="border-b border-border pb-4 last:border-b-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {new Date(touch.occurredAt).toLocaleDateString()} ·{" "}
                    {CHANNEL_LABEL[touch.channel]} ·{" "}
                    {touch.direction === "inbound" ? "They wrote" : "We wrote"}
                  </p>
                  <p className="mt-1 text-[13px] text-foreground">{touch.summary}</p>
                  {touch.body ? (
                    <p className="mt-1 whitespace-pre-wrap text-[13px] text-muted-foreground">
                      {touch.body}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
