import type { ReactNode } from "react";

import { AppHero } from "@/components/tt/app-hero";

/**
 * Steward's header. The status line only ever states things that are true:
 * a real Fathom sync state and a real count of registered agents.
 */
export function StewardHero({
  action,
  status,
}: {
  action?: ReactNode;
  status?: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <AppHero
        appId="steward"
        eyebrow="Steward"
        title="Keep priorities clear. Keep promises visible."
        supporting="Steward connects what your people and agents said they would do with what actually happened."
        {...(action ? { action } : {})}
      />
      {status ? (
        <p className="px-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {status}
        </p>
      ) : null}
    </div>
  );
}
