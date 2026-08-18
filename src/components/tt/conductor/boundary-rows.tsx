/**
 * The two quiet rows at the foot of the room.
 *
 * What the Conductor has learned, and what it cannot do. Both are closed by
 * default: they matter, but they are not what a person came here to decide.
 * Opening the first reveals the full ledger unchanged, evidence, confidence,
 * observation against rule, and the precedence of a person's own correction.
 */

import type { ReactNode } from "react";

import { CONDUCTOR_CANNOT } from "./capabilities";

function Row({
  id,
  eyebrow,
  statement,
  cta,
  children,
}: {
  id: string;
  eyebrow: string;
  statement: string;
  cta: string;
  children?: ReactNode;
}) {
  return (
    <details id={id} className="group rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer select-none flex-wrap items-center gap-3 px-5 py-4">
        <span className="tt-eyebrow">{eyebrow}</span>
        <span className="text-[13px] text-muted-foreground">{statement}</span>
        <span className="ml-auto text-[13px] text-royal underline underline-offset-4">{cta}</span>
      </summary>
      {children ? <div className="border-t border-border px-5 py-5">{children}</div> : null}
    </details>
  );
}

export function BoundaryRows({
  lessons,
  learning,
}: {
  /** How many recorded lessons bear on the readings above. */
  lessons: number;
  learning: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <Row
        id="conductor-learning"
        eyebrow="What Conductor has learned"
        statement={
          lessons === 0
            ? "Nothing has been learned yet, no approved step has produced an observed result."
            : `${lessons} recorded lesson${lessons === 1 ? "" : "s"} appl${
                lessons === 1 ? "ies" : "y"
              } to the recommendations above.`
        }
        cta="View learning"
      >
        {learning}
      </Row>

      <Row
        id="conductor-boundaries"
        eyebrow="What Conductor cannot do"
        statement="It coordinates. The owning rooms execute."
        cta="View boundaries"
      >
        <p className="max-w-reading text-sm text-muted-foreground">{CONDUCTOR_CANNOT}</p>
      </Row>
    </div>
  );
}
