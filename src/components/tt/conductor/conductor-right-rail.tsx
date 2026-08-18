/**
 * The right rail: secondary by design.
 *
 * Today's shape, the things only a person can settle, the last few movements,
 * and a short statement of what this room is allowed to do. Nothing here is a
 * control surface — every item points at where the work actually lives.
 */

import { Link } from "@tanstack/react-router";

import { CONDUCTOR_CAN, type ConductorGlance, type MovedItem, type NeedsTaiItem } from "./capabilities";

function Rail({ title, children, cta }: { title: string; children: React.ReactNode; cta?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="tt-eyebrow mb-3">{title}</h2>
      {children}
      {cta ? <div className="mt-3 border-t border-border pt-2.5 text-[12.5px]">{cta}</div> : null}
    </section>
  );
}

export function ConductorRightRail({
  glance,
  needs,
  moved,
  onCapabilities,
}: {
  glance: ConductorGlance;
  needs: NeedsTaiItem[];
  moved: MovedItem[];
  onCapabilities: () => void;
}) {
  return (
    <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
      <Rail
        title="Today"
        cta={
          <Link
            to="/modules/activity"
            search={{ view: "today" as const }}
            className="text-royal underline underline-offset-4"
          >
            View today&rsquo;s activity
          </Link>
        }
      >
        <dl className="space-y-1.5 text-[13px]">
          <div className="flex items-center gap-2">
            <dt className="text-muted-foreground">Recommendations</dt>
            <dd className="ml-auto tabular-nums text-foreground">{glance.recommendations}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-muted-foreground">Authorisations waiting</dt>
            <dd className="ml-auto tabular-nums text-foreground">{glance.authorizations}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-muted-foreground">Actions in execution</dt>
            <dd className="ml-auto tabular-nums text-foreground">{glance.executing}</dd>
          </div>
        </dl>
      </Rail>

      <Rail
        title="Needs Tai"
        cta={
          <Link
            to="/modules/activity"
            search={{ view: "needs" as const }}
            className="text-royal underline underline-offset-4"
          >
            View all
          </Link>
        }
      >
        {needs.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            Nothing is waiting on your judgment.
          </p>
        ) : (
          <ul className="space-y-2">
            {needs.map((item) => (
              <li key={item.id} className="text-[13px]">
                <Link to={item.route} className="text-foreground hover:text-royal">
                  {item.label}
                </Link>
                <p className="text-[12px] text-muted-foreground">{item.roomLabel}</p>
              </li>
            ))}
          </ul>
        )}
      </Rail>

      <Rail
        title="Recently moved"
        cta={
          <Link
            to="/modules/activity"
            search={{ view: "moved" as const }}
            className="text-royal underline underline-offset-4"
          >
            View all movements
          </Link>
        }
      >
        {moved.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">Nothing has been handed over yet.</p>
        ) : (
          <ul className="space-y-2">
            {moved.map((item) => (
              <li key={item.id} className="text-[13px]">
                <p className="text-foreground">{item.label}</p>
                <p className="text-[12px] text-muted-foreground">
                  {item.roomLabel} · {item.outcome}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Rail>

      <Rail
        title="What Conductor can do"
        cta={
          <button type="button" onClick={onCapabilities} className="text-royal underline underline-offset-4">
            View capabilities
          </button>
        }
      >
        <ul className="space-y-1.5 text-[12.5px] text-muted-foreground">
          {CONDUCTOR_CAN.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Rail>
    </aside>
  );
}
