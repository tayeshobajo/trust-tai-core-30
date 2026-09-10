import { Link } from "@tanstack/react-router";

import { TTButton } from "@/components/tt/primitives";

/** A quiet way out of indecision: one question, one door. */
export function GuidanceCard() {
  return (
    <aside className="flex h-full flex-col justify-between gap-5 rounded-2xl border border-border bg-cloud px-6 py-6">
      <div>
        <h3 className="font-display text-xl text-foreground">Not sure where to go?</h3>
        <p className="mt-2 text-sm text-muted-foreground">Ask Tai for guidance.</p>
      </div>
      <div>
        <TTButton asChild variant="signal">
          <Link to="/modules/$slug" params={{ slug: "conductor" }}>
            Open Conductor
          </Link>
        </TTButton>
      </div>
    </aside>
  );
}
