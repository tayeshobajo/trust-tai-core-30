/**
 * What the engine learned from you.
 *
 * A person who corrects a machine deserves to see the correction take effect.
 * This is the record: every Accept, Edit, Not now and Not useful, in order,
 * with the exact consequence next to it, not a claim that learning happened.
 *
 * Read-only by design. Nothing here can be edited, because the ledger it comes
 * from is append-only and the trail is the ledger.
 */

import { useState } from "react";

import { MetaPill, TTButton, TTCard } from "@/components/tt/primitives";
import {
  DECISION_LABEL,
  LEARNING_EFFECT_LABEL,
  learningSummary,
  type LearningTrail,
  type LearningTrailEntry,
} from "@/data/intelligence/engine";

const FIRST_SHOWN = 5;

function when(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Entry({ entry }: { entry: LearningTrailEntry }) {
  return (
    <li className="border-t border-border/60 py-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <MetaPill>{DECISION_LABEL[entry.decision]}</MetaPill>
        <span className="text-xs text-muted-foreground">
          {entry.decidedBy} · {when(entry.at)}
        </span>
      </div>

      <p className="mt-2 text-sm text-foreground">{entry.statement}</p>

      <p className="mt-2 text-xs text-muted-foreground">
        {LEARNING_EFFECT_LABEL[entry.effect]}
        {entry.effect === "counting_towards_suppression"
          ? ` · dismissed ${entry.dismissals} time${entry.dismissals === 1 ? "" : "s"}`
          : null}
      </p>
    </li>
  );
}

export function LearningTrailPanel({ trail }: { trail: LearningTrail }) {
  const [expanded, setExpanded] = useState(false);
  const entries = expanded ? trail.entries : trail.entries.slice(0, FIRST_SHOWN);

  return (
    <TTCard>
      <p className="tt-eyebrow">How your decisions changed the engine</p>
      <p className="mt-2 text-sm text-muted-foreground">{learningSummary(trail)}</p>

      {trail.entries.length === 0 ? null : (
        <>
          <ul className="mt-6">
            {entries.map((entry) => (
              <Entry key={entry.id} entry={entry} />
            ))}
          </ul>

          {trail.entries.length > FIRST_SHOWN ? (
            <div className="mt-4">
              <TTButton variant="quiet" onClick={() => setExpanded((value) => !value)}>
                {expanded ? "Show fewer" : `Show all ${trail.entries.length} decisions`}
              </TTButton>
            </div>
          ) : null}

          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            <div>
              <p className="tt-eyebrow">No longer raised</p>
              {trail.suppressed.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {trail.suppressed.map((item) => (
                    <li key={item.patternKey} className="text-sm text-muted-foreground">
                      {item.label}
                      <span className="text-xs"> · dismissed {item.dismissals} times</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Nothing is suppressed. {trail.suppressionThreshold} dismissals of the same reading
                  stop it being raised.
                </p>
              )}
            </div>

            <div>
              <p className="tt-eyebrow">Your wording, now decided</p>
              {trail.adopted.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {trail.adopted.map((item) => (
                    <li
                      key={`${item.at}-${item.statement}`}
                      className="text-sm text-muted-foreground"
                    >
                      “{item.statement}”<span className="text-xs"> · {when(item.at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  You have not rewritten a reading yet. When you do, inference will not contradict
                  it.
                </p>
              )}
            </div>
          </div>

          {trail.favoured.length > 0 ? (
            <p className="mt-6 text-xs text-muted-foreground">
              Offered earlier when they recur: {trail.favoured.map((item) => item.label).join(", ")}
              . Ordering only, accepting something never makes the engine more certain about it.
            </p>
          ) : null}
        </>
      )}
    </TTCard>
  );
}
